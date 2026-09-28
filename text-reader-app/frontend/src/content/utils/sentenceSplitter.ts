/**
 * @file utils/sentenceSplitter.ts
 *
 *
 * Provides sentence-level splitting of paragraph DOM elements, converting
 * dense prose into bulleted `<li>` lists while preserving all inline markup
 * (links, bold, spans, etc.).
 *
 * ### High-level flow
 * 1. {@link applySentenceSplit} collects every paragraph-shaped block on the
 *    page via {@link collectBlockElements} and, for each one not already in
 *    point form, scores it with {@link scoreParagraph} to decide whether it
 *    should be split.
 * 2. For each block whose action is `"split"` or `"llm"`,
 *    {@link buildSentenceLis} normalises the text (via {@link buildNormMap}),
 *    detects sentence boundaries (via {@link findSentenceBoundaries}), and
 *    extracts each sentence as a `<li>` using the DOM Range API so that
 *    inline markup is preserved exactly.
 * 3. The original `innerHTML` is stashed on a `data-bonita-original` attribute
 *    so {@link removeSentenceSplit} can fully restore the element on demand.
 *
 * ### Single source of truth for "what's a paragraph"
 * This used to accept a pre-scored `ParagraphScore[]` and match it against
 * DOM blocks by text-prefix. That array was built elsewhere from a `<p>`-only
 * paragraph scrape, while this file walked the broader
 * {@link collectBlockElements} block set — two different traversals of the
 * same page. On `<p>`-free pages (Khan Academy, SparkNotes) the `<p>`-only
 * scrape found nothing, so the prefix match always failed here even though
 * `collectBlockElements` itself was finding the right divs. Scoring is now
 * done inline, on the exact same elements this file walks, which removes
 * that class of bug entirely — see `contentRoot.ts`'s header for the general
 * pattern this was an instance of.
 *
 * This also removes a real latency cost: scoring no longer needs
 * `compromise`'s NLP sentence segmenter (see `paragraphScorer.ts`'s header),
 * so `nlp()` now only runs on paragraphs that actually get split, not on
 * every candidate paragraph on the page just to decide whether to split it.
 *
 * ### Already-point-form content
 * Paragraph-shaped blocks that are already presented as a list — inside a
 * `<ul>`/`<ol>`/`<dl>`, or indented noticeably more than the page's *own*
 * baseline the way a hand-built list often is even without a semantic list
 * element — are skipped by {@link isAlreadyPointForm}. The indentation
 * check compares against this page's minimum candidate indentation rather
 * than a fixed pixel value, specifically so routine site-wide container
 * padding (common on component-library-built sites) isn't mistaken for
 * list indentation — see {@link POINT_FORM_RELATIVE_INDENT_PX}'s doc
 * comment for the failure mode that caused.
 *
 * ### Captions and credit lines
 * Blocks inside a `<figure>` (image captions, wire-photo credit lines) are
 * skipped via {@link isCaptionOrCredit}, imported from `contentRoot.ts`.
 * `figcaption` is deliberately still a valid block *shape*
 * (`contentRoot.ts`'s `BLOCK_TAGS` includes it, since other features are
 * fine annotating text inside one) but it isn't independent body prose —
 * without this exclusion, a caption that happens to clear the word-count
 * floor gets scored and split just like a real paragraph, which is what
 * caused splitting to land on an unrelated photo-credit blurb instead of
 * actual article text on wire-photo-heavy pages (e.g. AP News).
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
import { collectBlockElements, isBonitaUI, isCaptionOrCredit, hasBlockedAncestor } from './contentRoot'
import { scoreParagraph, selectSplitTargets, type ScoredParagraph } from './paragraphScorer'
import { getFreqMap } from './phraseExtractor'

// ─── Constants ────────────────────────────────────────────────────────────────

/** CSS class added to every element that has been sentence-split. Used as a
 *  selector in {@link removeSentenceSplit} to find and restore modified nodes. */
const MARKER_CLASS = 'bonita-split'

