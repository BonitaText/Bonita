/**
 * @file utils/phraseBolder.ts
 *
 * DOM manipulation layer for keyword bolding.
 * Applies whatever terms phraseExtractor provides — no filtering here.
 *
 * Noun phrase expansion:
 *   After matching a seed term, expands in both directions to include:
 *   - Hyphen compounds:      "well-known", "anti-inflammatory"
 *   - Possessive chains:     "WHO's Global Seasonal Update"
 *                            (handles both ASCII ' and Unicode ' U+2019)
 *   - Proper noun chains:    "United Nations Security Council" (left AND right)
 *
 * Expansion guards:
 *   - Does NOT expand through lowercase prepositions/conjunctions
 *   - Does NOT treat sentence-start capitals as proper nouns
 *   - Does NOT break on "Dr." "Mr." "vs." style abbreviations
 *   - Does NOT consume determiners/articles (The, A, An) even mid-sentence
 *
 * Citation detection:
 *   Uses the full text content of the nearest block-level ancestor rather than
 *   the individual text node's content. This is critical because:
 *
 *   1. Inline elements (<a>, <em>, <sup>, etc.) split a single logical sentence
 *      into multiple text nodes — the opening '(' of a citation may land in a
 *      different node from the author name being tested.
 *
 *   2. When a text node is itself inside an inline element (e.g. the text of an
 *      <a> link), its immediate parentElement is that inline element, whose
 *      textContent contains only the link text — not the surrounding sentence.
 *      Walking up to the nearest block ancestor ensures the full sentence context
 *      is always available to isInCitation.
 *
 *   See getBlockAncestor, getTextNodeOffset, and boldTextNode.
 */
// Cached stop word set — loaded once, same asset as phraseExtractor

let stopWords: Set<string> | null = null

async function getStopWords(): Promise<Set<string>> {
  if (stopWords) return stopWords
  const data = await import('../../assets/stopWords.en.json').then(m => m.default) as { stopWords: string[] }
  stopWords = new Set(data.stopWords.map(w => w.toLowerCase()))
  return stopWords
}

const MARKER_CLASS = 'bonita-phrase-bold'

const BLOCKED_TAGS = new Set([
  'script', 'style', 'noscript', 'textarea', 'input',
  'code', 'pre', 'nav', 'header', 'footer', 'aside',
  'button', 'table', 'select', 'svg',
])

// Block-level tags used to find the nearest sentence-containing ancestor.
// Inline elements like <a>, <em>, <sup>, <span> are intentionally absent.
const BLOCK_TAGS = new Set([
  'p', 'div', 'li', 'td', 'th', 'blockquote', 'section',
  'article', 'main', 'header', 'footer', 'aside', 'h1', 'h2',
  'h3', 'h4', 'h5', 'h6', 'dt', 'dd', 'figcaption',
])

// Prepositions/conjunctions that break a proper noun chain.
const CHAIN_BREAKERS = new Set([
  'in','on','at','by','to','of','or','and','but','for',
  'nor','yet','so','as','if','than','then','when','where',
  'with','from','into','onto','upon','over','under','after',
  'before','since','until','while','about','against','between',
  'through','during','without','within','along','across','behind',
  'beyond','except','toward','towards','around','among','per',
])

// Known title abbreviations that end with "." but don't end a sentence.
const TITLE_ABBREVS = new Set([
  'dr','mr','mrs','ms','prof','sr','jr','vs','etc','inc','ltd',
  'dept','est','vol','no','fig','ref','approx','govt','al',
])

// Determiners/articles that should NEVER be consumed by leftward expansion
// even when capitalised (e.g. "The" at the start of a sentence mid-paragraph).
const DETERMINERS = new Set(['the', 'a', 'an', 'this', 'that', 'these', 'those'])

