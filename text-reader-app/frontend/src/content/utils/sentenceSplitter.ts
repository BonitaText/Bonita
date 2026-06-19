/**
 * @file utils/sentenceSplitter.ts
 *
 *
 * Provides sentence-level splitting of paragraph DOM elements, converting
 * dense prose into bulleted `<li>` lists while preserving all inline markup
 * (links, bold, spans, etc.).
 *
 * ### High-level flow
 * 1. {@link applySentenceSplit} locates all paragraph/block elements in the
 *    page's content root whose {@link ParagraphScore} action is `"split"` or
 *    `"llm"`.
 * 2. For each matching element, {@link buildSentenceLis} normalises the text
 *    (via {@link buildNormMap}), detects sentence boundaries (via
 *    {@link findSentenceBoundaries}), and extracts each sentence as a `<li>`
 *    using the DOM Range API so that inline markup is preserved exactly.
 * 3. The original `innerHTML` is stashed on a `data-bonita-original` attribute
 *    so {@link removeSentenceSplit} can fully restore the element on demand.
 *
 * ### Abbreviation / false-boundary handling
 * compromise's sentence segmenter occasionally fires on abbreviation periods
 * (e.g. `vs.`, `e.g.`, `Fig.`) or Unicode punctuation that is not a true
 * sentence end. {@link isFalseBoundary} suppresses these via two heuristics:
 * - The character immediately after the candidate boundary is lowercase.
 * - The preceding fragment ends with a token that matches {@link ABBREV_PATTERN}.
 */

import nlp from 'compromise'
import type { ParagraphScore } from './analysisCache'

// ─── Constants ────────────────────────────────────────────────────────────────

/** CSS class added to every element that has been sentence-split. Used as a
 *  selector in {@link removeSentenceSplit} to find and restore modified nodes. */
const MARKER_CLASS = 'bonita-split'

/** Data attribute on which the original `innerHTML` is stashed before
 *  replacement, enabling lossless restoration. */
const ORIGINAL_ATTR = 'data-bonita-original'

/**
 * HTML tag names whose subtrees must never be sentence-split.
 *
 * Includes interactive controls (`button`, `input`, `select`), code blocks
 * (`code`, `pre`), structural chrome (`nav`, `header`, `footer`, `aside`),
 * tabular data (`table`), and media (`svg`).
 */
const BLOCKED_TAGS = new Set([
  'script', 'style', 'noscript', 'textarea', 'input',
  'code', 'pre', 'nav', 'header', 'footer', 'aside',
  'button', 'table', 'select', 'svg',
])

/**
 * Regex that matches a trailing known abbreviation token (without its closing
 * period, which is consumed by the NLP tokeniser) at the end of a sentence
 * fragment.
 *
 * Used by {@link isFalseBoundary} heuristic 2.  Extend the alternation to add
 * domain-specific abbreviations (journal names, legal citations, etc.).
 *
 * @example
 * // Matches "support vs" at the end of "…lost more than 30% of its support vs"
 * ABBREV_PATTERN.test('…lost more than 30% of its support vs') // true
 */
const ABBREV_PATTERN =
  /(?:^|\s)(vs?|v|e\.g|i\.e|etc|no|vol|fig|dept|approx|est|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec|Dr|Mr|Mrs|Ms|Prof|Sr|Jr|Lt|Capt|Sgt|Rep|Sen|Gov|al)\.$/i

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Returns `true` if `el` should be excluded from sentence splitting.
 *
 * An element is skipped when:
 * - It is inside the Bonita extension UI (`#bonita-root`, `.bonita-dock`,
 *   `.bonita-trigger`).
 * - Any of its ancestors has a tag name listed in {@link BLOCKED_TAGS}.
 *
 * @param el - The candidate element to test.
 */
function shouldSkip(el: Element): boolean {
  if (el.closest('#bonita-root, .bonita-dock, .bonita-trigger')) return true
  let cursor: Element | null = el.parentElement
  while (cursor) {
    if (BLOCKED_TAGS.has(cursor.tagName.toLowerCase())) return true
    cursor = cursor.parentElement
  }
  return false
}

