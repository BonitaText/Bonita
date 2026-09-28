/**
 * @file utils/paragraphScorer.ts
 *
 * Decides which paragraphs on a page should be broken into bulleted
 * sentences.
 *
 * ## Why this no longer uses Flesch-Kincaid
 * The original version scored paragraphs with Flesch Reading Ease plus
 * hand-tuned penalties for average word length, average sentence length,
 * and syllable density — a generic readability formula with no notion of
 * which *specific* words are actually hard, just aggregate shape.
 *
 * `wordSimplifier.ts`'s {@link scoreComplexity} already exists as a
 * per-word difficulty model fit against the CompLex human-complexity
 * dataset (rarity, syllables, morphology, consonant clusters), and is
 * already the scoring backbone `phraseExtractor.ts` uses for keyword
 * difficulty. Reusing it here means a paragraph is judged dense because it
 * contains words a reader would actually struggle with — not because it
 * merely has long sentences.
 *
 * ## Scoring is page-relative, not absolute
 * A paragraph's density is the fraction of its content words whose
 * {@link scoreComplexity} meets {@link COMPLEXITY_THRESHOLDS}`.medium`.
 * {@link scoreParagraph} only computes this density — it does **not**
 * decide whether the paragraph gets split.
 *
 * That decision, {@link selectSplitTargets}, is page-relative: it ranks
 * every candidate paragraph on the current page by density and splits the
 * densest `thresholdPercent`% of them. `thresholdPercent = 100` always
 * means "every eligible paragraph splits," `1` always means "only the
 * single densest paragraph splits," regardless of the page's overall
 * reading level — no fixed absolute cutoff to tune per-site.
 *
 * There is no LLM-rewrite tier. Every candidate resolves to `'split'` or
 * `'none'`.
 *
 * ## Complexity score caching
 * Per-word {@link scoreComplexity} results are memoized via
 * `analysisCache.ts`'s {@link getCachedComplexity}/{@link setCachedComplexity}
 * — the same cache `wordUnderlines.ts` uses — so scoring the same word
 * twice (once here, once for underlining) only ever costs one real
 * computation per session.
 */

import { scoreComplexity, COMPLEXITY_THRESHOLDS } from './wordSimplifier'
import { getFreqMap } from './phraseExtractor'
import { getCachedComplexity, setCachedComplexity } from './analysisCache'
import type { ParagraphScore } from './analysisCache'

export type { ParagraphScore }

// ---------------------------------------------------------------------------
// Word tokenisation
// ---------------------------------------------------------------------------

/** Matches a single alphabetic "word" token, allowing internal apostrophes/hyphens. */
const WORD_RE = /[A-Za-z][A-Za-z'-]*/g

/**
 * Extracts word tokens from `text` for scoring purposes. Deliberately
 * cheap — no NLP segmentation, just a regex scan — since this runs on
 * every candidate paragraph on the page.
 *
 * @param text - Paragraph text.
 * @returns Array of word tokens, original casing preserved.
 */
function extractWords(text: string): string[] {
  return text.match(WORD_RE) ?? []
}

/**
 * Looks up `word`'s complexity score, checking `analysisCache.ts` first and
 * falling back to {@link scoreComplexity} on a miss.
 *
 * @param word - Word token, any casing.
 * @param freq - English frequency rank map.
 */
function complexityOf(word: string, freq: Map<string, number>): number {
  const cached = getCachedComplexity(word)
  if (cached !== null) return cached
  const score = scoreComplexity(word, freq)
  setCachedComplexity(word, score)
  return score
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/** A scored paragraph, before {@link selectSplitTargets} has assigned a final action. */
export interface ScoredParagraph extends ParagraphScore {
  _debug?: {
    density: number
    avgComplexity: number
    wordCount: number
    complexWordCount: number
  }
}

/**
 * Scores a single paragraph's word-complexity density.
 *
 * `action` is always returned as `'none'` as a placeholder — deciding the
 * real action is a page-relative ranking, done separately by
 * {@link selectSplitTargets}. Callers scoring a whole page's paragraphs
 * (e.g. `sentenceSplitter.ts`) must run every result through
 * {@link selectSplitTargets} before trusting `action`.
 *
 * @param text - Paragraph text (any surrounding whitespace is trimmed).
 * @param freq - English frequency rank map. Pass this explicitly when
 *   scoring many paragraphs in a loop so the map is resolved once.
 */
export async function scoreParagraph(
  text: string,
  freq?: Map<string, number>,
): Promise<ScoredParagraph> {
  const trimmed = text.trim()
  const words = extractWords(trimmed)

  if (words.length === 0) {
    return { text: trimmed, action: 'none' }
  }

  const freqMap = freq ?? (await getFreqMap())

  let complexWordCount = 0
  let totalComplexity = 0
  for (const word of words) {
    const score = complexityOf(word, freqMap)
    totalComplexity += score
    if (score >= COMPLEXITY_THRESHOLDS.medium) complexWordCount++
  }

  const density = complexWordCount / words.length
  const avgComplexity = totalComplexity / words.length

  return {
    text: trimmed,
    action: 'none',
    _debug: {
      density: Math.round(density * 1000) / 1000,
      avgComplexity: Math.round(avgComplexity * 1000) / 1000,
      wordCount: words.length,
      complexWordCount,
    },
  }
}

/**
 * Given every candidate paragraph on a page (already scored via
 * {@link scoreParagraph}), decides which ones get split.
 *
 * Ranks all `scores` with at least one word by `density` descending, then
 * marks the densest `thresholdPercent`% as `'split'` — everything else is
 * `'none'`. Ties are broken by original array order, so results are stable
 * across repeated runs on an unchanged page. Empty paragraphs (no words)
 * are never selected and don't count toward the eligible pool used to
 * compute how many paragraphs `thresholdPercent`% actually is.
 *
 * @param scores - Every candidate paragraph's score, from {@link scoreParagraph}.
 * @param thresholdPercent - Sensitivity, 1-100.
 * @returns A new array, same order/length as `scores`, with `action` set.
 */
export function selectSplitTargets(
  scores: ScoredParagraph[],
  thresholdPercent: number,
): ScoredParagraph[] {
  const eligible = scores.filter(s => (s._debug?.wordCount ?? 0) > 0)

  const splitCount =
    thresholdPercent > 0 && eligible.length > 0
      ? Math.min(eligible.length, Math.ceil((thresholdPercent / 100) * eligible.length))
      : 0

  if (splitCount === 0) {
    return scores.map(s => ({ ...s, action: 'none' as const }))
  }

  const ranked = eligible
    .map((s, i) => ({ s, i }))
    .sort((a, b) => (b.s._debug!.density - a.s._debug!.density) || (a.i - b.i))

  const splitSet = new Set(ranked.slice(0, splitCount).map(({ s }) => s))

  return scores.map(s => ({ ...s, action: splitSet.has(s) ? ('split' as const) : ('none' as const) }))
}

/**
 * Scores and ranks every paragraph in `paragraphs` in one call.
 *
 * @param paragraphs - Array of paragraph text strings.
 * @param thresholdPercent - Sensitivity, 1-100. Defaults to 50.
 */
export async function scoreParagraphs(
  paragraphs: string[],
  thresholdPercent = 50,
): Promise<ParagraphScore[]> {
  const freq = await getFreqMap()
  const scored = await Promise.all(paragraphs.map(p => scoreParagraph(p, freq)))
  return selectSplitTargets(scored, thresholdPercent)
}