/** Data attribute on which the original `innerHTML` is stashed before
 *  replacement, enabling lossless restoration. */
const ORIGINAL_ATTR = 'data-bonita-original'

/**
 * Tags that mark content as a native list — a block inside one of these is
 * already point-form and should never be split further. See
 * {@link isAlreadyPointForm}.
 */
const LIST_CONTAINER_SELECTOR = 'ul, ol, dl'

/**
 * Minimum word count a block must have to be considered for splitting.
 *
 * Deliberately low — this used to be `65`, inherited from an old heuristic
 * that needed a high floor to distinguish "real prose paragraph" from
 * "short nav-label div" back when word count was the *only* signal
 * available. Now that {@link scoreParagraph} judges density from actual
 * word complexity, and {@link buildSentenceLis} independently requires at
 * least two detected sentences before returning anything, word count only
 * needs to be a cheap pre-filter against trivially short text — not the
 * primary gate. `65` was silently excluding every paragraph on sites that
 * write in short paragraphs by style (Khan Academy lesson text, SparkNotes
 * summaries), which is why splitting appeared totally broken there even
 * though `collectBlockElements` was finding the right elements.
 */
const MIN_SPLIT_CANDIDATE_WORDS = 20

/**
 * Minimum amount (in px) a block's indentation must exceed the page's
 * *baseline* indentation — the smallest indentation among all candidate
 * blocks on this pass, computed once per {@link applySentenceSplit} call —
 * to be treated as "manually indented like a list item" even when it isn't
 * inside a semantic `<ul>`/`<ol>`/`<dl>`. See {@link isAlreadyPointForm}.
 *
 * This is deliberately a **relative** delta, not an absolute pixel value.
 * An earlier version compared each block's indentation against a fixed
 * `24px` floor, which false-positived on any site whose component library
 * puts routine container padding on ordinary prose blocks (Chakra,
 * Tailwind, etc. — likely what both Khan Academy and SparkNotes use),
 * misclassifying every real paragraph as "already a list" and silently
 * splitting nothing. Comparing against this page's own baseline means a
 * site-wide padding offset cancels out, and only content that's *actually*
 * indented further than its surroundings — the way a hand-rolled bullet
 * list typically is — gets caught.
 *
 * @known-issue Still a first-guess threshold, not calibrated against real
 *   sites. A block indented for unrelated layout reasons (e.g. a
 *   pull-quote) could still false-positive; worth revisiting if that shows
 *   up in practice.
 */
const POINT_FORM_RELATIVE_INDENT_PX = 16

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

/**
 * Returns `true` if `el` should be excluded from sentence splitting:
 * Bonita's own UI chrome. Blocked-tag-ancestor exclusion is now handled by
 * {@link collectBlockElements} itself, so this only needs the UI check.
 *
 * @param el - The candidate element to test.
 */
function shouldSkip(el: Element): boolean {
  return isBonitaUI(el)
}

/**
 * Returns a block's total left-side offset (`margin-left` + `padding-left`,
 * in px) as a proxy for visual indentation. Used both to establish this
 * page's baseline indentation and to test individual blocks against it —
 * see {@link isAlreadyPointForm}.
 *
 * @param el - Candidate block element.
 */
function getIndent(el: Element): number {
  const style = getComputedStyle(el)
  const value = parseFloat(style.marginLeft || '0') + parseFloat(style.paddingLeft || '0')
  return Number.isFinite(value) ? value : 0
}

/**
 * Returns `true` when `el` is already presented as point-form content and
 * should be left alone rather than converted into a nested bullet list.
 *
 * Two checks, either sufficient on its own:
 * 1. `el` sits inside a semantic `<ul>`/`<ol>`/`<dl>` — it's already a list
 *    item (or a descendant of one), full stop.
 * 2. `el` is indented at least {@link POINT_FORM_RELATIVE_INDENT_PX} beyond
 *    `baselineIndent` — this page's minimum indentation among all
 *    candidate blocks — a common pattern for sites that hand-roll
 *    list-like content without real list markup.
 *
 * @param el              - Candidate block element.
 * @param baselineIndent  - The smallest {@link getIndent} value among all
 *   candidate blocks this pass, from {@link applySentenceSplit}. Comparing
 *   against this rather than a fixed pixel value is what keeps routine
 *   site-wide container padding from being mistaken for list indentation —
 *   see this constant's doc comment.
 */
