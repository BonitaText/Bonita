/**
 * @file content/utils/posHighlighter.ts
 *
 * Part-of-speech (POS) highlighting for page content.
 *
 * Walks the document body with a TreeWalker, parses each eligible text node
 * with the `compromise` NLP library, and wraps recognised verbs, nouns, and
 * adjectives in lightweight `<span>` elements that carry a coloured underline
 * and background tint. A small CSS badge (`v`, `n`, `a`) is rendered via a
 * `::before` pseudo-element so it is invisible to screen readers, TTS engines,
 * and clipboard copy.
 *
 * ## Entry points
 *   - {@link applyPOSHighlight} — runs a fresh highlight pass; automatically
 *     removes any previous pass first.
 *   - {@link removePOSHighlight} — strips all wrapper spans and the shared
 *     `<style>` tag, restoring the DOM to its original state.
 *
 * ## Filtering
 * Only content inside {@link ALLOWED_TEXT_TAGS} is considered, and text nodes
 * inside {@link BLOCKED_TAGS} (script, code, nav, etc.) or the extension's own
 * UI chrome (`#bonita-root`, `.bonita-dock`, …) are always skipped. Text nodes
 * shorter than 30 characters are also ignored to reduce noise on labels and
 * button text.
 *
 * Function words (pronouns, determiners, conjunctions, prepositions,
 * auxiliaries, copulas, modals, negatives) and words with fewer than 4
 * alphabetic characters are excluded from highlighting regardless of their
 * POS tag. Among the remaining terms, the priority order is:
 * verb → adjective → noun (matching the first enabled category).
 *
 * ## Accessibility
 * The POS label character is generated exclusively by CSS `content: attr(data-label)`
 * on the `::before` pseudo-element — no DOM text node exists for it. The
 * `speak: none` CSS rule and the absence of any `aria-*` attribute mean the
 * label is never read aloud and never appears in clipboard selections.
 *
 * ## Style injection
 * A single `<style id="bonita-pos-styles">` tag is injected into `<head>` on
 * the first call to {@link applyPOSHighlight} and removed by
 * {@link removePOSHighlight}. Calling `applyPOSHighlight` more than once
 * without an intervening removal is safe — the style tag is only created once
 * and colour values are read from `--pos-color` CSS custom properties set
 * inline on each span.
 */
import nlp from 'compromise'

const MARKER_CLASS = 'bonita-pos-wrapper'
const STYLE_ID = 'bonita-pos-styles'

type POSTag = 'verbs' | 'nouns' | 'adjectives'

interface POSColors {
  verbs: string
  nouns: string
  adjectives: string
}

interface POSEnabled {
  verbs: boolean
  nouns: boolean
  adjectives: boolean
}

// Indicator labels for colourblind accessibility — rendered via ::before so
// they exist only in CSS paint, never as DOM text nodes. TTS engines cannot
// read them regardless of aria support.
const POS_LABEL: Record<POSTag, string> = {
  verbs: 'v',
  nouns: 'n',
  adjectives: 'a',
}

// Highlight background colours (softer than solid text colour)
const HIGHLIGHT_ALPHA = '33' // hex ~20% opacity suffix

const ALLOWED_TEXT_TAGS = new Set([
  'p', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'blockquote', 'article', 'main', 'section', 'div', 'span',
])

const BLOCKED_TAGS = new Set([
  'script', 'style', 'noscript', 'textarea', 'input',
  'code', 'pre', 'nav', 'header', 'footer', 'aside',
  'button', 'table', 'select', 'svg',
])

/**
 * Injects a single `<style>` tag that drives the POS label badges via
 * `::before` pseudo-elements.
 *
 * Using a pseudo-element means the label character (`v`, `n`, `a`) is
 * generated entirely in CSS paint — it has no DOM text node and is therefore
 * completely invisible to TTS engines, clipboard copy, and `textContent` reads,
 * even in engines that ignore `aria-hidden`. The colour is read from the
 * `--pos-color` CSS custom property set inline on each wrapper span, so no
 * additional style injection is needed when the user changes colours.
 *
 * Calling this function more than once is safe — it exits early if the tag
 * already exists.
 */