// Skips Bonita UI elements, blocked HTML tags, and already-bolded spans
function shouldSkip(parent: Element | null): boolean {
  if (!parent) return true
  if (parent.closest('#bonita-root, .bonita-dock, .bonita-trigger, .bonita-font-popup, .bonita-pos-popup')) return true
  if (parent.closest(`.${MARKER_CLASS}`)) return true
  let cursor: Element | null = parent
  while (cursor) {
    if (BLOCKED_TAGS.has(cursor.tagName.toLowerCase())) return true
    cursor = cursor.parentElement
  }
  return false
}

/**
 * Determines whether position `pos` in `text` immediately follows a sentence
 * boundary (a newline, or `.` `!` `?` that is not part of a known abbreviation).
 *
 * Used by expansion guards to prevent proper-noun chaining from crossing
 * sentence boundaries.
 *
 * @param text - Full text of the containing element.
 * @param pos  - Character index of the word being examined.
 */
function isSentenceBoundary(text: string, pos: number): boolean {
  const before = text.slice(0, pos)
  const trimmed = before.trimEnd()
  if (trimmed.length === 0) return true

  const lastChar = trimmed[trimmed.length - 1]

  if (/[\n\r]/.test(before.slice(trimmed.length))) return true

  if (lastChar !== '.' && lastChar !== '!' && lastChar !== '?') return false

  if (lastChar === '.') {
    const wordBefore = trimmed.slice(0, -1).match(/([a-zA-Z]+)$/)
    if (wordBefore && TITLE_ABBREVS.has(wordBefore[1].toLowerCase())) {
      return false
    }
  }

  return true
}

/**
 * Walks leftward from `start`, consuming hyphen-prefixed words and preceding
 * proper nouns to expand a seed match into a full noun phrase.
 *
 * Stops at chain-breaking prepositions, sentence boundaries, and determiners.
 *
 * @param text  - Full text content of the node.
 * @param start - Start index of the already-matched seed term.
 * @returns New start index after leftward expansion.
 */