function isAlreadyPointForm(el: Element, baselineIndent: number): boolean {
  if (el.closest(LIST_CONTAINER_SELECTOR)) return true
  if (getIndent(el) - baselineIndent >= POINT_FORM_RELATIVE_INDENT_PX) return true
  return false
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

/** A single detected sentence's `[start, end)` offsets into `normText`. */
interface SentenceSpan {
  start: number
  end: number
}

/**
 * Wraps {@link findSentenceBoundaries} to return sentence spans instead of
 * raw boundary indices — the shape every caller downstream actually wants.
 *
 * @param normText - Whitespace-collapsed text from {@link buildNormMap}.
 * @returns One span per detected sentence, or `[]` if none were found.
 */
function getSentenceSpans(normText: string): SentenceSpan[] {
  const boundaries = findSentenceBoundaries(normText)
  if (boundaries.length < 2) return []
  const spans: SentenceSpan[] = []
  for (let i = 0; i < boundaries.length - 1; i++) {
    spans.push({ start: boundaries[i], end: boundaries[i + 1] })
  }
  return spans
}

/**
 * Extracts the live DOM content for a `[start, end)` span via the Range
 * API, preserving inline markup (links, bold, etc.) exactly.
 *
 * Factored out of the old `buildSentenceLis` so both bullet `<li>`s and
 * plain-prose runs in {@link buildMixedContent} can share the same
 * extraction path — a sentence's DOM content doesn't depend on whether
 * that sentence ends up bulleted or left as prose.
 *
 * @param map      - Position map from {@link buildNormMap}.
 * @param normText - The same `normText` the map was built against.
 * @param start    - Span start offset into `normText`.
 * @param end      - Span end offset into `normText`.
 * @returns Cloned DOM content for the span, or `null` if the span is
 *   empty or its start position isn't in `map`.
 */
function extractSentenceContent(
  map: TextPosition[],
  normText: string,
  start: number,
  end: number,
): DocumentFragment | Text | null {
  if (start >= end || !map[start]) return null

  let lastCharIdx = end < map.length ? end - 1 : map.length - 1
  while (lastCharIdx > start && normText[lastCharIdx] === ' ') lastCharIdx--
  if (!map[lastCharIdx]) return null

  try {
    const range = document.createRange()
    range.setStart(map[start].node, map[start].offset)
    range.setEnd(map[lastCharIdx].node, map[lastCharIdx].offset + 1)
    return range.cloneContents()
  } catch {
    return document.createTextNode(normText.slice(start, end).trim())
  }
}

/**
 * Rebuilds an element's content as a sequence of plain-prose runs and
 * `<ul>` blocks, following `selected`'s per-sentence flags in original
 * sentence order.
 *
 * This is what makes "the middle sentence is complex, the rest isn't"
 * possible: consecutive unselected sentences stay as ordinary inline text;
 * consecutive selected sentences are grouped into one shared `<ul>` (so
 * two complex sentences in a row become a 2-item list, not two separate
 * one-item lists back to back); a selected run breaks as soon as an
 * unselected sentence appears, and a new `<ul>` opens if selection resumes
 * later in the same paragraph.
 *
 * @param normText - Whitespace-collapsed text from {@link buildNormMap}.
 * @param map      - Position map from the same {@link buildNormMap} call.
 * @param spans    - Sentence spans from {@link getSentenceSpans}, in order.
 * @param selected - Parallel array to `spans` — `true` where that sentence
 *   should be pulled into a bullet.
 * @returns A `DocumentFragment` ready to replace the element's content, or
 *   `null` if no sentence was selected (nothing to change).
 */
function buildMixedContent(
  normText: string,
  map: TextPosition[],
  spans: SentenceSpan[],
  selected: boolean[],
): DocumentFragment | null {
  const fragment = document.createDocumentFragment()
  let currentUl: HTMLUListElement | null = null
  let touched = false

  for (let i = 0; i < spans.length; i++) {
    const { start, end } = spans[i]
    const content = extractSentenceContent(map, normText, start, end)
    if (!content) continue

    if (selected[i]) {
      touched = true
      if (!currentUl) {
        currentUl = document.createElement('ul')
        currentUl.style.cssText = 'margin: 8px 0; padding-left: 1.5em; list-style: disc;'
        fragment.appendChild(currentUl)
      }
      const li = document.createElement('li')
      li.style.cssText = 'margin-bottom: 6px; line-height: 1.6;'
      li.appendChild(content)
      currentUl.appendChild(li)
    } else {
      currentUl = null // break the list run — next selected sentence opens a new <ul>
      if (fragment.lastChild) fragment.appendChild(document.createTextNode(' '))
      fragment.appendChild(content)
    }
  }

  return touched ? fragment : null
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
 * **Per-text-node filtering.** This walk is nested *inside* a block that
 * `applySentenceSplit` already vetted with `isCaptionOrCredit` /
 * `isAlreadyPointForm` before calling this function — but that outer check
 * only judges the block as a whole. A block can still contain a nested
 * widget/caption/credit fragment that individually deserves exclusion (e.g.
 * a carousel's slide-count label sitting alongside real caption prose inside
 * one block, or a `<p>`-vs-wrapper double-candidacy from
 * `collectBlockElements` that let the wrong element through). Previously
 * this walker had no `acceptNode` filter at all and pulled in every text
 * node under `el` unconditionally, so a nested widget fragment's text was
 * silently flattened into `normText` right alongside real prose — the
 * sentence segmenter would then produce boundaries that didn't line up with
 * the real sentence structure, and {@link buildSentenceLis}'s Range-based
 * extraction, which trusts those boundaries completely, would slice at the
 * wrong offsets. That's what caused garbled/partial output (and, since the
 * containing block gets wholesale `innerHTML`-replaced, destroyed sibling
 * markup) on pages like AP News. Filtering with {@link hasBlockedAncestor}
 * per node — the same check {@link walkTextNodes} already applies for every
 * other feature — gives this walk the same node-level backstop instead of
 * relying entirely on the outer block-level check being correct.
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

  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = (node as Text).parentElement
      if (isBonitaUI(parent) || hasBlockedAncestor(parent)) {
        return NodeFilter.FILTER_REJECT
      }
      return NodeFilter.FILTER_ACCEPT
    },
  })
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
 * Matches a bracketed footnote/citation marker like `[35]` or
 * `[citation needed]` — 1 to 20 characters inside square brackets, no
 * nested brackets.
 */