/**
 * Returns the best available content root for the current page.
 *
 * Tries semantic / landmark selectors in priority order before falling back to
 * `document.body`.  The root is passed to {@link getParagraphElements} to
 * restrict candidate paragraph discovery to the main content area and avoid
 * operating on navigation or boilerplate text.
 */
function getContentRoot(): Element {
  const selectors = ['main', 'article', '[role="main"]', '#content', '.content']
  for (const sel of selectors) {
    const el = document.querySelector(sel)
    if (el) return el
  }
  return document.body
}

/**
 * Collects all paragraph-like elements within `root` that are candidates for
 * sentence splitting.
 *
 * Strategy:
 * 1. Prefer `<p>` elements — if there are three or more, return them directly.
 * 2. Otherwise supplement with `<div>` and `<section>` elements that contain
 *    no block-level children and have at least 65 words of text (a proxy for
 *    "dense prose paragraph").
 *
 * @param root - The content root returned by {@link getContentRoot}.
 * @returns An array of elements, possibly empty.
 */
function getParagraphElements(root: Element): Element[] {
  const ps = Array.from(root.querySelectorAll('p'))
  if (ps.length >= 3) return ps

  const candidates = Array.from(root.querySelectorAll('div, section')).filter(el => {
    const hasBlockChild = Array.from(el.children).some(child =>
      ['div', 'section', 'article', 'p', 'ul', 'ol', 'table'].includes(
        child.tagName.toLowerCase(),
      ),
    )
    if (hasBlockChild) return false
    const words = (el.textContent ?? '').trim().split(/\s+/).length
    return words >= 65
  })

  return ps.length > 0 ? [...ps, ...candidates] : candidates
}

// ─── DOM-position mapping ─────────────────────────────────────────────────────

/**
 * A resolved DOM position: a specific character offset within a specific
 * {@link Text} node.  Used by {@link buildNormMap} to build the character-level
 * map between `normText` indices and live DOM positions.
 */
interface TextPosition {
  /** The `Text` node that contains this character. */
  node: Text
  /** Zero-based character offset within `node.textContent`. */
  offset: number
}

/**
 * Walks all text nodes inside `el` and produces a whitespace-collapsed,
 * single-line string plus a parallel position map.
 *
 * **Why normalise?**
 * HTML `textContent` frequently contains newlines from source indentation or
 * inline elements.  Those newlines are invisible to readers but look like
 * sentence boundaries to NLP models, causing spurious mid-sentence splits on
 * many websites.  Collapsing all runs of whitespace to a single space removes
 * the ambiguity before the text is handed to compromise.
 *
 * **The map** is a parallel array where `map[i]` is the DOM location of the
 * i-th character in `normText`.  This allows {@link buildSentenceLis} to
 * translate NLP sentence boundaries (character offsets in `normText`) back into
 * exact DOM positions for Range extraction, without any string-search heuristics.
 *
 * @param el - The element whose text content should be normalised.
 * @returns
 *   - `normText` — whitespace-collapsed text, trimmed at both ends.
 *   - `map` — parallel `TextPosition` array of the same length as `normText`.
 */
function buildNormMap(el: Element): { normText: string; map: TextPosition[] } {
  const map: TextPosition[] = []
  let normText = ''
  let lastWasSpace = true // start true to suppress leading whitespace

  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  let n: Node | null
  while ((n = walker.nextNode())) {
    const raw = (n as Text).textContent ?? ''
    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i]
      if (/\s/.test(ch)) {
        if (!lastWasSpace) {
          map.push({ node: n as Text, offset: i })
          normText += ' '
          lastWasSpace = true
        }
      } else {
        map.push({ node: n as Text, offset: i })
        normText += ch
        lastWasSpace = false
      }
    }
  }

  if (normText.endsWith(' ')) {
    normText = normText.slice(0, -1)
    map.pop()
  }

  return { normText, map }
}

