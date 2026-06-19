/**
 * Stores and retrieves analysis results for the current page.
 * Acts as an in-memory cache so we don't re-fetch on every render.
 */

export interface ParagraphScore {
  text: string
  action: 'none' | 'split' | 'llm'
}

export interface AnalysisResult {
  bold_targets?: string[]
  complex_words?: string[]
  sentences?: string[]
  paragraph_scores?: ParagraphScore[]
}

let cachedData: AnalysisResult | null = null

/**
 * Returns whatever analysis result is currently in memory.
 * Will be null until a fetch has been completed and stored.
 */
export function getCachedData() {
  return cachedData
}

/**
 * Scrapes the page for meaningful paragraph and list-item text.
 * Prefers semantic landmarks (main, article, [role="main"], #content, .content)
 * over the full body, and filters out short snippets under 18 words.
 *
 * @returns Array of trimmed paragraph strings from the page
 */
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

/**
 * Async wrapper around the in-memory cache.
 * Currently always resolves immediately — no network request is made.
 *
 * @returns Promise resolving to the cached AnalysisResult, or null if empty
 */
export function fetchAnalysis(): Promise<AnalysisResult | null> {
  return Promise.resolve(cachedData)
}