const CITATION_MARKER_RE = /\[[^\[\]]{1,20}\]/g

/**
 * Produces a citation-stripped copy of `normText` for feeding to
 * compromise's sentence segmenter, plus a position map back to the
 * original.
 *
 * **Why this exists:** compromise's segmenter looks for sentence-ending
 * punctuation followed by whitespace. On citation-heavy prose (Wikipedia
 * being the canonical case), a sentence boundary is routinely followed
 * immediately by a footnote marker with no space — `"…capacities.[35]
 * This practice…"` — so the period-then-bracket sequence doesn't read as
 * a boundary at all, and compromise folds two or more real sentences
 * into one. That means {@link findSentenceBoundaries} sees too few
 * sentences and returns no boundaries, and {@link buildSentenceLis} then
 * has nothing to split on even for genuinely multi-sentence, high-density
 * paragraphs.
 *
 * Stripping markers before segmentation and translating the resulting
 * offsets back is preferred over deleting them from `normText` itself —
 * `normText`'s offsets are shared with {@link buildNormMap}'s DOM
 * position map, and citation links are real inline content that should
 * still render in the split output, not be silently dropped.
 *
 * @param normText - Whitespace-collapsed text from {@link buildNormMap}.
 * @returns
 *   - `stripped` — `normText` with every citation marker removed.
 *   - `map` — `map[i]` is `stripped[i]`'s offset in the original
 *     `normText`, so a boundary computed on `stripped` can be translated
 *     back with a single array lookup.
 */
