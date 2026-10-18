/**
 * @file utils/analysisCache.ts
 *
 * In-memory memoization for the page's expensive analysis passes.
 *
 * ## Why this exists
 * `useReadingTools.ts` re-runs its whole effect — clean, split, POS,
 * bolding, underlines — on *any* watched setting change, even ones
 * unrelated to a given pass (e.g. changing `lineFocusHeight` still
 * re-triggers `extractKeywords()` and `applyPOSHighlight()`, neither of
 * which depends on line-focus at all). None of those passes previously
 * memoized anything, so every settings tweak re-walked the DOM and
 * re-ran `compromise` parsing / complexity scoring from scratch — that's
 * the source of the "toggling anything feels slow" latency.
 *
 * Three independent stores, each keyed by something stable across an
 * unrelated settings change but that changes when the real input changes:
 *
 * - {@link getCachedKeywordExtraction} / {@link setCachedKeywordExtraction} —
 *   keyed by the concatenated paragraph text. `extractKeywords()`'s result
 *   doesn't depend on `boldThresholdPercent` (that's applied later, in
 *   `applyPhraseBolding`'s per-paragraph slicing) — only on paragraph text.
 * - {@link getCachedPosParse} / {@link setCachedPosParse} — keyed by a
 *   single text node's exact string content, caching `compromise`'s parsed
 *   term/tag structure. Tags don't depend on `enabled`/`colors` — only the
 *   *rendering* does — so a colour-only change reuses every previous parse
 *   instead of re-running `nlp()` across the whole page.
 * - {@link getCachedComplexity} / {@link setCachedComplexity} — keyed by
 *   lowercase word, caching `scoreComplexity()`'s output. Shared by
 *   `wordUnderlines.ts` and `paragraphScorer.ts`, so a word scored by one
 *   is free for the other.
 *
 * ## Invalidation
 * None of these expire on their own — sized for a single page view, not a
 * long session. Call {@link clearAnalysisCache} when the underlying DOM
 * content changes from under them (e.g. SPA navigation, if this content
 * script persists across route changes rather than being re-injected per
 * page load). I haven't seen how — or whether — this extension detects
 * navigation, so that call site isn't wired here; it needs to go wherever
 * that detection lives.
 *
 * ## What's NOT handled here
 * `wordSimplifier.ts`'s `scoreComplexity` itself isn't wrapped by this
 * file — the get/set pair are cache *storage* only. Call sites (currently
 * `wordUnderlines.ts` and `paragraphScorer.ts`) check the cache before
 * calling `scoreComplexity` and populate it after. I haven't seen
 * `wordSimplifier.ts`, so I don't know if `scoreComplexity` has any
 * internal state that would make this unsafe — flagging rather than
 * guessing there too.
 */

export interface ParagraphScore {
  text: string
  action: 'none' | 'split'
}

export interface AnalysisResult {
  bold_targets?: string[]
  complex_words?: string[]
  sentences?: string[]
  paragraph_scores?: ParagraphScore[]
}

let cachedData: AnalysisResult | null = null

// ─── Keyword extraction cache ──────────────────────────────────────────────

interface KeywordExtractionEntry {
  paragraphsKey: string
  result: Array<{ term: string; score: number }>
}

let keywordCache: KeywordExtractionEntry | null = null

/**
 * Builds the memoization key for a paragraph list: every paragraph joined
 * by a separator character unlikely to appear in real text. Two calls with
 * identical paragraph content produce the same key and hit the cache, even
 * across different `Element` references (e.g. after a sentence-split
 * rewrote the DOM but the visible paragraph text is unchanged).
 */
function keyForParagraphs(paragraphs: string[]): string {
  return paragraphs.join('\u241F')
}

/**
 * Returns the cached `extractKeywords()` result if `paragraphs` matches the
 * last cached call's input exactly, or `null` on a miss.
 */
export function getCachedKeywordExtraction(
  paragraphs: string[],
): Array<{ term: string; score: number }> | null {
  const key = keyForParagraphs(paragraphs)
  return keywordCache && keywordCache.paragraphsKey === key ? keywordCache.result : null
}

/** Stores `result` as the cached `extractKeywords()` output for `paragraphs`. */
export function setCachedKeywordExtraction(
  paragraphs: string[],
  result: Array<{ term: string; score: number }>,
): void {
  keywordCache = { paragraphsKey: keyForParagraphs(paragraphs), result }
}

// ─── POS parse cache ────────────────────────────────────────────────────────

/** Shape returned by compromise's `.json({ terms: {...} })` — one entry per sentence. */
type PosParseResult = any

const posParseCache = new Map<string, PosParseResult>()

/** Returns the cached compromise parse for `text`, or `null` on a miss. */
export function getCachedPosParse(text: string): PosParseResult | null {
  return posParseCache.get(text) ?? null
}

/** Stores `parsed` as the cached compromise parse result for `text`. */
export function setCachedPosParse(text: string, parsed: PosParseResult): void {
  posParseCache.set(text, parsed)
}

// ─── Word complexity cache ──────────────────────────────────────────────────

const complexityCache = new Map<string, number>()

/** Returns the cached `scoreComplexity()` result for `word` (case-insensitive), or `null`. */
export function getCachedComplexity(word: string): number | null {
  const v = complexityCache.get(word.toLowerCase())
  return v === undefined ? null : v
}

/** Stores `score` as the cached `scoreComplexity()` result for `word` (case-insensitive). */
export function setCachedComplexity(word: string, score: number): void {
  complexityCache.set(word.toLowerCase(), score)
}

// ─── Cache lifecycle ────────────────────────────────────────────────────────

/**
 * Clears every memoization store in this file, plus the legacy
 * `cachedData` slot. Call when the underlying page content changes from
 * under the cache — see this file's header for why that call site isn't
 * wired here.
 */
export function clearAnalysisCache(): void {
  cachedData = null
  keywordCache = null
  posParseCache.clear()
  complexityCache.clear()
}

// ─── Legacy scrape helpers (unchanged) ──────────────────────────────────────

export function getCachedData() {
  return cachedData
}

export function getParagraphs(): string[] {
  const selectors = ['main', 'article', '[role="main"]', '#content', '.content']
  let root: Element | null = null
  for (const sel of selectors) {
    root = document.querySelector(sel)
    if (root) break
  }
  root = root ?? document.body

  return Array.from(root.querySelectorAll('p, li'))
    .map(el => (el.textContent ?? '').trim())
    .filter(text => text.split(/\s+/).length >= 18)
}

export function fetchAnalysis(): Promise<AnalysisResult | null> {
  return Promise.resolve(cachedData)
}