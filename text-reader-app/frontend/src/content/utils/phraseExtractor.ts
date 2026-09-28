/**
 * @file utils/phraseExtractor.ts
 *
 * Keyword extraction using compromise (NLP) + MeSH dictionary + science patterns.
 *
 * Scoring pipeline (see {@link scoreTerm}):
 *
 *   score = pageFrequency × difficulty × importance
 *
 *   pageFrequency — how often the term appears in the article (log-scaled)
 *   difficulty    — reading difficulty of the term, from {@link difficultyOfTerm},
 *                   which shares `scoreComplexity` with `wordSimplifier.ts`
 *                   (rarity × syllables × morphology × consonant clusters).
 *                   Applies to every term, specialist or not, so a MeSH term
 *                   gets credit for being hard to read, not just for being
 *                   domain-flagged.
 *   importance    — how strongly this term is domain-flagged: MeSH branch
 *                   weight, science pattern, NER. Combined additively
 *                   in log-space (`1 + Σ log2(flag)`) rather than multiplied
 *                   directly, so a term hit by several flags at once (e.g.
 *                   a MeSH phrase that's also NER-recognised) grows
 *                   gently instead of compounding into an outsized score.
 *
 * Word length is intentionally NOT a scoring factor — it was pushing long
 * but unimportant words above short but meaningful ones (p53, WHO, etc.)
 *
 * Acronym status is still computed as a feature (`acronymBonus`, via
 * {@link getTermFeatures}) so `eval/fitKeywordWeights.ts` can keep fitting
 * over it, but it is deliberately excluded from {@link scoreTerm}'s
 * `importance` term: the fitted regression put its coefficient at ~0 (and
 * slightly negative — see `eval/fitKeywordWeights.ts` run history), meaning
 * "is an ALL-CAPS acronym" wasn't actually predictive of importance once
 * MeSH/pattern/NER were already accounted for, and including it as a flat
 * ×2 multiplier was over-promoting incidental acronyms.
 *
 * Candidate generation ({@link extractCandidates}, passes 1–5) and scoring
 * ({@link scoreTerm}) are split apart so `eval/fitKeywordWeights.ts` can
 * generate the exact same candidates production would, without duplicating
 * the NLP/dictionary passes — the same drift risk `difficultyOfTerm` was
 * written to avoid for rarity curves. {@link extractKeywords} is just
 * {@link extractCandidates} followed by a scoring-and-sort step.
 *
 * Stop words live in stopWords.en.json so they can be swapped per language.
 */

import nlp from 'compromise'
import { getCachedKeywordExtraction, setCachedKeywordExtraction } from './analysisCache'
import { extractSciencePatternTerms, extractItalicScienceTerms } from './sciencePatterns'
import { scoreComplexity } from './wordSimplifier'
import { collectBlockElements, isCaptionOrCredit } from './contentRoot'

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
    if (isDottedAbbreviation(t)) return false // "u.s." must not collapse to "us"
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
    if (isDottedAbbreviation(t)) return true // "u.s." is a content token
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
// Body paragraph collection
// ---------------------------------------------------------------------------

/**
 * Scrapes the body paragraphs of the current page.
 *
 * Sourced from {@link collectBlockElements} (`contentRoot.ts`'s shared
 * `<p>`-or-broader block discovery) rather than a local `querySelectorAll('p')`
 * scrape. The previous `<p>`-only version was a duplicate, independent
 * traversal of the page from every other feature's — on pages where body
 * copy isn't wrapped in `<p>` tags at all, it silently returned nothing,
 * which meant keyword extraction had zero candidate paragraphs to work
 * from even after `contentRoot.ts` itself was fixed to look beyond `<p>`.
 * Going through {@link collectBlockElements} keeps this in sync with every
 * other feature's notion of "what's a paragraph" — see that file's header
 * for the general pattern this was an instance of.
 *
 * Excludes image captions/credit lines via {@link isCaptionOrCredit} — a
 * wire-photo credit line is real text but not representative body prose,
 * and scoring it as a candidate paragraph skews keyword extraction toward
 * whatever proper nouns happen to be in a photo credit.
 *
 * @returns Array of trimmed paragraph text strings, each at least 30 words
 *   (via {@link collectBlockElements}'s `minWords`) — short captions and
 *   pull quotes are discarded.
 */
export function getBodyParagraphs(): string[] {
  return collectBlockElements({ minWords: 30 })
    .filter(el => !isCaptionOrCredit(el))
    .map(el => (el.textContent ?? '').trim())
    .filter(Boolean)
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
    .filter(([, n]) => n >= 1)
    .sort((a, b) => b[1] - a[1])
    .map(([token]) => token.toLowerCase())
}

// ---------------------------------------------------------------------------
// Difficulty — shared with wordSimplifier.ts
// ---------------------------------------------------------------------------