/**
 * Returns `true` when the candidate boundary at `boundaries[idx]` appears to
 * be a false positive produced by the NLP sentence segmenter.
 *
 * Two independent heuristics are applied; either is sufficient to suppress the
 * boundary:
 *
 * 1. **Lowercase continuation** — the first non-space character after the
 *    boundary is a lowercase ASCII letter.  A genuine sentence always begins
 *    with an uppercase letter or a digit/symbol, so lowercase is a reliable
 *    indicator that the segmenter fired on an abbreviation period (e.g. `vs.`,
 *    `∼15%`).
 *
 * 2. **Known abbreviation** — the text fragment before the boundary ends with a
 *    token matched by {@link ABBREV_PATTERN} (e.g. `Fig.`, `Dr.`, `v.`).  This
 *    catches cases where the next word happens to be a proper noun or number
 *    that starts uppercase (e.g. `"Roe v. Wade"`, `"See Fig. 3"`).
 *
 * @param normText   - The whitespace-collapsed element text.
 * @param boundaries - The raw boundary array being evaluated.
 * @param idx        - Index of the candidate boundary within `boundaries`
 *                     (must satisfy `1 ≤ idx ≤ boundaries.length - 2`).
 * @returns `true` if the boundary should be merged into the preceding sentence.
 */
function isFalseBoundary(
  normText: string,
  boundaries: number[],
  idx: number,
): boolean {
  const boundaryPos = boundaries[idx]
  const fragment = normText.slice(boundaries[idx - 1] ?? 0, boundaryPos).trimEnd()

  // Heuristic 1: next real character is lowercase → not a true sentence end
  let nextChar = ''
  let scan = boundaryPos
  while (scan < normText.length && normText[scan] === ' ') scan++
  if (scan < normText.length) nextChar = normText[scan]
  if (nextChar && nextChar === nextChar.toLowerCase() && /[a-z]/.test(nextChar)) {
    return true
  }

  // Heuristic 2: fragment ends with a known abbreviation token + period
  if (ABBREV_PATTERN.test(fragment)) {
    return true
  }

  return false
}

/**
 * Runs compromise's sentence segmentation on the already-normalised text and
 * returns an array of boundary indices into `normText`.
 *
 * `boundaries[i]` is the start of sentence i; `boundaries[i + 1]` is the
 * start of the next sentence (or `normText.length` for the last one).
 *
 * False boundaries produced by abbreviation periods are suppressed by
 * {@link isFalseBoundary} before the final array is returned.
 *
 * @param normText - Whitespace-collapsed text from {@link buildNormMap}.
 * @returns
 *   An array of at least 3 entries (`[0, …, normText.length]`) when two or
 *   more sentences are detected, or an empty array otherwise.
 */
function findSentenceBoundaries(normText: string): number[] {
  const sentences = (nlp(normText).sentences().out('array') as string[])
    .map((s: string) => s.trim())
    .filter((s: string) => s.length > 0 && /[A-Za-z0-9]/.test(s))

  if (sentences.length < 2) return []

  const raw: number[] = [0]
  let pos = 0
  for (const s of sentences.slice(0, -1)) {
    pos += s.length
    while (pos < normText.length && normText[pos] === ' ') pos++
    raw.push(pos)
  }
  raw.push(normText.length)

  const merged: number[] = [0]
  for (let i = 1; i < raw.length - 1; i++) {
    if (isFalseBoundary(normText, raw, i)) {
      continue
    }
    merged.push(raw[i])
  }
  merged.push(normText.length)

  return merged
}

/**
 * Splits `el`'s content into one `<li>` per sentence while preserving all
 * inline HTML (hyperlinks, bold, spans, etc.).
 *
 * Preservation works by using the DOM Range API to extract each sentence's
 * portion of the live element tree via `range.cloneContents()`.  We never
 * assign to `textContent` (which would lose markup) and instead operate
 * directly on text nodes and their ancestor elements.
 *
 * If a Range extraction fails (e.g. detached or cross-shadow-root nodes) the
 * sentence falls back to plain-text content for that `<li>` only.
 *
 * @param el - The paragraph or block element to split.
 * @returns
 *   An array of `<li>` elements (one per detected sentence) when two or more
 *   sentences are found, or `null` if the element contains fewer than two
 *   sentences or if map/boundary data is unavailable.
 */
