/**
 * utils/phraseExtractor.ts
 *
 * Keyword extraction using compromise (NLP) + MeSH dictionary + science patterns.
 *
 * Scoring pipeline:
 *
 *   score = pageFrequency × meshWeight × rarityBonus × patternBonus × nerBonus × acronymBonus
 *
 *   pageFrequency  — how often the term appears in the article (log-scaled)
 *   meshWeight     — branch importance from MeSH (C=1.5, D=1.4, G=1.3 …), 1.0 for non-MeSH
 *   rarityBonus    — inverse of English word commonness (rare = higher score)
 *   patternBonus   — multiplier for regex-detected science terms
 *   nerBonus       — compromise recognised it as a named entity
 *   acronymBonus   — short but meaningful ALL-CAPS token
 *
 * Word length is intentionally NOT a scoring factor — it was pushing long
 * but unimportant words above short but meaningful ones (p53, WHO, etc.)
 *
 * Stop words live in stopWords.en.json so they can be swapped per language.
 */

import nlp from 'compromise'
import { extractSciencePatternTerms, extractItalicScienceTerms } from './sciencePatterns'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single entry from the MeSH medical subject headings dictionary. */
interface MeshEntry {
  /** The canonical term string (may be multi-word). */
  term: string
  /** Top-level MeSH branch letter code, e.g. "C" (Diseases), "D" (Chemicals). */
  branch: string
  /**
   * Importance weight for this branch.
   * C → 1.5, D → 1.4, G → 1.3; other branches → 1.0.
   */
  weight: number
}

/** Shape of the stopWords.en.json asset. */
interface StopWordList {
  /** Words that should never be extracted as keywords. */
  stopWords: string[]
  /**
   * Words that are capitalised only because they open a sentence and should
   * not be treated as proper nouns (e.g. "The", "This", "However").
   */
  sentenceStarters: string[]
}

// ---------------------------------------------------------------------------
// Minimum score threshold — terms below this are discarded regardless of rank.
// Prevents garbage low-signal words from ever reaching boldTargets.
// ---------------------------------------------------------------------------

const MIN_SCORE = 1.2

// ---------------------------------------------------------------------------
// Asset loading — all cached after first call
// ---------------------------------------------------------------------------

let meshMap: Map<string, number> | null = null
let freqMap: Map<string, number> | null = null
let stopSet: Set<string> | null = null
let sentenceStarterSet: Set<string> | null = null

/** Loads and caches the MeSH term → branch-weight map. */
async function getMeshMap(): Promise<Map<string, number>> {
  if (meshMap) return meshMap
  const entries = (await import('../../assets/meshTerms.json').then(m => m.default)) as MeshEntry[]
  meshMap = new Map(entries.map(e => [e.term.toLowerCase(), e.weight]))
  return meshMap
}

/** Loads and caches the English word-frequency rank map (word → rank). */
export async function getFreqMap(): Promise<Map<string, number>> {
  if (freqMap) return freqMap
  const mod = await import('../../assets/englishFreq.json')
  console.log('mod', mod)
  console.log('mod.default', mod.default)
  console.log('is array?', Array.isArray(mod.default))
  const raw = (await import('../../assets/englishFreq.json').then(m => m.default)) as ReadonlyArray<readonly [string, number]>
  freqMap = new Map(raw.map(([word], index) => [word.toLowerCase(), index]))
  return freqMap
}

/**
 * Loads and caches both the stop-word set and the sentence-starter set
 * from the locale asset file.
 */
async function getStopSets(): Promise<{ stopSet: Set<string>; sentenceStarterSet: Set<string> }> {
  if (stopSet && sentenceStarterSet) return { stopSet, sentenceStarterSet }
  const data = (await import('../../assets/stopWords.en.json').then(m => m.default)) as StopWordList
  stopSet = new Set(data.stopWords.map(w => w.toLowerCase()))
  sentenceStarterSet = new Set(data.sentenceStarters.map(w => w.toLowerCase()))
  return { stopSet, sentenceStarterSet }
}