/**
 * Returns the reading-difficulty score for a (possibly multi-word) term,
 * via {@link scoreComplexity} from `wordSimplifier.ts`. This is what lets
 * keyword scoring and complexity scoring share one rarity/morphology/rarity
 * curve instead of the two drifting apart.
 *
 * For multi-word terms (e.g. a MeSH phrase like `"national institutes of
 * health"`), the term's difficulty is the difficulty of its **hardest**
 * word, not the average — a phrase reads as hard as its hardest word.
 *
 * `scoreComplexity` now returns a fitted regression score centered near its
 * intercept (~0.16) rather than a ≥1.0 product, so its raw output is
 * rescaled here as `1 + max(0, score)` — a multiplicative "no worse than
 * baseline, boosted by difficulty" factor — rather than passed straight
 * through. A straight pass-through was tried first and made keyword ranking
 * worse (see the eval run comparing "floor removed" vs "rescaled" in
 * fitKeywordWeights.ts's history); this rescale is a hand-picked guess that
 * empirically beat the old hand-tuned baseline on both Inspec and DUC-2001,
 * not itself a fitted value.
 *
 * @param term - Lowercase candidate term, single- or multi-word.
 * @param freq - English frequency rank map from `englishFreq.json`.
 * @returns Difficulty multiplier ≥ 1.0.
 */
