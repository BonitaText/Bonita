/**
 * @file background/index.ts
 *
 * Background service worker. Its only job is to make the cross-origin
 * requests that content scripts can't make reliably — content scripts run
 * inside the page, so their `fetch()` calls are subject to that page's CORS
 * and CSP rules. The background worker is a privileged extension context, so
 * as long as `host_permissions` in the manifest lists the target domains,
 * requests made here bypass page-level CORS entirely.
 *
 * ## Division of responsibility with `content/utils/synonymCache.ts`
 * This file only fetches and structurally filters raw data (bad shapes,
 * circular definitions, near-duplicate stems). It does NOT rank synonyms by
 * complexity — that requires the English frequency map, which lives in the
 * content script and is too large to serialise across the message boundary
 * on every hover. `synonymCache.ts` still owns: complexity ranking,
 * diversity selection, and the in-memory hover cache.
 *
 * ## Message contract
 * Content scripts call `chrome.runtime.sendMessage({ type: 'FETCH_WORD_INFO', word })`
 * and receive a `RawWordInfo` (bucketed by part of speech, unranked).
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/** Per-part-of-speech bundle before complexity ranking. */
export interface RawPosEntry {
  pos: string
  /** Deduplicated, structurally-valid synonym candidates. Unranked. */
  synonyms: string[]
  /** Truncated, non-circular definition, or `null` if none was available. */
  definition: string | null
}

interface DatamuseWord {
  word: string
  score?: number
  tags?: string[]
}

interface FDMeaning {
  partOfSpeech: string
  synonyms: string[]
  definitions: Array<{ definition: string; synonyms?: string[] }>
}

interface FDEntry {
  meanings: FDMeaning[]
}

// ─── Config ───────────────────────────────────────────────────────────────────

/** Hard character cap for a single definition. */
const DEF_MAX_CHARS = 200

// ─── Datamuse ─────────────────────────────────────────────────────────────────

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

// ─── Main fetch + bucket ────────────────────────────────────────────────────

/**
 * Fetches synonyms and definitions for `word` from Datamuse and the Free
 * Dictionary API in parallel and buckets everything by part of speech.
 *
 * No complexity ranking happens here — see file header. Callers (the content
 * script, via the message listener below) are responsible for ranking
 * `synonyms` with the real frequency map and for caching the result.
 *
 * @param word - Any casing; normalised to lower-case internally.
 * @returns Raw, unranked per-POS entries. POS buckets with no synonyms and
 *          no definition are dropped.
 */
export async function fetchRawWordData(word: string): Promise<RawPosEntry[]> {
  const key = word.toLowerCase()

  const [dmSyn, fdEntries] = await Promise.all([
    datamuse('rel_syn', key),
    freeDictionary(key),
  ])

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

  const entries: RawPosEntry[] = []
  for (const [pos, b] of buckets.entries()) {
    entries.push({
      pos,
      synonyms: [...b.synonyms],
      definition: b.definition,
    })
  }

  return entries.filter(e => e.synonyms.length > 0 || e.definition !== null)
}

// ─── Message listener ───────────────────────────────────────────────────────

interface FetchWordInfoMessage {
  type: 'FETCH_WORD_INFO'
  word: string
}

chrome.runtime.onMessage.addListener((msg: FetchWordInfoMessage, _sender, sendResponse) => {
  if (msg.type === 'FETCH_WORD_INFO') {
    fetchRawWordData(msg.word).then(sendResponse)
    return true // keep the message channel open for the async sendResponse
  }
  return false
})