function injectPOSStyles() {
  if (document.getElementById(STYLE_ID)) return

  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
    .${MARKER_CLASS} {
      position: relative;
      display: inline;
      border-radius: 3px;
      padding: 0 1px;
    }
    .${MARKER_CLASS}::before {
      content: attr(data-label);
      position: absolute;
      top: -0.6em;
      left: 0;
      font-size: 0.55em;
      font-weight: 700;
      line-height: 1;
      font-family: monospace;
      color: var(--pos-color);
      opacity: 0.85;
      pointer-events: none;
      speak: none;
    }
  `
  document.head.appendChild(style)
}

/**
 * Removes the `<style>` tag injected by {@link injectPOSStyles}, if present.
 * Called as part of {@link removePOSHighlight} to fully clean up after a
 * highlighting pass.
 */
function removePOSStyles() {
  document.getElementById(STYLE_ID)?.remove()
}

/**
 * Determines the highlighted POS category for a given word.
 *
 * Filters out function words (pronouns, determiners, conjunctions, prepositions,
 * auxiliaries, copulas, modals, negatives) and short words under 4 alphabetic
 * characters, then maps the remaining terms to whichever enabled category —
 * verb, adjective, or noun — applies first.
 *
 * @param tags     The tag map or tag array returned by compromise for this term.
 * @param word     The raw word string, used to enforce the minimum length check.
 * @param enabled  Which POS categories are currently active in the UI.
 * @returns        The matching {@link POSTag}, or `null` if the word should not be highlighted.
 */
function pickTag(tags: any, word: string, enabled: POSEnabled): POSTag | null {
  if (!tags) return null
  const has = (t: string) =>
    Array.isArray(tags) ? tags.includes(t) : Boolean(tags[t])

  if (has('Pronoun') || has('Determiner') || has('Conjunction')
      || has('Preposition') || has('Auxiliary') || has('Copula')
      || has('Modal') || has('Negative')) {
    return null
  }

  if (word.replace(/[^a-zA-Z]/g, '').length < 4) return null

  if (enabled.verbs && has('Verb')) return 'verbs'
  if (enabled.adjectives && has('Adjective')) return 'adjectives'
  if (enabled.nouns && has('Noun')) return 'nouns'
  return null
}

/**
 * Escapes a plain string so it is safe to inject into an HTML context.
 *
 * Replaces the characters that have special meaning in HTML
 * (`&`, `<`, `>`, `"`) with their corresponding named entities.
 * Used to sanitise word and whitespace tokens before building the
 * highlight markup string.
 *
 * @param s  The raw string to escape.
 * @returns  The escaped string, safe for insertion into an HTML attribute or text node.
 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Determines whether a text node's parent element should be excluded from POS highlighting.
 *
 * Returns `true` (skip) in any of these cases:
 * - The parent is `null`.
 * - The parent is inside Bonita's own UI chrome (`#bonita-root`, `.bonita-dock`, etc.).
 * - Any ancestor element is in {@link BLOCKED_TAGS} (e.g. `<script>`, `<code>`, `<nav>`).
 * - No ancestor element is in {@link ALLOWED_TEXT_TAGS}, meaning the text sits outside
 *   recognised prose containers.
 *
 * @param parent  The direct parent `Element` of the text node being evaluated, or `null`.
 * @returns       `true` if the text node should be skipped, `false` if it should be highlighted.
 */
function shouldSkip(parent: Element | null): boolean {
  if (!parent) return true
  if (parent.closest('#bonita-root, .bonita-dock, .bonita-trigger, .bonita-font-popup')) {
    return true
  }
  let inAllowed = false
  let cursor: Element | null = parent
  while (cursor) {
    const tag = cursor.tagName.toLowerCase()
    if (BLOCKED_TAGS.has(tag)) return true
    if (ALLOWED_TEXT_TAGS.has(tag)) inAllowed = true
    cursor = cursor.parentElement
  }
  return !inAllowed
}

/**
 * Walks the document body and wraps recognised POS terms in highlight spans.
 *
 * For each eligible text node (determined by {@link shouldSkip} and a minimum
 * length threshold), the text is parsed with compromise and each term is tested
 * against the enabled categories. Matching terms are replaced with a `<span>`
 * that carries a coloured underline/background. The POS label badge (`v`, `n`,
 * `a`) is rendered exclusively via a CSS `::before` pseudo-element — it has no
 * DOM text node and is therefore invisible to TTS engines, clipboard copy, and
 * `textContent` reads. Any previous highlight pass is removed first via
 * {@link removePOSHighlight}.
 *
 * @param colors   Hex colour strings for each POS category, sourced from user settings.
 * @param enabled  Which POS categories should be highlighted in this pass.
 */
export function applyPOSHighlight(colors: POSColors, enabled: POSEnabled) {
  removePOSHighlight()
  if (!enabled.verbs && !enabled.nouns && !enabled.adjectives) return

  injectPOSStyles()

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      if (shouldSkip(node.parentElement)) return NodeFilter.FILTER_REJECT
      if (!node.textContent || node.textContent.trim().length < 30) return NodeFilter.FILTER_REJECT
      return NodeFilter.FILTER_ACCEPT
    },
  })

  const textNodes: Text[] = []
  let current: Node | null
  while ((current = walker.nextNode())) {
    textNodes.push(current as Text)
  }

  for (const textNode of textNodes) {
    const text = textNode.textContent || ''
    if (text.trim().length < 3) continue

    const doc = nlp(text)
    const sentences: any[] = doc.json({ terms: { text: true, tags: true, whitespace: true } })

    let html = ''
    let touched = false

    for (const sentence of sentences) {
      for (const term of sentence.terms || []) {
        const pre = escapeHtml(term.pre || '')
        const post = escapeHtml(term.post || '')
        const word = escapeHtml(term.text || '')
        const tag = pickTag(term.tags, term.text || '', enabled)

        if (tag) {
          const color = colors[tag]
          const label = POS_LABEL[tag]
          // The label is rendered by CSS ::before using data-label and --pos-color.
          // No child text node exists for it, so TTS and clipboard see only the word.
          html += `${pre}<span
            class="${MARKER_CLASS}"
            data-pos="${tag}"
            data-label="${label}"
            style="
              --pos-color: ${color};
              background-color: ${color}${HIGHLIGHT_ALPHA};
              border-bottom: 2px solid ${color};
            ">${word}</span>${post}`
          touched = true
        } else {
          html += pre + word + post
        }
      }
    }

    if (!touched) continue

    const tmp = document.createElement('span')
    tmp.innerHTML = html
    const fragment = document.createDocumentFragment()
    while (tmp.firstChild) fragment.appendChild(tmp.firstChild)
    textNode.replaceWith(fragment)
  }
}

/**
 * Removes all POS highlight spans injected by {@link applyPOSHighlight} and
 * cleans up the shared `<style>` tag.
 *
 * Each wrapper span is replaced with a plain `Text` node containing its
 * `textContent` (the word only — the `::before` label never appears there).
 * All modified parent elements are then normalised to merge any adjacent text
 * nodes left behind by the replacements.
 */
export function removePOSHighlight() {
  const wrappers = document.querySelectorAll(`.${MARKER_CLASS}`)
  const parents = new Set<Element>()
  wrappers.forEach((wrapper) => {
    if (wrapper.parentElement) parents.add(wrapper.parentElement)
    wrapper.replaceWith(document.createTextNode(wrapper.textContent || ''))
  })
  parents.forEach((p) => p.normalize())
  removePOSStyles()
}