function expandLeft(text: string, start: number): number {
  let cursor = start

  while (cursor > 0) {
    const before = text.slice(0, cursor)

    if (before[before.length - 1] === '-') {
      const prevWord = before.slice(0, -1).match(/([a-zA-Z][a-zA-Z]*)$/)
      if (prevWord) {
        cursor -= prevWord[0].length + 1
        continue
      }
      break
    }

    const prevProper = before.match(/([A-Z][a-zA-Z'-]+)\s+$/)
    if (prevProper) {
      const word = prevProper[1]
      const wordStart = cursor - prevProper[0].length

      if (DETERMINERS.has(word.toLowerCase())) break
      if (isSentenceBoundary(text, wordStart)) break
      if (CHAIN_BREAKERS.has(word.toLowerCase())) break

      cursor = wordStart
      continue
    }

    break
  }

  return cursor
}

/**
 * Walks rightward from `end`, consuming capitalised proper-noun chains,
 * possessives, hyphen continuations, and `"of"` bridges.
 *
 * @param text - Full text content of the node.
 * @param end  - End index of the already-matched seed term.
 * @returns New end index after rightward expansion.
 */
function expandNounPhrase(text: string, end: number): number {
  let cursor = end

  while (cursor < text.length) {
    const remaining = text.slice(cursor)

    const hyphenWord = remaining.match(/^-([a-zA-Z][a-zA-Z'-]*)/)
    if (hyphenWord) {
      cursor += hyphenWord[0].length
      continue
    }

    const possessive = remaining.match(/^['\u2019]s\s+([A-Z][a-zA-Z'-]*)/)
    if (possessive) {
      cursor += possessive[0].length
      continue
    }

    const nextWord = remaining.match(/^(\s+)([A-Za-z][a-zA-Z'-]*)/)
    if (nextWord) {
      const word = nextWord[2]
      const wordStart = cursor + nextWord[1].length

      if (CHAIN_BREAKERS.has(word.toLowerCase())) break
      if (!/^[A-Z]/.test(word)) break
      if (DETERMINERS.has(word.toLowerCase())) break
      if (isSentenceBoundary(text, wordStart)) break

      cursor += nextWord[0].length
      continue
    }

    const bridge = remaining.match(/^(\s+)(of|the)\s+([A-Z][a-zA-Z'-]*)/)
    if (bridge) {
      if (bridge[2].toLowerCase() === 'the') break
      cursor += bridge[0].length
      continue
    }

    break
  }

  return cursor
}

/**
 * Trims stop words from the left and right edges of a matched span.
 * Stop words interior to a phrase (e.g. "of" in "National Institute of Health")
 * are preserved — only edge tokens are removed.
 *
 * @param text  - Full text content of the node.
 * @param start - Start index of the expanded span.
 * @param end   - End index of the expanded span.
 * @param stops - The loaded stop-word set.
 * @returns Adjusted [start, end] indices with stop word edges trimmed.
 */
function trimStopWordEdges(
  text: string,
  start: number,
  end: number,
  stops: Set<string>,
): [number, number] {
  let s = start
  let e = end

  // Trim left edge — advance past leading stop word tokens
  while (s < e) {
    const slice = text.slice(s, e)
    const leadingMatch = slice.match(/^([a-zA-Z'-]+)(\s*)/)
    if (!leadingMatch) break
    const originalToken = leadingMatch[1]

    // Don't trim acronyms like WHO, DNA, USA
    if (originalToken !== originalToken.toLowerCase()) break

    const token = originalToken.toLowerCase()
    if (!stops.has(token)) break
    s += leadingMatch[0].length
  }

  // Trim right edge — retreat past trailing stop word tokens
  while (e > s) {
    const slice = text.slice(s, e)
    const trailingMatch = slice.match(/(\s*)([a-zA-Z'-]+)$/)
    if (!trailingMatch) break
    const originalToken = trailingMatch[2]

    // Don't trim acronyms like WHO, DNA, USA
    if (originalToken !== originalToken.toLowerCase()) break

    const token = originalToken.toLowerCase()
    if (!stops.has(token)) break
    e -= trailingMatch[0].length
  }

  return [s, e]
}

/**
 * Returns the nearest block-level ancestor of `el` (inclusive), or `el`
 * itself when it is already a block element.
 *
 * "Block-level" here means an element that contains a full sentence — `<p>`,
 * `<div>`, `<li>`, heading tags, etc. Inline elements like `<a>`, `<em>`, and
 * `<sup>` are excluded.
 *
 * This is used by {@link boldTextNode} to obtain the correct context element
 * for {@link getTextNodeOffset} and {@link isInCitation}. Without walking up
 * to the block ancestor, a text node inside `<a>Louvi 2012</a>` would have
 * `parentElement === <a>`, whose `textContent` is only the link text — the
 * surrounding `(…)` citation boundary would be invisible to the scan.
 *
 * @param el - Starting element (typically `textNode.parentElement`).
 * @returns The nearest block ancestor, or `document.body` as a fallback.
 */
function getBlockAncestor(el: Element | null): Element {
  let cursor: Element | null = el
  while (cursor) {
    if (BLOCK_TAGS.has(cursor.tagName.toLowerCase())) return cursor
    cursor = cursor.parentElement
  }
  return document.body
}

/**
 * Computes the character offset of `textNode` within the full text content
 * of `blockParent` by walking all descendant text nodes in document order.
 *
 * Using a block ancestor (rather than the immediate `parentElement`) is
 * essential when text nodes live inside inline elements. For example:
 *
 * ```html
 * <p>diseases (<a>Louvi 2012</a>; Yamamoto et al. 2014b).</p>
 * ```
 *
 * The text node `"Louvi 2012"` has `parentElement === <a>`. Walking only
 * `<a>`'s children would give an offset of `0` relative to a context string
 * of `"Louvi 2012"` — the opening `(` is never seen. Walking from `<p>`
 * gives the correct offset within the full sentence, so `isInCitation` can
 * find both `(` and `)`.
 *
 * @param textNode    - The text node whose offset is needed.
 * @param blockParent - The block ancestor returned by {@link getBlockAncestor}.
 * @returns Character offset from the start of `blockParent`'s text content.
 */
function getTextNodeOffset(textNode: Text, blockParent: Element): number {
  let offset = 0
  const walker = document.createTreeWalker(blockParent, NodeFilter.SHOW_TEXT)
  let node: Node | null
  while ((node = walker.nextNode())) {
    if (node === textNode) return offset
    offset += (node.textContent ?? '').length
  }
  return offset
}

/**
 * Returns `true` when the matched phrase sits inside a citation context
 * and should be skipped.
 *
 * Detected patterns:
 *   1. Inside `(…)` containing a 4-digit year (`19xx` or `20xx`).
 *   2. Inside `(…)` containing `"et al"`.
 *
 * Non-citation parentheticals like `"(Figure 1A)"` or `"(see Methods)"` are
 * intentionally NOT blocked — they contain no year and no `"et al"`.
 *
 * **Important — split text nodes and inline parents:** `text` must be the
 * full text content of the nearest **block-level** ancestor (e.g. the `<p>`),
 * not the immediate parent element or the text node itself. Two failure modes
 * are prevented by this:
 *
 * - *Sibling split*: `(` lives in one text node, author name in another
 *   (separated by an `<a>`, `<em>`, etc.). Node-local scan never sees `(`.
 *
 * - *Inline parent*: the text node is the content of an inline element
 *   (`<a>Louvi 2012</a>`). Its `parentElement.textContent` is only the link
 *   text — `(` is in a sibling of `<a>`, invisible unless we walk from `<p>`.
 *
 * See {@link getBlockAncestor}, {@link getTextNodeOffset}, and
 * {@link boldTextNode}.
 *
 * @param text        - Full text of the nearest **block ancestor**.
 * @param phraseStart - Start of the expanded phrase, offset relative to `text`.
 * @param phraseEnd   - End of the expanded phrase, offset relative to `text`.
 */
function isInCitation(text: string, phraseStart: number, phraseEnd: number): boolean {
  // ── Step 1: scan LEFT for '(' ───────────────────────────────────────────
  // Walk character by character from just before the phrase.
  // If we hit a ')' before any '(' we are outside a closed group — bail.
  let openParen = -1
  for (let i = phraseStart - 1; i >= 0; i--) {
    const ch = text[i]
    if (ch === '(') { openParen = i; break }
    if (ch === ')') return false
  }
  if (openParen === -1) return false

  // ── Step 2: scan RIGHT for ')' ──────────────────────────────────────────
  // Walk forward from the end of the phrase.
  // If we hit another '(' first the parens are nested/broken — bail.
  let closeParen = -1
  for (let i = phraseEnd; i < text.length; i++) {
    const ch = text[i]
    if (ch === ')') { closeParen = i; break }
    if (ch === '(') return false
  }
  if (closeParen === -1) return false

  // ── Step 3: creep LEFT from ')' for a 4-digit year ─────────────────────
  // Skip any trailing non-digit suffix (e.g. the 'b' in "2014b"),
  // then collect the digit run leftward.
  //
  //   "...Yamamoto et al. 2014b)"
  //                           ^── closeParen
  //   skip 'b'  → land on '4'
  //   collect ← : '4','1','0','2'  → "2014"  ✓
  let pos = closeParen - 1
  while (pos > openParen && !/\d/.test(text[pos])) pos--
  const digitEnd = pos
  while (pos > openParen && /\d/.test(text[pos - 1])) pos--
  const digitRun = text.slice(pos, digitEnd + 1)
  if (digitRun.length === 4 && /^(19|20)\d{2}$/.test(digitRun)) return true

  // ── Step 4: fallback — "et al" anywhere inside the parens ──────────────
  const content = text.slice(openParen + 1, closeParen)
  if (/\bet\s+al\b/i.test(content)) return true

  return false
}

/**
 * Applies bold spans to a single text node for all seed pattern matches.
 *
 * Citation detection is performed against the **full text of the nearest
 * block-level ancestor** rather than the immediate parent element or text
 * node in isolation. Two cases require this:
 *
 * 1. *Sibling split* — the `(` of a citation is in a preceding sibling text
 *    node (separated by an inline element). Walking only the immediate parent
 *    misses it.
 *
 * 2. *Inline parent* — the text node lives inside `<a>Author 2012</a>`.
 *    `parentElement` is `<a>`; its `textContent` is only the link text. The
 *    surrounding `(…)` is in a sibling of `<a>`, visible only from `<p>`.
 *
 * {@link getBlockAncestor} finds the right context element. {@link getTextNodeOffset}
 * then computes the correct offset of this node within that element's full text,
 * so positions passed to {@link isInCitation} are block-relative.
 *
 * @param textNode    - The text node to process.
 * @param seedPattern - Global regex built from the sorted bold targets.
 */
function boldTextNode(textNode: Text, seedPattern: RegExp, stops: Set<string>) {
  const text = textNode.textContent ?? ''
  const fragment = document.createDocumentFragment()
  let lastIndex = 0
  let touched = false

  // Walk up to the nearest block ancestor so isInCitation always operates
  // on the full sentence, regardless of how many inline elements split it
  // or whether this node's immediate parent is an inline element like <a>.
  const blockParent = getBlockAncestor(textNode.parentElement)
  const fullBlockText = blockParent.textContent ?? text
  const nodeOffset = getTextNodeOffset(textNode, blockParent)

  seedPattern.lastIndex = 0

  let match: RegExpExecArray | null
  while ((match = seedPattern.exec(text)) !== null) {
    const seedStart = match.index
    const seedEnd = seedStart + match[0].length

    const expandedStart = Math.max(lastIndex, expandLeft(text, seedStart))
    const expandedEnd = expandNounPhrase(text, seedEnd)
    const [phraseStart, phraseEnd] = trimStopWordEdges(text, expandedStart, expandedEnd, stops)
  
    if (phraseStart >= phraseEnd) {
      seedPattern.lastIndex = phraseEnd
      continue
    }
    // Translate to block-relative offsets for citation detection.
    if (isInCitation(fullBlockText, nodeOffset + phraseStart, nodeOffset + phraseEnd)) {
      seedPattern.lastIndex = phraseEnd
      continue
    }

    if (phraseStart > lastIndex) {
      fragment.appendChild(document.createTextNode(text.slice(lastIndex, phraseStart)))
    }

    const span = document.createElement('span')
    span.className = MARKER_CLASS
    span.style.cssText = 'font-weight: 800; color: var(--bonita-bold-color, #3e236b);'
    span.textContent = text.slice(phraseStart, phraseEnd)
    fragment.appendChild(span)

    touched = true
    lastIndex = phraseEnd
    seedPattern.lastIndex = phraseEnd
  }

  if (!touched) return

  if (lastIndex < text.length) {
    fragment.appendChild(document.createTextNode(text.slice(lastIndex)))
  }

  textNode.replaceWith(fragment)
}

// Returns the best semantic root element (main, article, etc.) or document.body
function getContentRoot(): Element {
  const selectors = ['main', 'article', '[role="main"]', '#content', '.content']
  for (const sel of selectors) {
    const el = document.querySelector(sel)
    if (el) return el
  }
  return document.body
}

/**
 * Walks every text node in the page's content root and wraps matches of
 * `boldTargets` in `<span class="bonita-phrase-bold">` elements.
 *
 * - Removes any existing bolding before re-applying (idempotent).
 * - Sorts targets longest-first to prevent partial-match conflicts.
 * - Expands each match into a full noun phrase via {@link expandLeft} /
 *   {@link expandNounPhrase}.
 * - Skips matches inside citations, Bonita UI nodes, and blocked HTML tags.
 *
 * **Word boundary lookahead:** the regex pattern for single-word targets
 * uses `(?=[\s\-.,;:!?()\[\]]|$)` so that words immediately before or after
 * parentheses (e.g. `"Methods)"` or `"(Figure"`) are matched correctly.
 * Without `)` in the lookahead, a word like `"Methods"` immediately followed
 * by `)` would never match, causing non-citation parentheticals like
 * `"(see Methods)"` to silently suppress the keyword.
 *
 * **Citation detection across split nodes:** inline elements inside a
 * paragraph (`<a>`, `<em>`, `<sup>`, etc.) cause `createTreeWalker` to
 * visit multiple text nodes for what is logically one sentence, and author
 * names inside `<a>` links have the link as their immediate parent rather than
 * the `<p>`. Citation detection therefore uses the full text of the nearest
 * block-level ancestor, with phrase positions translated to block-relative
 * offsets. See {@link getBlockAncestor}, {@link getTextNodeOffset}, and
 * {@link isInCitation}.
 *
 * @param boldTargets - List of keyword strings to bold, as returned by phraseExtractor.
 */
/**
 * Walks each body paragraph independently, ranks the provided scored terms
 * by their score within that paragraph, applies the percentage threshold,
 * and bolds the top terms found in that paragraph's text nodes.
 *
 * Per-paragraph ranking means a term that dominates one paragraph gets bolded
 * there even if it's globally mid-ranked, and a globally high-ranked term
 * that barely appears in a paragraph may not be bolded there.
 *
 * Stop word edges are trimmed from every expanded span so that function words
 * are never bolded at the boundary of a phrase.
 *
 * @param scored          - Full ranked term list from extractKeywords.
 * @param thresholdPercent - Percentage (1–100) of each paragraph's matched
 *                           terms to bold. 50 = top half per paragraph.
 */
export async function applyPhraseBolding(
  scored: Array<{ term: string; score: number }>,
  thresholdPercent: number,
) {
  removePhraseBolding()
  if (scored.length === 0) return

  const stops = await getStopWords()

  // Find all body paragraphs in the content root
  const root = getContentRoot()
  const paragraphs = Array.from(root.querySelectorAll('p')).filter(
    el => !shouldSkip(el)
  )

  for (const para of paragraphs) {
    const paraText = (para.textContent ?? '').toLowerCase()

    // Find which scored terms actually appear in this paragraph,
    // preserving their global score for ranking
    const present = scored.filter(({ term }) =>
      new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(paraText)
    )

    if (present.length === 0) continue

    // Sort by score descending and cut at threshold
    const sorted = [...present].sort((a, b) => b.score - a.score)
    const cutoff = Math.max(1, Math.ceil(sorted.length * (thresholdPercent / 100)))
    const targets = sorted.slice(0, cutoff)

    // Build pattern for this paragraph's terms only
    const sortedByLength = [...targets].sort((a, b) => b.term.length - a.term.length)
    const parts = sortedByLength.map(({ term }) => {
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      if (term.includes(' ')) return escaped
      return `\\b${escaped}(?:['\u2019]s)?(?=[\\s\\-.,;:!?()[\\]]|$)`
    })

    const pattern = new RegExp(`(${parts.join('|')})`, 'gi')

    // Walk only this paragraph's text nodes
    const walker = document.createTreeWalker(para, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        if (shouldSkip(node.parentElement)) return NodeFilter.FILTER_REJECT
        if (!/[A-Za-z]/.test(node.textContent ?? '')) return NodeFilter.FILTER_REJECT
        return NodeFilter.FILTER_ACCEPT
      },
    })

    const textNodes: Text[] = []
    let current: Node | null
    while ((current = walker.nextNode())) textNodes.push(current as Text)

    for (const textNode of textNodes) {
      boldTextNode(textNode, pattern, stops)
    }
  }
}

/**
 * Removes all `<span class="bonita-phrase-bold">` elements from the DOM,
 * replacing each with its plain text content and normalising the parent
 * node to merge any adjacent text nodes left behind.
 */
export function removePhraseBolding() {
  const wrappers = document.querySelectorAll(`.${MARKER_CLASS}`)
  const parents = new Set<Element>()
  wrappers.forEach((wrapper) => {
    if (wrapper.parentElement) parents.add(wrapper.parentElement)
    wrapper.replaceWith(document.createTextNode(wrapper.textContent ?? ''))
  })
  parents.forEach((parent) => parent.normalize())
}