function buildSentenceLis(el: Element): HTMLLIElement[] | null {
  const { normText, map } = buildNormMap(el)
  if (!normText || map.length === 0) return null

  const boundaries = findSentenceBoundaries(normText)
  if (boundaries.length < 3) return null

  const lis: HTMLLIElement[] = []

  for (let i = 0; i < boundaries.length - 1; i++) {
    const start = boundaries[i]
    const end = boundaries[i + 1]

    if (start >= end || !map[start]) continue

    let lastCharIdx = end < map.length ? end - 1 : map.length - 1
    while (lastCharIdx > start && normText[lastCharIdx] === ' ') lastCharIdx--

    if (!map[lastCharIdx]) continue

    try {
      const range = document.createRange()
      range.setStart(map[start].node, map[start].offset)
      range.setEnd(map[lastCharIdx].node, map[lastCharIdx].offset + 1)

      const li = document.createElement('li')
      li.style.cssText = 'margin-bottom: 6px; line-height: 1.6;'
      li.appendChild(range.cloneContents())
      lis.push(li)
    } catch {
      const li = document.createElement('li')
      li.style.cssText = 'margin-bottom: 6px; line-height: 1.6;'
      li.textContent = normText.slice(start, end).trim()
      lis.push(li)
    }
  }

  return lis.length >= 2 ? lis : null
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Applies sentence-level splitting to every paragraph element in the page
 * whose {@link ParagraphScore} action is `"split"` or `"llm"`.
 *
 * For each matched element the function:
 * 1. Stashes the original `innerHTML` on the `data-bonita-original` attribute.
 * 2. Adds the `bonita-split` CSS class as a restoration marker.
 * 3. Replaces the element's content with a `<ul>` containing one `<li>` per
 *    detected sentence.
 *
 * Calls {@link removeSentenceSplit} at the start to ensure idempotency — safe
 * to call repeatedly as analysis results are refreshed.
 *
 * @param paragraphScores - Analysis results from the LLM cache.  Each entry
 *   must have a `text` prefix (first ≤80 chars) used to match DOM elements,
 *   and an `action` field controlling whether splitting is applied.
 */
export function applySentenceSplit(paragraphScores: ParagraphScore[]) {
  if (!Array.isArray(paragraphScores) || paragraphScores.length === 0) return
  removeSentenceSplit()

  const root = getContentRoot()
  const elements = getParagraphElements(root)

  for (const el of elements) {
    if (shouldSkip(el)) continue
    if (el.classList.contains(MARKER_CLASS)) continue

    const text = (el.textContent ?? '').trim()
    const score = paragraphScores.find(s => text.startsWith(s.text.slice(0, 80)))
    if (!score || (score.action !== 'split' && score.action !== 'llm')) continue

    const lis = buildSentenceLis(el)
    if (!lis) continue

    el.setAttribute(ORIGINAL_ATTR, el.innerHTML)
    el.classList.add(MARKER_CLASS)

    const ul = document.createElement('ul')
    ul.style.cssText = 'margin: 8px 0; padding-left: 1.5em; list-style: disc;'
    lis.forEach(li => ul.appendChild(li))

    el.innerHTML = ''
    el.appendChild(ul)
  }
}

/**
 * Reverses all sentence splits applied by {@link applySentenceSplit}.
 *
 * Finds every element carrying the `bonita-split` class, restores its
 * `innerHTML` from the `data-bonita-original` attribute, and removes both the
 * class and the attribute.  Safe to call even when no splits are active.
 */
export function removeSentenceSplit() {
  const splits = document.querySelectorAll(`.${MARKER_CLASS}`)
  for (const el of Array.from(splits)) {
    const original = el.getAttribute(ORIGINAL_ATTR)
    if (original !== null) {
      el.innerHTML = original
      el.removeAttribute(ORIGINAL_ATTR)
    }
    el.classList.remove(MARKER_CLASS)
  }
}