function stripCitationMarkers(normText: string): { stripped: string; map: number[] } {
  const matches: { start: number; end: number }[] = []
  CITATION_MARKER_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = CITATION_MARKER_RE.exec(normText)) !== null) {
    matches.push({ start: m.index, end: m.index + m[0].length })
  }

  const map: number[] = []
  let stripped = ''
  let i = 0
  let mi = 0

  while (i < normText.length) {
    if (mi < matches.length && i === matches[mi].start) {
      i = matches[mi].end
      mi++
      continue
    }
    map.push(i)
    stripped += normText[i]
    i++
  }

  return { stripped, map }
}

/**
 * Translates an offset into {@link stripCitationMarkers}' `stripped` text
 * back into the corresponding offset in the original `normText`.
 *
 * @param strippedPos - Offset into `stripped`. May equal `stripped.length`
 *   (the end-of-text position), which has no entry in `map`.
 * @param map         - Position map from {@link stripCitationMarkers}.
 * @param strippedLen - `stripped.length`.
 * @param normLen     - `normText.length`, returned when `strippedPos` is
 *   the end-of-text position.
 */
function translateOffset(
  strippedPos: number,
  map: number[],
  strippedLen: number,
  normLen: number,
): number {
  return strippedPos >= strippedLen ? normLen : map[strippedPos]
}

/**
 * Runs compromise's sentence segmentation and returns an array of boundary
 * indices into `normText`.
 *
 * `boundaries[i]` is the start of sentence i; `boundaries[i + 1]` is the
 * start of the next sentence (or `normText.length` for the last one).
 *
 * Segmentation itself runs on a citation-marker-stripped copy of
 * `normText` (see {@link stripCitationMarkers}) so a footnote glued
 * directly onto a sentence-ending period — `".[35] Next…"` — doesn't
 * prevent compromise from recognising the boundary. Resulting positions
 * are translated back onto the original `normText` via
 * {@link translateOffset} before anything downstream (including
 * {@link isFalseBoundary}, which needs real `normText` characters, not
 * stripped ones) touches them.
 *
 * False boundaries produced by abbreviation periods are then suppressed
 * by {@link isFalseBoundary} as before.
 *
 * @param normText - Whitespace-collapsed text from {@link buildNormMap}.
 * @returns
 *   An array of at least 2 entries (`[0, …, normText.length]`) when one or
 *   more sentences are detected, or an empty array otherwise.
 */
function findSentenceBoundaries(normText: string): number[] {
  const { stripped, map } = stripCitationMarkers(normText)

  const sentences = (nlp(stripped).sentences().out('array') as string[])
    .map((s: string) => s.trim())
    .filter((s: string) => s.length > 0 && /[A-Za-z0-9]/.test(s))

  if (sentences.length === 0) return []

  const rawStripped: number[] = [0]
  let pos = 0
  for (const s of sentences.slice(0, -1)) {
    pos += s.length
    while (pos < stripped.length && stripped[pos] === ' ') pos++
    rawStripped.push(pos)
  }
  rawStripped.push(stripped.length)

  const raw = rawStripped.map(p => translateOffset(p, map, stripped.length, normText.length))

  const merged: number[] = [0]
  for (let i = 1; i < raw.length - 1; i++) {
    if (isFalseBoundary(normText, raw, i)) continue
    merged.push(raw[i])
  }
  merged.push(normText.length)

  return merged
}