// ---------------------------------------------------------------------------
// isBlocked — checked against the loaded stop set
// ---------------------------------------------------------------------------

/** Returns `true` when `word` (case-insensitive) is in the stop-word set. */
function isBlocked(word: string, stops: Set<string>): boolean {
  return stops.has(word.toLowerCase())
}

// ---------------------------------------------------------------------------
// isAllStopTokens
//
// Returns true when every whitespace-delimited token in a phrase is a stop
// word. Catches multi-word NER extractions like "one of the" or "in the most"
// that slip through isBlocked() because the whole phrase string isn't in the
// stop set.
// ---------------------------------------------------------------------------

/**
 * Returns `true` when **every** whitespace-delimited token in `phrase` is a
 * stop word after stripping punctuation.
 *
 * This catches multi-word NER extractions such as `"one of the"` or
 * `"in the most"` that bypass {@link isBlocked} because the whole phrase
 * string is not itself in the stop set.
 *
 * @param phrase - Candidate phrase, potentially multi-word.
 * @param stops  - The loaded stop-word set.
 */
export function isAllStopTokens(phrase: string, stops: Set<string>): boolean {
  const tokens = phrase.trim().split(/\s+/)
  return tokens.length > 0 && tokens.every(t => {
    if (isDottedAbbreviation(t)) return false  // "u.s." must not collapse to "us"
    return stops.has(t.toLowerCase().replace(/[^a-z'-]/g, ''))
  })
}

// ---------------------------------------------------------------------------
// hasContentToken
//
// Returns true when a multi-word phrase contains at least one token that is
// NOT a stop word and has meaningful length. A phrase like "national institutes
// of health" should pass; "one of the" should not.
// ---------------------------------------------------------------------------

/**
 * Returns `true` when at least one token inside `phrase` is **not** a stop
 * word and has two or more characters.
 *
 * Used as a secondary guard after {@link isAllStopTokens} to ensure that
 * multi-word phrases like `"national institutes of health"` are kept while
 * pure function-word sequences like `"one of the"` are discarded.
 *
 * @param phrase - Candidate phrase, potentially multi-word.
 * @param stops  - The loaded stop-word set.
 */
export function hasContentToken(phrase: string, stops: Set<string>): boolean {
  const tokens = phrase.trim().split(/\s+/)
  return tokens.some(t => {
    if (isDottedAbbreviation(t)) return true  // "u.s." is a content token
    const clean = t.toLowerCase().replace(/[^a-z'-]/g, '')
    return clean.length >= 2 && !stops.has(clean)
  })
}

/**
 * Returns `true` when `term` is a dotted abbreviation — a sequence of
 * single letters separated by dots, optionally ending with a dot.
 * Examples: `"u.s."`, `"u.s.a."`, `"U.S"` (no trailing dot).
 *
 * Used to exempt abbreviations from stop-word stripping, which would
 * collapse `"u.s."` → `"us"` (a stop word) and incorrectly block the term.
 */
export function isDottedAbbreviation(term: string): boolean {
  return /^([a-zA-Z]\.)+[a-zA-Z]?$/.test(term.trim())
}

// ---------------------------------------------------------------------------
// isFalseCapital
//
// Returns true if a capitalised word is ONLY capitalised because it follows
// a sentence boundary — not a true proper noun.
//
// We don't penalise ALL-CAPS (acronyms) or mid-sentence capitals (genuine
// proper nouns like "Einstein" or gene names like "Ras").
// ---------------------------------------------------------------------------

/**
 * Returns `true` when a capitalised `word` appears **only** at sentence
 * boundaries in `context`, meaning the capitalisation is grammatical rather
 * than a signal of proper-noun status.
 *
 * Rules:
 * - ALL-CAPS tokens (e.g. `"WHO"`, `"U.S."`) are **never** false capitals.
 * - A word is a false capital only when every occurrence in `context` is
 *   preceded by `.`, `!`, or `?` (or is at the start of the string).
 * - Mid-sentence occurrences (genuine proper nouns like `"Einstein"`) return
 *   `false`.
 *
 * @param word    - The word as it appears in the source text (case-preserved).
 * @param context - The paragraph or sentence string to search within.
 *
 * @known-issue Words like `"U.S."` are passed in after
 *   `raw.replace(/[^a-zA-Z'-]/g, '')` in Pass 5, which strips the dots and
 *   produces `"US"` — causing them to be treated as a plain ALL-CAPS acronym
 *   rather than a dotted abbreviation. See phraseExtractor.test.ts for the
 *   failing regression tests.
 */
export function isFalseCapital(word: string, context: string): boolean {
  if (!/^[A-Z]/.test(word)) return false
  if (/^[A-Z]+$/.test(word)) return false // ALL-CAPS acronym — never a false capital

  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  // Sentence-boundary occurrences: preceded by .!? or start-of-string
  const sentencePattern = new RegExp(`(?:^|[.!?][\\s\\n]+)${escaped}`, 'g')
  const sentenceMatches = (context.match(sentencePattern) ?? []).length

  // Mid-sentence occurrences: NOT preceded by .!? whitespace or start-of-string
  // We count total occurrences and subtract sentence-boundary ones.
  const totalPattern = new RegExp(`\\b${escaped}\\b`, 'g')
  const totalMatches = (context.match(totalPattern) ?? []).length
  const midSentenceMatches = totalMatches - sentenceMatches

  // If it ONLY appears after sentence boundaries, it's a false capital
  return sentenceMatches > 0 && midSentenceMatches === 0
}

// ---------------------------------------------------------------------------
// Ancestor tags that indicate non-body content
// ---------------------------------------------------------------------------

const NOISE_ANCESTORS = new Set([
  'figure','figcaption','aside','nav','header','footer',
  'blockquote','table','form','menu',
])

/** Returns `true` when `el` is a `<p>` not nested inside any noise container. */
function isBodyText(el: Element): boolean {
  if (el.tagName.toLowerCase() !== 'p') return false
  let cursor: Element | null = el.parentElement
  while (cursor) {
    if (NOISE_ANCESTORS.has(cursor.tagName.toLowerCase())) return false
    cursor = cursor.parentElement
  }
  return true
}

/**
 * Scrapes the body paragraphs of the current page.
 *
 * Strategy:
 * 1. Looks for a semantic content root (`<main>`, `<article>`, `[role="main"]`,
 *    `#content`, `.content`) and falls back to `<body>`.
 * 2. Collects every `<p>` inside that root that is **not** nested inside a
 *    noise ancestor (`<figure>`, `<aside>`, `<nav>`, etc.).
 * 3. Keeps only paragraphs with at least 30 whitespace-delimited tokens —
 *    short captions and pull quotes are discarded.
 *
 * @returns Array of trimmed paragraph text strings.
 */
export function getBodyParagraphs(): string[] {
  const selectors = ['main','article','[role="main"]','#content','.content']
  let root: Element | null = null
  for (const sel of selectors) {
    root = document.querySelector(sel)
    if (root) break
  }
  root = root ?? document.body

  return Array.from(root.querySelectorAll('p'))
    .filter(el => isBodyText(el))
    .map(el => (el.textContent ?? '').trim())
    .filter(text => text.split(/\s+/).length >= 30)
}

// ---------------------------------------------------------------------------
// Acronym extraction
// ---------------------------------------------------------------------------

/**
 * Extracts ALL-CAPS acronyms (2–6 characters) that appear more than once
 * across all paragraphs and are not stop words.
 *
 * Each raw whitespace token is trimmed of any leading/trailing non-uppercase
 * characters (punctuation, digits) before the ALL-CAPS check, so `"(WHO)"` →
 * `"WHO"`.
 *
 * @param paragraphs - Array of body paragraph strings.
 * @param stops      - The loaded stop-word set.
 * @returns Lowercase acronym strings sorted by descending frequency.
 *
 */
export function extractAcronyms(paragraphs: string[], stops: Set<string>): string[] {
  const counts = new Map<string, number>()
  for (const text of paragraphs) {
    for (const raw of text.split(/\s+/)) {
      // ── Branch A: dotted abbreviations — U.S., U.S.A., etc. ───────────
      // Strip surrounding non-[A-Z.] chars (punctuation, brackets) then test.
      const dottedStripped = raw.replace(/^[^A-Z.]+|[^A-Z.]+$/g, '')
      if (/^([A-Z]\.)+[A-Z]?$/.test(dottedStripped)) {
        // Canonical form: lowercase with trailing dot — "U.S." → "u.s.", "U.S" → "u.s."
        const normalized = dottedStripped.toLowerCase().replace(/\.?$/, '.')
        if (!isBlocked(normalized, stops)) {
          counts.set(normalized, (counts.get(normalized) ?? 0) + 1)
        }
        continue // don't also try to match this token as a plain ALL-CAPS token
      }

      // ── Branch B: clean ALL-CAPS tokens — WHO, DNA, etc. ──────────────
      const token = raw.replace(/^[^A-Z]+|[^A-Z]+$/g, '')
      if (
        token.length >= 2 &&
        token.length <= 6 &&
        /^[A-Z]+$/.test(token) &&
        !isBlocked(token.toLowerCase(), stops)
      ) {
        counts.set(token, (counts.get(token) ?? 0) + 1)
      }
    }
  }
  return [...counts.entries()]
    .filter(([, n]) => n > 1)
    .sort((a, b) => b[1] - a[1])
    .map(([token]) => token.toLowerCase())
}

// ---------------------------------------------------------------------------
// Rarity bonus — based on English frequency rank
//   top-1000  → 1.0  (no bonus)
//   1k–5k     → 1.2
//   5k–20k    → 1.5
//   20k+      → 1.8
//   unknown   → 2.0  (likely technical)
// ---------------------------------------------------------------------------

/**
 * Returns a rarity multiplier for `word` based on its English frequency rank.
 *
 * | Rank range | Multiplier | Rationale                          |
 * |------------|------------|------------------------------------|
 * | ≤ 1 000    | 1.0        | Very common — no bonus             |
 * | 1 001–5 000 | 1.2       | Moderately common                  |
 * | 5 001–20 000 | 1.5      | Uncommon — likely domain-specific  |
 * | > 20 000   | 1.8        | Rare                               |
 * | Not found  | 2.0        | Unknown / highly technical         |
 *
 * @param word - Lowercase term to look up.
 * @param freq - The English frequency rank map (word → rank number).
 */
export function rarityBonus(word: string, freq: Map<string, number>): number {
  const rank = freq.get(word.toLowerCase())
  if (rank === undefined) return 2.0
  if (rank <= 1000)  return 1.0
  if (rank <= 5000)  return 1.2
  if (rank <= 20000) return 1.5
  return 1.8
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/**
 * Computes the composite keyword score for a single `term`.
 *
 * Formula:
 * ```
 * score = log2(pageFreq + 1)
 *       × meshWeight
 *       × rarityBonus
 *       × patternBonus   (1.5 if science pattern, else 1.0)
 *       × nerBonus       (1.2 if NER entity, else 1.0)
 *       × acronymBonus   (1.3 if ALL-CAPS acronym, else 1.0)
 * ```
 *
 * Word length is **deliberately excluded** — it over-promoted long but generic
 * words above short meaningful ones (e.g. `p53`, `WHO`).
 *
 * @param term         - Lowercase candidate term.
 * @param pageFreq     - Raw occurrence count on this page.
 * @param mesh         - MeSH term → weight map.
 * @param freq         - English frequency rank map.
 * @param scienceTerms - Set of regex-detected science pattern terms.
 * @param nerTerms     - Set of compromise-extracted named entities.
 * @param acronyms     - Set of validated ALL-CAPS acronyms.
 * @returns Composite score (higher = more important keyword).
 */
export function scoreTerm(
  term: string,
  pageFreq: number,
  mesh: Map<string, number>,
  freq: Map<string, number>,
  scienceTerms: Set<string>,
  nerTerms: Set<string>,
  acronyms: Set<string>,
): number {
  const key = term.toLowerCase()

  // Log-scaled page frequency — diminishing returns on repetition
  const freqScore = Math.log2(pageFreq + 1)

  // MeSH branch weight (1.0 if not in MeSH)
  const meshWeight = mesh.get(key) ?? 1.0

  // Rarity — rare/technical words score higher
  const rarity = rarityBonus(key, freq)

  // Science pattern bonus
  const patternBonus = scienceTerms.has(key) ? 1.5 : 1.0

  // NER bonus
  const nerBonus = nerTerms.has(key) ? 1.2 : 1.0

  // Acronym bonus
  const acronymBonus = acronyms.has(key) ? 1.3 : 1.0

  return freqScore * meshWeight * rarity * patternBonus * nerBonus * acronymBonus
}

// ---------------------------------------------------------------------------
// extractKeywords — main export
// ---------------------------------------------------------------------------

/**
 * Extracts and ranks the most important keywords from a set of body paragraphs
 * using a multi-pass NLP + dictionary pipeline.
 *
 * **Passes (in order):**
 * 1. **NER** — compromise extracts people, places, and organisations.
 * 2. **Acronyms** — ALL-CAPS tokens (2–6 chars) appearing more than once.
 * 3. **Science patterns** — regex heuristics + italic DOM elements.
 * 4. **MeSH vocabulary** — dictionary lookup against medical subject headings.
 * 5. **Content word frequency** — nouns and adjectives via compromise, with
 *    stop-word and false-capital filtering.
 *
 * All candidate terms are scored with {@link scoreTerm} and only those
 * at or above {@link MIN_SCORE} are returned.
 *
 * The returned list length is the minimum of `maxTerms`, a length derived
 * from paragraph count (`10 + paragraphs.length × 2`, capped at 200), and
 * the hard global cap of 200.
 *
 * @param paragraphs - Body paragraph strings (from {@link getBodyParagraphs}).
 * @param maxTerms   - Caller-requested upper bound on returned keywords (default 100).
 * @returns Lowercase keyword strings sorted by descending score.
 */
export async function extractKeywords(
  paragraphs: string[],
  maxTerms = 100,
): Promise<string[]> {
  const GLOBAL_MAX = 200
  const dynamicMax = Math.min(10 + paragraphs.length * 2, GLOBAL_MAX)
  maxTerms = Math.min(maxTerms, dynamicMax, GLOBAL_MAX)

  // Load all assets in parallel (cached after first call)
  const [mesh, freq, stops] = await Promise.all([
    getMeshMap(),
    getFreqMap(),
    getStopSets().then(s => s.stopSet),
  ])

  const fullText = paragraphs.join(' ')

  // ── Pass 1: NER via compromise ──────────────────────────────────────────
  const nerTerms = new Set<string>()
  for (const text of paragraphs) {
    const doc = nlp(text)
    const entities = [
      ...doc.people().out('array') as string[],
      ...doc.places().out('array') as string[],
      ...doc.organizations().out('array') as string[],
    ]
    for (const e of entities) {
      const key = e.toLowerCase().trim()
      if (
        key.length >= 2 &&
        !isBlocked(key, stops) &&
        !isAllStopTokens(key, stops) &&
        hasContentToken(key, stops)
      ) {
        nerTerms.add(key)
      }
    }
  }

  // ── Pass 2: Acronyms ────────────────────────────────────────────────────
  const acronyms = new Set(extractAcronyms(paragraphs, stops))

  // ── Pass 3: Science patterns + italic DOM pass ───────────────────────────
  const scienceTerms = new Set([
    ...extractSciencePatternTerms(fullText),
    ...extractItalicScienceTerms(),
  ])

  // ── Pass 4: MeSH vocabulary lookup ──────────────────────────────────────
  const meshHits = new Set<string>()
  for (const raw of fullText.split(/\s+/)) {
    const word = raw.replace(/[^a-zA-Z'-]/g, '').toLowerCase()
    if (word.length >= 3 && mesh.has(word)) meshHits.add(word)
  }

  // ── Pass 5: Content word frequency (nouns + adjectives via compromise) ───
  const pageFreqMap = new Map<string, number>()

  for (const text of paragraphs) {
    const doc = nlp(text)
    const contentWords = doc.match('#Noun|#Adjective').out('array') as string[]
    for (const raw of contentWords) {
      // ── Dotted abbreviation guard — must run BEFORE the dot-stripping replace ──
      const dottedCheck = raw.replace(/^[^A-Za-z.]+|[^A-Za-z.]+$/g, '')
      if (isDottedAbbreviation(dottedCheck)) {
        const normalized = dottedCheck.toLowerCase().replace(/\.?$/, '.')
        if (!isBlocked(normalized, stops)) {
          pageFreqMap.set(normalized, (pageFreqMap.get(normalized) ?? 0) + 1)
        }
        continue
      }

      const word = raw.replace(/[^a-zA-Z'-]/g, '').toLowerCase()
      if (word.length >= 3 && !isBlocked(word, stops)) {
        if (isFalseCapital(raw, text)) continue
        pageFreqMap.set(word, (pageFreqMap.get(word) ?? 0) + 1)
      }
    }
  }

  // Ensure science/NER/acronym/MeSH terms all have frequency entries
  for (const term of [...nerTerms, ...acronyms, ...scienceTerms, ...meshHits]) {
    // Skip multi-word NER phrases that slipped through with only stop words
    if (isAllStopTokens(term, stops) || !hasContentToken(term, stops)) continue

    if (!pageFreqMap.has(term)) {
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const matches = fullText.match(new RegExp(`\\b${escaped}\\b`, 'gi'))
      pageFreqMap.set(term, matches?.length ?? 1)
    }
  }

  // ── Scoring & ranking ────────────────────────────────────────────────────
  const scored = [...pageFreqMap.entries()]
    .filter(([term]) => {
      if (isBlocked(term, stops)) return false
      if (isAllStopTokens(term, stops)) return false
      if (!hasContentToken(term, stops)) return false
      return true
    })
    .map(([term, pageFreq]) => ({
      term,
      score: scoreTerm(term, pageFreq, mesh, freq, scienceTerms, nerTerms, acronyms),
    }))
    .filter(({ score }) => score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score)

  return scored.slice(0, maxTerms).map(s => s.term)
}

// ---------------------------------------------------------------------------
// extractComplexWords — used by word simplifier (future)
// ---------------------------------------------------------------------------

/**
 * Returns words of 8 or more characters that appear **at most twice** in the
 * combined paragraphs — a rough heuristic for infrequent complex vocabulary
 * that a reading-simplifier tool might want to explain.
 *
 * Only alphabetic characters are kept; digits and punctuation are stripped
 * before counting.
 *
 * @param paragraphs - Array of body paragraph strings.
 * @returns Lowercase words sorted in insertion order (no ranking applied).
 */
export function extractComplexWords(paragraphs: string[]): string[] {
  const counts = new Map<string, number>()
  for (const text of paragraphs) {
    for (const raw of text.split(/\s+/)) {
      const word = raw.replace(/[^a-zA-Z]/g, '').toLowerCase()
      if (word.length >= 8) counts.set(word, (counts.get(word) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .filter(([, count]) => count <= 2)
    .map(([word]) => word)
}