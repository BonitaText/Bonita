/**
 * @file content/utils/synonymCache.ts
 *
 * Complexity-aware synonym + definition ranking, driven by raw data fetched
 * from the background service worker.
 *
 * ## Why this doesn't fetch directly
 * This module runs in the content script, which is injected into the page
 * and is therefore subject to that page's CORS/CSP rules. Datamuse and Free
 * Dictionary don't reliably return permissive CORS headers to arbitrary page
 * origins, so cross-origin fetches from here can fail silently. Instead,
 * `fetchWordInfo` sends a message to `background/index.ts`, which runs in
 * the extension's privileged background context and has `host_permissions`
 * for both APIs — its fetches bypass page-level CORS entirely.
 *
 * ## Division of responsibility with `background/index.ts`
 * The background worker only fetches and structurally filters raw data (bad
 * shapes, circular definitions, near-duplicate stems) — it has no access to
 * the frequency map, which is content-script-local and too large to
 * serialise on every hover. This module owns everything that needs that
 * map: complexity ranking (simplest-first), diversity selection, and the
 * in-memory hover cache.
 *
 * ## Core design: never discard, always rank
 * Synonym candidates are scored for complexity using the same
 * `scoreComplexity` logic and the same real frequency map (`englishFreq.json`)
 * used to decide which words to underline. Per part of speech:
 *   - synonyms are sorted simplest-first
 *   - a definition is always produced per POS when available, unless it is
 *     circular (contains the headword itself as a whole-word match) — that
 *     filtering already happened in the background worker
 *
 * ## Capitalisation, not part-of-speech, gates suppression
 * Filtering out names, acronyms, and sentence-initial capitals is handled
 * purely by the capitalisation check in wordUnderlines.ts.
 */

import { scoreComplexity } from './wordSimplifier'
import type { RawPosEntry } from '../../background/index'

// ─── Types ────────────────────────────────────────────────────────────────────

/** Per-part-of-speech bundle: ranked synonyms plus an optional definition. */
export interface PosEntry {
  pos: string
  /** Synonyms for this POS, simplest-first. May be empty. */
  synonyms: string[]
  /**
   * Definition for this POS, truncated by the background worker.
   * `null` when no non-circular definition was available.
   */
  definition: string | null
}

export interface WordInfo {
  /**
   * One entry per distinct part of speech found across sources.
   * Non-noun POS entries come first; noun/proper-noun entries come last.
   */
  entries: PosEntry[]
  /** True if at least one entry has a synonym or a definition. */
  hasContent: boolean
}

interface FetchWordInfoMessage {
  type: 'FETCH_WORD_INFO'
  word: string
}

// ─── In-memory cache ─────────────────────────────────────────────────────────

const cache = new Map<string, WordInfo>()

// ─── Background messaging ────────────────────────────────────────────────────

/**
 * Asks the background service worker to fetch + structurally filter raw
 * word data. Never throws — resolves to `[]` on any messaging failure (e.g.
 * the background worker being asleep and failing to wake, or an extension
 * reload invalidating the message port), matching the old fetch()'s
 * fail-quiet behaviour.
 */
function requestRawWordData(word: string): Promise<RawPosEntry[]> {
  const message: FetchWordInfoMessage = { type: 'FETCH_WORD_INFO', word }
  return new Promise(resolve => {
    try {
      chrome.runtime.sendMessage(message, (response: RawPosEntry[] | undefined) => {
        if (chrome.runtime.lastError || !response) {
          resolve([])
          return
        }
        resolve(response)
      })
    } catch {
      resolve([])
    }
  })
}

// ─── Synonym selection ────────────────────────────────────────────────────────

/**
 * Selects up to 4 synonyms with intentional diversity rather than just
 * taking the top-N by score:
 *   - shortest candidate  (easiest to read / most concise)
 *   - simplest by score   (lowest complexity score)
 *   - longest candidate   (most precise / formal option)
 *
 * Duplicates across slots are collapsed so the final list is always
 * distinct. If fewer than 4 candidates exist, all are shown.
 *
 * @param ranked - Synonym candidates sorted simplest-first by complexity score.
 * @returns Up to 4 distinct synonym strings.
 */
function diverseSynonyms(ranked: Array<{ word: string; score: number }>): string[] {
  if (ranked.length === 0) return []
  if (ranked.length <= 3) return ranked.map(r => r.word)

  const shortest = [...ranked].sort((a, b) => a.word.length - b.word.length)[0]
  const simplest = ranked[0] // already sorted simplest-first
  const longest  = [...ranked].sort((a, b) => b.word.length - a.word.length)[0]

  const seen = new Set<string>()
  return [shortest, simplest, longest]
    .filter(r => !seen.has(r.word) && !!seen.add(r.word))
    .map(r => r.word)
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Gets synonyms and definitions for `word`, ranks every synonym candidate by
 * complexity (simplest-first), and groups everything by part of speech.
 *
 * Results are cached in memory for the lifetime of the page so repeated
 * hovers on the same word incur no additional messages to the background
 * worker.
 *
 * @param word - Any casing; normalised to lower-case internally.
 * @param freq - The same English frequency map used by `scoreComplexity`
 *               to decide what counts as complex. Synonym scoring must use
 *               real frequency data, not an empty map.
 * @returns A {@link WordInfo} with per-POS entries, sorted non-noun-first.
 */
export async function fetchWordInfo(word: string, freq: Map<string, number>): Promise<WordInfo> {
  const key = word.toLowerCase()
  const cached = cache.get(key)
  if (cached) return cached

  const rawEntries = await requestRawWordData(key)

  // ── Rank synonyms per POS by complexity, simplest-first ──────────────────
  const entries: PosEntry[] = rawEntries.map(raw => {
    const ranked = raw.synonyms
      .map(w => ({ word: w, score: scoreComplexity(w, freq) }))
      .sort((a, b) => a.score - b.score)

    return {
      pos: raw.pos,
      synonyms: diverseSynonyms(ranked),
      definition: raw.definition,
    }
  })

  // Non-noun POS first; noun/proper-noun last
  entries.sort((a, b) => {
    const aNoun = a.pos === 'noun' || a.pos === 'proper noun'
    const bNoun = b.pos === 'noun' || b.pos === 'proper noun'
    if (aNoun === bNoun) return 0
    return aNoun ? 1 : -1
  })

  // Drop POS buckets that ended up with no synonyms and no definition
  // (diversity selection can theoretically zero out synonyms; definition
  // presence alone still keeps a bucket alive)
  const nonEmptyEntries = entries.filter(e => e.synonyms.length > 0 || e.definition !== null)

  const info: WordInfo = {
    entries: nonEmptyEntries,
    hasContent: nonEmptyEntries.length > 0,
  }

  cache.set(key, info)
  return info
}

/** Clears the in-memory synonym cache. Useful in tests or on extension reset. */
export function clearSynonymCache(): void {
  cache.clear()
}

/**
 * Re-exports `scoreComplexity` for callers that want to display a complexity
 * score without re-importing from `wordSimplifier` directly.
 */
export { scoreComplexity as synonymSimplicityScore } from './wordSimplifier'