/**
 * Splits `el`'s content into one `<li>` per sentence while preserving all
 * inline HTML (hyperlinks, bold, spans, etc.).
 *
 * A paragraph with only one detected sentence still produces a single
 * one-item list rather than being left as prose — a dense one-sentence
 * paragraph should visually become point-form too, it just has nothing
 * to split *into*, so the "split" is a single `<li>` wrapping the whole
 * sentence.
 *
 * Preservation works by using the DOM Range API to extract each sentence's
 * portion of the live element tree via `range.cloneContents()`. We never
 * assign to `textContent` (which would lose markup) and instead operate
 * directly on text nodes and their ancestor elements.
 *
 * If a Range extraction fails (e.g. detached or cross-shadow-root nodes) the
 * sentence falls back to plain-text content for that `<li>` only.
 *
 * @param el - The paragraph or block element to split.
 * @returns
 *   An array of `<li>` elements (one per detected sentence) when at least
 *   one sentence is found, or `null` if the element has no detectable
 *   sentences or map/boundary data is unavailable.
 */
function buildSentenceLis(el: Element): HTMLLIElement[] | null {
  const { normText, map } = buildNormMap(el)
  if (!normText || map.length === 0) return null

  const boundaries = findSentenceBoundaries(normText)
  if (boundaries.length < 2) return null

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

  return lis.length >= 1 ? lis : null
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Options for {@link applySentenceSplit}. */
export interface ApplySentenceSplitOptions {
  /**
   * Optional pre-computed scores, keyed by exact match against individual
   * **sentence** text (not paragraph text — scoring is now per-sentence).
   * A sentence with a matching entry here skips local scoring and ranking
   * entirely; its `action` is used verbatim. Everything else is scored
   * locally and ranked against every other sentence on the page.
   *
   * @known-issue Two identical sentences on the same page (e.g. a repeated
   *   "Learn more.") share one override entry, since matching is by exact
   *   text with no positional disambiguation. Edge case, not fixed here.
   */
  overrideScores?: ParagraphScore[]

  /**
   * Sensitivity, 1-100, forwarded into {@link selectSplitTargets}. Ranks
   * every sentence on the page (across all eligible paragraphs) as one
   * pool and splits the densest `thresholdPercent`% of them — so `100`
   * means every sentence on the page becomes a bullet, and a paragraph can
   * end up partially bulleted if only some of its sentences make the cut.
   * Defaults to `50`.
   */
  thresholdPercent?: number
}

/**
 * Splits the densest `thresholdPercent`% of **sentences** across the page
 * into bullets, leaving the rest of each paragraph as ordinary prose.
 *
 * Ranking is sentence-level and page-relative, not paragraph-level: every
 * sentence in every eligible paragraph is scored independently and pooled
 * into one ranking, so a single unusually dense sentence in an otherwise
 * plain paragraph can be pulled out on its own, and a paragraph can end up
 * with only some of its sentences bulleted rather than all-or-nothing.
 *
 * Candidate *paragraphs* still come from {@link collectBlockElements} with
 * `minWords: MIN_SPLIT_CANDIDATE_WORDS` and the same structural exclusions
 * as before ({@link isCaptionOrCredit}, {@link isAlreadyPointForm}, etc.) —
 * that floor is about filtering out nav labels and captions before they're
 * even considered, not about sentence count.
 *
 * Pipeline:
 * 1. **Structural filter.** Same as before — narrows `elements` down to
 *    real candidate paragraphs.
 * 2. **Segment.** For each candidate, build its `normText`/position map and
 *    find sentence spans via {@link getSentenceSpans}. Paragraphs with zero
 *    detected sentences are dropped here.
 * 3. **Score.** Every sentence across every candidate paragraph is scored
 *    individually via {@link scoreParagraph} (or takes its override action
 *    verbatim) and flattened into one page-wide list.
 * 4. **Rank.** {@link selectSplitTargets} ranks the whole flattened list by
 *    density and marks the top `thresholdPercent`%.
 * 5. **Rebuild.** Each paragraph with at least one selected sentence is
 *    rewritten via {@link buildMixedContent}; paragraphs with none stay
 *    untouched.
 *
 * Calls {@link removeSentenceSplit} at the start to ensure idempotency.
 *
 * @param opts - See {@link ApplySentenceSplitOptions}.
 */
export async function applySentenceSplit(opts: ApplySentenceSplitOptions = {}): Promise<void> {
  removeSentenceSplit()

  const elements = collectBlockElements({ minWords: MIN_SPLIT_CANDIDATE_WORDS })
  if (elements.length === 0) return

  const baselineIndent = Math.min(...elements.map(getIndent))
  const freq = await getFreqMap()
  const thresholdPercent = opts.thresholdPercent ?? 50

  // ── Pass 1: structural filter ────────────────────────────────────────────
  const eligible: Element[] = []
  for (const el of elements) {
    if (shouldSkip(el)) continue
    if (el.classList.contains(MARKER_CLASS)) continue
    if (isCaptionOrCredit(el)) continue
    if (isAlreadyPointForm(el, baselineIndent)) continue
    if (!(el.textContent ?? '').trim()) continue
    eligible.push(el)
  }
  if (eligible.length === 0) return

  // ── Pass 2: segment each paragraph into sentence spans ───────────────────
  interface ElementSentences {
    el: Element
    normText: string
    map: TextPosition[]
    spans: SentenceSpan[]
  }
  const perElement: ElementSentences[] = []
  for (const el of eligible) {
    const { normText, map } = buildNormMap(el)
    if (!normText || map.length === 0) continue
    const spans = getSentenceSpans(normText)
    if (spans.length === 0) continue
    perElement.push({ el, normText, map, spans })
  }
  if (perElement.length === 0) return

  // ── Pass 3: score every sentence, flattened across all paragraphs ────────
  interface FlatSentence {
    elementIdx: number
    spanIdx: number
    text: string
  }
  const flat: FlatSentence[] = []
  perElement.forEach((pe, elementIdx) => {
    pe.spans.forEach((span, spanIdx) => {
      const text = pe.normText.slice(span.start, span.end).trim()
      if (text) flat.push({ elementIdx, spanIdx, text })
    })
  })
  if (flat.length === 0) return

  const overriddenActions = new Map<number, ParagraphScore['action']>()
  const scored: ScoredParagraph[] = []
  for (let i = 0; i < flat.length; i++) {
    const override = opts.overrideScores?.find(s => s.text === flat[i].text)
    if (override) {
      overriddenActions.set(i, override.action)
      scored.push({ text: flat[i].text, action: override.action })
    } else {
      scored.push(await scoreParagraph(flat[i].text, freq))
    }
  }

  // ── Pass 4: rank the non-overridden sentences, merge with overrides ──────
  const toRank = scored.filter((_, i) => !overriddenActions.has(i))
  const ranked = selectSplitTargets(toRank, thresholdPercent)

  let rankedCursor = 0
  const finalActions: ParagraphScore['action'][] = scored.map((_, i) => {
    if (overriddenActions.has(i)) return overriddenActions.get(i)!
    return ranked[rankedCursor++].action
  })

  // ── Pass 5: regroup selections per element, rebuild each affected one ────
  const selectedByElement: boolean[][] = perElement.map(pe => new Array(pe.spans.length).fill(false))
  flat.forEach((f, i) => {
    if (finalActions[i] === 'split') selectedByElement[f.elementIdx][f.spanIdx] = true
  })

  perElement.forEach((pe, elementIdx) => {
    const selected = selectedByElement[elementIdx]
    if (!selected.some(Boolean)) return

    const fragment = buildMixedContent(pe.normText, pe.map, pe.spans, selected)
    if (!fragment) return

    pe.el.setAttribute(ORIGINAL_ATTR, pe.el.innerHTML)
    pe.el.classList.add(MARKER_CLASS)
    pe.el.innerHTML = ''
    pe.el.appendChild(fragment)
  })
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