function difficultyOfTerm(term: string, freq: Map<string, number>): number {
  const words = term.split(/\s+/)
  const maxScore = Math.max(...words.map(w => scoreComplexity(w, freq)))
  return 1 + Math.max(0, maxScore)
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/** Raw per-term feature values that {@link scoreTerm} combines into a final score. */
export interface TermFeatures {
  freqScore: number
  difficulty: number
  meshWeight: number
  patternBonus: number
  nerBonus: number
  /**
   * Kept for `eval/fitKeywordWeights.ts`'s design matrix, but no longer used
   * by {@link scoreTerm} — the fitted coefficient came out ~0 (slightly
   * negative), i.e. not predictive of importance once MeSH/pattern/NER are
   * accounted for. See the header comment on this file.
   */
  acronymBonus: number
}

/**
 * Computes the raw feature values for `term` without combining them into a
 * final score. Split out of {@link scoreTerm} so `eval/fitKeywordWeights.ts`
 * can build a design matrix from the same feature computation `scoreTerm`
 * uses, instead of recomputing it separately and risking drift.
 *
 * @param term         - Lowercase candidate term.
 * @param pageFreq     - Raw occurrence count on this page.
 * @param mesh         - MeSH term → weight map.
 * @param freq         - English frequency rank map.
 * @param scienceTerms - Set of regex-detected science pattern terms.
 * @param nerTerms     - Set of compromise-extracted named entities.
 * @param acronyms     - Set of validated ALL-CAPS acronyms.
 */
export function getTermFeatures(
  term: string,
  pageFreq: number,
  mesh: Map<string, number>,
  freq: Map<string, number>,
  scienceTerms: Set<string>,
  nerTerms: Set<string>,
  acronyms: Set<string>,
): TermFeatures {
  const key = term.toLowerCase()
  return {
    freqScore: Math.log2(pageFreq + 1),
    difficulty: difficultyOfTerm(key, freq),
    meshWeight: mesh.get(key) ?? 1.0,
    patternBonus: scienceTerms.has(key) ? 2 : 1.0,
    nerBonus: nerTerms.has(key) ? 2 : 1.0,
    acronymBonus: acronyms.has(key) ? 2 : 1.0,
  }
}

/**
 * Computes the composite keyword score for a single `term`, from its
 * {@link TermFeatures} via {@link getTermFeatures}.
 *
 * Formula:
 * ```
 * score = freqScore × difficulty × importance
 * importance = 1 + Σ log2(flag)   over [meshWeight, patternBonus, nerBonus]
 * ```
 *
 * - `difficulty` applies to **every** term, specialist or not. Previously,
 *   terms flagged as MeSH/NER/pattern/acronym skipped this signal entirely
 *   and fell back to a flat rarity-only bonus — which meant a MeSH term got
 *   credit for being domain-important but no credit for actually being hard
 *   to read.
 * - `importance` combines the MeSH/pattern/NER flags additively in
 *   log-space rather than multiplying them directly, so a term hit by
 *   several flags at once grows gently instead of compounding into an
 *   outsized score.
 * - `acronymBonus` is deliberately **excluded** from `importance`.
 *   `eval/fitKeywordWeights.ts` fit a linear model over all six
 *   {@link TermFeatures} (see that script's output) and its coefficient on
 *   `log_acronymBonus` came out ~0 and slightly negative — being an
 *   ALL-CAPS acronym wasn't actually predictive of importance once
 *   MeSH/pattern/NER were already in the mix, and the old flat ×2 bonus was
 *   over-promoting incidental acronyms. The feature is still computed (see
 *   {@link getTermFeatures}) so the eval script can keep tracking it, but it
 *   no longer feeds the production score.
 *
 * The other near-zero fitted coefficients (`log_difficulty`,
 * `log_meshWeight`) are expected, not a signal to remove those terms — they
 * only fire for specialist/domain terms, so across a general corpus their
 * average marginal contribution is small even though they matter a lot on
 * the documents where they do apply.
 *
 * These are still hand-picked weights — an implicit coefficient of 1 on
 * every remaining term in the product, additive log-combination for
 * importance — not the fitted linear regression itself. See
 * `eval/fitKeywordWeights.ts`'s header for how the two are compared before
 * anything here gets hand-edited further.
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
  const f = getTermFeatures(term, pageFreq, mesh, freq, scienceTerms, nerTerms, acronyms)
  const importance = 1 + [f.meshWeight, f.patternBonus, f.nerBonus]
    .reduce((acc, factor) => acc + Math.log2(factor), 0)
  return f.freqScore * f.difficulty * importance
}

// ---------------------------------------------------------------------------
// Candidate generation — passes 1–5, shared by extractKeywords and the
// fitting script
// ---------------------------------------------------------------------------

/** A single unscored keyword candidate: its term and raw page frequency. */
export interface Candidate {
  term: string
  pageFreq: number
}

/**
 * The dictionaries and flag sets {@link getTermFeatures} needs to score any
 * candidate, plus the candidates themselves — everything {@link extractKeywords}
 * produces before it gets to scoring.
 */
export interface CandidateContext {
  candidates: Candidate[]
  mesh: Map<string, number>
  freq: Map<string, number>
  scienceTerms: Set<string>
  nerTerms: Set<string>
  acronyms: Set<string>
}

/**
 * Runs passes 1–5 and returns the filtered, unscored candidates plus every
 * dictionary/flag set {@link getTermFeatures} needs to score them.
 *
 * **Passes (in order):**
 * 1. **NER** — compromise extracts people, places, and organisations.
 * 2. **Acronyms** — ALL-CAPS tokens (2–6 chars) appearing more than once.
 * 3. **Science patterns** — regex heuristics + italic DOM elements.
 * 4. **MeSH vocabulary** — dictionary lookup against medical subject headings.
 * 5. **Content word frequency** — nouns and adjectives via compromise, with
 *    stop-word and false-capital filtering.
 *
 * {@link extractKeywords} is this function followed by a scoring-and-sort
 * step; kept separate so `eval/fitKeywordWeights.ts` can generate the exact
 * same candidates production would, without re-implementing passes 1–5 —
 * the same drift risk {@link difficultyOfTerm} avoids for rarity curves.
 *
 * @param paragraphs - Body paragraph strings (from {@link getBodyParagraphs}).
 */
export async function extractCandidates(paragraphs: string[]): Promise<CandidateContext> {
  // Load all assets in parallel (cached after first call)
  const [mesh, freq, { stopSet: stops, sentenceStarterSet: sentenceStarters }] = await Promise.all([
    getMeshMap(),
    getFreqMap(),
    getStopSets(),
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
    if (word.length >= 2 && mesh.has(word)) meshHits.add(word)
  }

  // ── Pass 5: Content word frequency (nouns + adjectives via compromise) ───
  const pageFreqMap = new Map<string, number>()

  for (const text of paragraphs) {
    for (const raw of text.split(/\s+/)) {
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
        if (sentenceStarters.has(word)) continue
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

  const candidates = [...pageFreqMap.entries()]
    .filter(([term]) => {
      if (isBlocked(term, stops)) return false
      if (isAllStopTokens(term, stops)) return false
      if (!hasContentToken(term, stops)) return false
      return true
    })
    .map(([term, pageFreq]) => ({ term, pageFreq }))

  return { candidates, mesh, freq, scienceTerms, nerTerms, acronyms }
}

// ---------------------------------------------------------------------------
// extractKeywords — main export
// ---------------------------------------------------------------------------

/**
 * Extracts and ranks the most important keywords from a set of body paragraphs.
 *
 * Thin wrapper: runs {@link extractCandidates} (passes 1–5) then scores and
 * sorts every candidate with {@link scoreTerm}. See {@link extractCandidates}
 * for the candidate-generation strategy and {@link scoreTerm} for the
 * scoring formula.
 *
 * @param paragraphs - Body paragraph strings (from {@link getBodyParagraphs}).
 * @returns Lowercase keyword strings sorted by descending score.
 */
export async function extractKeywords(
  paragraphs: string[],
): Promise<Array<{ term: string, score: number }>> {
  const cached = getCachedKeywordExtraction(paragraphs)
  if (cached) return cached

  const { candidates, mesh, freq, scienceTerms, nerTerms, acronyms } = await extractCandidates(paragraphs)

  const result = candidates
    .map(({ term, pageFreq }) => ({
      term,
      score: scoreTerm(term, pageFreq, mesh, freq, scienceTerms, nerTerms, acronyms),
    }))
    .sort((a, b) => b.score - a.score)

  setCachedKeywordExtraction(paragraphs, result)
  return result
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