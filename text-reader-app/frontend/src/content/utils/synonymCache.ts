/**
 * @file content/utils/synonymCache.ts
 *
 * Multi-source synonym + definition fetcher with quality-aware ranking.
 *
 * ## Sources (fired in parallel)
 *   1. Datamuse `rel_syn`  — true synonyms (WordNet synset membership).
 *   2. Free Dictionary API — synonyms + definitions, both bucketed by POS.
 *
 * ## Core design: never discard, always rank
 * Synonym candidates are scored for complexity using the same
 * `scoreComplexity` logic and the same real frequency map (`englishFreq.json`)
 * used to decide which words to underline. Per part of speech:
 *   - synonyms are sorted simplest-first
 *   - a definition is always produced per POS when available, unless it is
 *     circular (contains the headword itself as a whole-word match)
 *
 * ## Capitalisation, not part-of-speech, gates suppression
 * Filtering out names, acronyms, and sentence-initial capitals is handled
 * purely by the capitalisation check in wordUnderlines.ts.
 */

import { scoreComplexity } from './wordSimplifier'

// ─── Types ────────────────────────────────────────────────────────────────────

/** Per-part-of-speech bundle: ranked synonyms plus an optional definition. */
export interface PosEntry {
  pos: string
  /** Synonyms for this POS, simplest-first. May be empty. */
  synonyms: string[]
  /**
   * Definition for this POS, truncated to {@link DEF_MAX_CHARS}.
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

// ─── Config ───────────────────────────────────────────────────────────────────

/** Hard character cap for a single definition. */
const DEF_MAX_CHARS = 200

// ─── In-memory cache ─────────────────────────────────────────────────────────

const cache = new Map<string, WordInfo>()

// ─── Datamuse ─────────────────────────────────────────────────────────────────

interface DatamuseWord {
  word: string
  score?: number
  tags?: string[]
}

async function datamuse(rel: string, word: string): Promise<DatamuseWord[]> {
  try {
    const res = await fetch(
      `https://api.datamuse.com/words?${rel}=${encodeURIComponent(word)}&md=fp&max=30`,
    )
    if (!res.ok) return []
    return (await res.json()) as DatamuseWord[]
  } catch {
    return []
  }
}

/** Maps Datamuse short POS tags to the vocabulary used by Free Dictionary. */
function datamusePos(tags: string[] | undefined): string {
  if (!tags) return 'other'
  if (tags.includes('n')) return 'noun'
  if (tags.includes('v')) return 'verb'
  if (tags.includes('adj')) return 'adjective'
  if (tags.includes('adv')) return 'adverb'
  return 'other'
}

// ─── Free Dictionary ──────────────────────────────────────────────────────────

interface FDMeaning {
  partOfSpeech: string
  synonyms: string[]
  definitions: Array<{ definition: string; synonyms?: string[] }>
}

interface FDEntry {
  meanings: FDMeaning[]
}

async function freeDictionary(word: string): Promise<FDEntry[]> {
  try {
    const res = await fetch(
      `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`,
    )
    if (!res.ok) return []
    return (await res.json()) as FDEntry[]
  } catch {
    return []
  }
}

// ─── Shape filters ────────────────────────────────────────────────────────────

/**
 * Returns `true` when `candidate` is structurally unusable as a synonym —
 * not a complexity judgement. Rejects candidates that are:
 *   - too short (< 2 chars) or too long (> 20 chars)
 *   - identical to the original word
 *   - share the first 3 characters with the original (near-duplicate stem)
 *   - a substring of the original, or vice-versa (e.g. "caps" inside "capital")
 *   - a multi-word phrase of more than 2 tokens
 */
function isStructurallyBad(candidate: string, original: string): boolean {
  const c = candidate.toLowerCase().trim()
  const o = original.toLowerCase()

  if (c.length < 2 || c.length > 20) return true
  if (c === o) return true

  const prefixLen = 3
  if (o.length >= prefixLen && c.length >= prefixLen && c.slice(0, prefixLen) === o.slice(0, prefixLen)) return true
  if (c.includes(o) || o.includes(c)) return true
  if (c.split(/\s+/).length > 2) return true

  return false
}

/**
 * Returns `true` when the definition contains the lookup word as a whole-word
 * match, making it circular and therefore unhelpful to the reader.
 *
 * Only exact whole-word matches are treated as circular — shared stems are
 * not sufficient (e.g. "prefect" appearing in "prefecture"'s definition is
 * not circular).
 */
function isCircularDef(text: string, key: string): boolean {
  const lower = text.toLowerCase()
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`\\b${escaped}\\b`).test(lower)
}

function truncateDef(text: string, maxChars = DEF_MAX_CHARS): string {
  if (text.length <= maxChars) return text
  const cut = text.slice(0, maxChars).replace(/\s+\S*$/, '')
  return cut + '…'
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
 * Fetches synonyms and definitions for `word` from Datamuse and the Free
 * Dictionary API in parallel, ranks every synonym candidate by complexity
 * (simplest-first), and groups everything by part of speech.
 *
 * Results are cached in memory for the lifetime of the page so repeated
 * hovers on the same word incur no additional network requests.
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

  const [dmSyn, fdEntries] = await Promise.all([
    datamuse('rel_syn', key),
    freeDictionary(key),
  ])

  // ── Bucket everything by POS ─────────────────────────────────────────────
  const buckets = new Map<string, { synonyms: Set<string>; definition: string | null }>()

  function bucket(pos: string) {
    let b = buckets.get(pos)
    if (!b) {
      b = { synonyms: new Set(), definition: null }
      buckets.set(pos, b)
    }
    return b
  }

  // Datamuse rel_syn — POS-tagged
  for (const w of dmSyn) {
    const c = w.word.toLowerCase().trim()
    if (isStructurallyBad(c, key)) continue
    bucket(datamusePos(w.tags)).synonyms.add(c)
  }

  // Free Dictionary — synonyms + first non-circular definition per POS
  for (const entry of fdEntries) {
    for (const meaning of entry.meanings ?? []) {
      const pos = (meaning.partOfSpeech ?? 'other').toLowerCase()
      const b = bucket(pos)

      const meaningSyns: string[] = meaning.synonyms ?? []
      for (const def of meaning.definitions ?? []) {
        const candidates = [...(def.synonyms ?? []), ...meaningSyns]
        for (const s of candidates) {
          const c = s.toLowerCase().trim()
          if (!c || isStructurallyBad(c, key)) continue
          b.synonyms.add(c)
        }

        if (b.definition === null && def.definition && !isCircularDef(def.definition, key)) {
          b.definition = truncateDef(def.definition)
        }
      }
    }
  }

  // ── Rank synonyms per POS by complexity, simplest-first ──────────────────
  const entries: PosEntry[] = []
  for (const [pos, b] of buckets.entries()) {
    const ranked = [...b.synonyms]
      .map(w => ({ word: w, score: scoreComplexity(w, freq) }))
      .sort((a, b2) => a.score - b2.score)

    entries.push({
      pos,
      synonyms: diverseSynonyms(ranked),
      definition: b.definition,
    })
  }

  // Non-noun POS first; noun/proper-noun last
  entries.sort((a, b2) => {
    const aNoun = a.pos === 'noun' || a.pos === 'proper noun'
    const bNoun = b2.pos === 'noun' || b2.pos === 'proper noun'
    if (aNoun === bNoun) return 0
    return aNoun ? 1 : -1
  })

  // Drop POS buckets that ended up with no synonyms and no definition
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