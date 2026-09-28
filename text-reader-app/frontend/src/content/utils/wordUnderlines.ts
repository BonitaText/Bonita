/**
 * @file content/utils/wordUnderlines.ts
 *
 * Underlines "complex" words in the page content and shows a synonym /
 * definition popup on hover.
 *
 * ## Entry points
 *   - {@link applyWordUnderlines} — walks the content root, scores every unique
 *     word token via `scoreComplexity`, and wraps qualifying words in underline
 *     spans with hover handlers.
 *   - {@link removeWordUnderlines} — strips all underline spans and the popup,
 *     restoring the DOM to its original state.
 *
 * ## Popup positioning
 * Uses `position:absolute` (scroll-anchored via `getBoundingClientRect` +
 * `window.scrollY`). Never use `position:fixed` — it collapses the iframe
 * viewport in content-script environments.
 *
 * ## Capitalised words
 * Any token whose first character is uppercase is never underlined — catches
 * proper nouns, sentence-initial capitals, and acronyms without any
 * morphology heuristics.
 *
 * ## Complexity tiers
 * Each qualifying word is assigned one of two display tiers:
 *   - `'full'`  — score ≥ {@link HIGH_CONFIDENCE_THRESHOLD}: dotted purple
 *     underline, up to 4 synonyms + all definitions in the popup.
 *   - `'lite'`  — score ≥ level threshold but < HIGH_CONFIDENCE_THRESHOLD:
 *     solid thinner underline, up to 2 synonyms or a single definition.
 */

import { fetchWordInfo, WordInfo, PosEntry } from './synonymCache'
import { getCachedComplexity, setCachedComplexity } from './analysisCache'
import {
  scoreComplexity,
  HIGH_CONFIDENCE_THRESHOLD,
  ComplexityLevel,
  COMPLEXITY_THRESHOLDS,
} from './wordSimplifier'

import { walkTextNodes, getContentRoot} from './contentRoot'

// ─── Constants ────────────────────────────────────────────────────────────────

const MARKER_CLASS = 'bonita-complex-word'
const POPUP_ID     = 'bonita-synonym-popup'


/** Matches word tokens including hyphens and apostrophes. Reset `lastIndex` before each use. */
const WORD_RE = /\b[A-Za-z][A-Za-z'-]*\b/g


// ─── Popup ────────────────────────────────────────────────────────────────────

function getOrCreatePopup(): HTMLElement {
  let popup = document.getElementById(POPUP_ID)
  if (!popup) {
    popup = document.createElement('div')
    popup.id = POPUP_ID
    // position:absolute — DO NOT change to fixed (collapses iframe height)
    popup.style.cssText = [
      'position:absolute',
      'z-index:2147483647',
      'background:#1e1b2e',
      'color:#f0eeff',
      'border:1px solid #6f4fd8',
      'border-radius:8px',
      'padding:10px 14px',
      'font-size:13px',
      'line-height:1.5',
      'max-width:280px',
      'max-height:320px',
      'overflow-y:auto',
      'pointer-events:none',
      'opacity:0',
      'transition:opacity .15s ease',
      'font-family:system-ui,sans-serif',
      'box-sizing:border-box',
    ].join(';')
    document.body.appendChild(popup)
  }
  return popup
}

/**
 * Positions the popup below the anchor span, flipping above when there is
 * insufficient space below the viewport, and clamping horizontally to stay
 * within the viewport bounds.
 */
function positionPopup(popup: HTMLElement, anchor: HTMLElement): void {
  const rect    = anchor.getBoundingClientRect()
  const scrollY = window.scrollY ?? window.pageYOffset
  const scrollX = window.scrollX ?? window.pageXOffset
  const vw      = window.innerWidth
  const vh      = window.innerHeight
  const popW    = popup.offsetWidth  || 280
  const popH    = popup.offsetHeight || 100

  let top  = rect.bottom + scrollY + 8
  let left = rect.left   + scrollX

  if (rect.bottom + popH + 8 > vh)    top  = rect.top + scrollY - popH - 8
  if (left + popW > scrollX + vw - 8) left = scrollX + vw - popW - 8
  if (left < scrollX + 8)             left = scrollX + 8

  popup.style.top  = `${top}px`
  popup.style.left = `${left}px`
}

/**
 * Renders the hover popup for a complex word.
 *
 * ## Display rules
 * Synonyms are collected across all POS entries, deduplicated, and shown
 * before definitions.
 *
 * **Full tier** (score ≥ `HIGH_CONFIDENCE_THRESHOLD`):
 *   - up to 4 synonyms
 *   - all available definitions
 *
 * **Lite tier** (score between level threshold and `HIGH_CONFIDENCE_THRESHOLD`):
 *   - up to 2 synonyms when any exist
 *   - otherwise a single definition fallback
 *
 * ## Circular-definition suppression
 * When more than 3 total synonyms are available, definitions whose text
 * contains any token that includes the first 5 letters of the lookup word
 * are treated as circular-like and hidden. Synonyms are never removed by
 * this step.
 *
 * @param popup   - The popup element to write into.
 * @param word    - Original-cased word, used as the popup heading.
 * @param entries - Per-POS entries from {@link fetchWordInfo}.
 * @param tier    - Display tier controlling synonym cap and definition visibility.
 */
function renderPopup(
  popup: HTMLElement,
  word: string,
  entries: PosEntry[],
  tier: 'full' | 'lite',
): void {
  const heading = `<div style="font-weight:600;color:#c4b5fd;margin-bottom:6px">${word}</div>`

  const allApiSyns = entries.flatMap(e => e.synonyms)
  const synonymCount = allApiSyns.length
  const hasSynonyms = synonymCount > 0

  const filteredEntries =
    synonymCount > 3
      ? entries.map(entry => {
          if (!entry.definition) return entry
          const stem = word.toLowerCase().slice(0, 5)
          const circularLike = entry.definition
            .toLowerCase()
            .split(/\W+/)
            .some(token => token.length > stem.length && token.includes(stem))
          return circularLike ? { ...entry, definition: null } : entry
        })
      : entries

  const hasDefs = filteredEntries.some(e => e.definition !== null)
  const showDefinitions = tier === 'full' || (tier === 'lite' && !hasSynonyms)

  if (filteredEntries.length === 0) {
    popup.innerHTML =
      heading +
      `<div style="color:#888;font-size:12px">No simpler words found</div>`
    return
  }

  let body = ''

  if (hasSynonyms) {
    body +=
      `<div style="color:#a78bfa;font-size:11px;margin-bottom:4px;text-transform:uppercase;letter-spacing:.05em">simpler words</div>`

    const seen = new Set<string>()
    const synLines: string[] = []
    for (const entry of filteredEntries) {
      for (const syn of entry.synonyms) {
        if (!seen.has(syn)) {
          seen.add(syn)
          synLines.push(syn)
        }
      }
    }

    const MAX_SYNONYMS = tier === 'lite' ? 2 : 4
    for (const syn of synLines.slice(0, MAX_SYNONYMS)) {
      body += `<div style="padding:2px 0">→ ${syn}</div>`
    }
  }

  if (hasDefs && showDefinitions) {
    if (hasSynonyms) body += `<div style="margin-top:8px"></div>`

    body +=
      `<div style="color:#a78bfa;font-size:11px;margin-bottom:6px;text-transform:uppercase;letter-spacing:.05em">definition</div>`

    const definitions =
      tier === 'lite'
        ? filteredEntries.filter(e => e.definition).slice(0, 1)
        : filteredEntries.filter(e => e.definition)

    for (const entry of definitions) {
      body +=
        `<div style="margin-bottom:6px">` +
        `<span style="color:#a78bfa;font-size:10px;text-transform:uppercase;letter-spacing:.05em">${entry.pos}</span>` +
        `<div style="color:#d4c8ff;font-size:12px;line-height:1.6;margin-top:2px">${entry.definition}</div>` +
        `</div>`
    }
  }

  popup.innerHTML = heading + body
}

let hideTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Attaches `mouseenter` / `mouseleave` handlers to a single underline span.
 *
 * The freq map is captured in the closure at wrap time so hover handlers
 * always use the same map that decided to underline this word.
 *
 * **Enter flow:**
 * 1. Show an empty popup immediately (zero-latency placeholder).
 * 2. Await {@link fetchWordInfo} (cached after first hit).
 * 3. If the API returns no content, remove the underline and hide the popup.
 * 4. Otherwise render the merged PosEntry[] content.
 *
 * @param span - The underline span to attach handlers to.
 * @param freq - English frequency map, captured in the closure.
 * @param tier - Display tier for this word.
 */
function attachHoverHandlers(
  span: HTMLElement,
  freq: Map<string, number>,
  tier: 'full' | 'lite',
): void {
  span.addEventListener('mouseenter', async () => {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null }

    const word = span.dataset.word ?? span.textContent ?? ''
    const key  = word.toLowerCase()
    const popup = getOrCreatePopup()

    renderPopup(popup, word, [], tier)
    popup.style.opacity = '1'
    positionPopup(popup, span)

    const info: WordInfo = await fetchWordInfo(key, freq)

    if (!info.hasContent) {
      popup.style.opacity = '0'
      span.style.textDecoration = 'none'
      span.style.cursor = 'auto'
      return
    }

    renderPopup(popup, word, info.entries, tier)
    requestAnimationFrame(() => positionPopup(popup, span))
  })

  span.addEventListener('mouseleave', () => {
    hideTimer = setTimeout(() => {
      const p = document.getElementById(POPUP_ID)
      if (p) p.style.opacity = '0'
    }, 120)
  })
}

/**
 * Collects every unique lowercase word token visible under the resolved
 * content root, skipping blocked elements and Bonita's own UI chrome.
 *
 * Now sourced via {@link walkTextNodes} with `requireAllowedAncestor: false`
 * (this feature previously accepted *any* non-blocked text node, not just
 * ones inside {@link ALLOWED_TEXT_TAGS} containers — preserved here so
 * behaviour on already-working sites doesn't change) and no root override,
 * so it inherits the same validated {@link getContentRoot} resolution as
 * every other Pattern A feature.
 *
 * @returns A set of unique lowercase word strings found in visible text nodes.
 */
function collectPageVocabulary(): Set<string> {
  const vocab = new Set<string>()
  walkTextNodes(
    (node) => {
      const text = node.textContent ?? ''
      let match: RegExpExecArray | null
      WORD_RE.lastIndex = 0
      while ((match = WORD_RE.exec(text)) !== null) {
        const word = match[0]
        if (!isCapitalised(word)) vocab.add(word.toLowerCase())
      }
    },
    { requireAllowedAncestor: false },
  )
  return vocab
}

function isCapitalised(word: string): boolean {
  return word.length > 0 && word[0] >= 'A' && word[0] <= 'Z'
}

/**
 * Walks the resolved content root and underlines every word whose
 * complexity score meets the given threshold level.
 *
 * @param freq  - English frequency rank map from `englishFreq.json`.
 * @param level - Complexity tier to test against. Defaults to `'medium'`.
 */
export function applyWordUnderlines(
  freq: Map<string, number>,
  level: ComplexityLevel = 'medium',
): void {
  removeWordUnderlines()

  const vocab = collectPageVocabulary()

  const wordTiers = new Map<string, 'full' | 'lite'>()
  for (const lower of vocab) {
    let score = getCachedComplexity(lower)
    if (score === null) {
      score = scoreComplexity(lower, freq)
      setCachedComplexity(lower, score)
    }
    if (score < COMPLEXITY_THRESHOLDS[level]) continue
    const tier: 'full' | 'lite' = score >= HIGH_CONFIDENCE_THRESHOLD ? 'full' : 'lite'
    wordTiers.set(lower, tier)
  }

  if (wordTiers.size === 0) return

  const textNodes: Text[] = []
  walkTextNodes(
    (node) => {
      if (/[A-Za-z]/.test(node.textContent ?? '')) textNodes.push(node)
    },
    { requireAllowedAncestor: false },
  )

  for (const textNode of textNodes) {
    const text = textNode.textContent ?? ''
    const fragment = document.createDocumentFragment()
    let lastIndex = 0
    let touched   = false
    let match: RegExpExecArray | null
    WORD_RE.lastIndex = 0

    while ((match = WORD_RE.exec(text)) !== null) {
      const word = match[0]
      if (isCapitalised(word)) continue
      const lower = word.toLowerCase()
      const tier = wordTiers.get(lower)
      if (!tier) continue

      if (match.index > lastIndex) {
        fragment.appendChild(document.createTextNode(text.slice(lastIndex, match.index)))
      }

      const span = document.createElement('span')
      span.className    = MARKER_CLASS
      span.dataset.word = word
      span.dataset.tier = tier
      span.textContent  = word
      span.style.cssText = tier === 'full'
        ? 'text-decoration:underline dotted #6f4fd8;cursor:pointer;'
        : 'text-decoration:underline solid #9d8ec4;text-underline-offset:2px;cursor:pointer;'

      attachHoverHandlers(span, freq, tier)
      fragment.appendChild(span)

      touched   = true
      lastIndex = match.index + word.length
    }

    if (!touched) continue
    if (lastIndex < text.length) {
      fragment.appendChild(document.createTextNode(text.slice(lastIndex)))
    }
    textNode.replaceWith(fragment)
  }
}

/**
 * Removes all underline spans and the popup from the document, restoring
 * each text node to its original unwrapped content. Adjacent text nodes
 * produced by the removal are normalised via `parentElement.normalize()`.
 */
export function removeWordUnderlines(): void {
  document.getElementById(POPUP_ID)?.remove()
  const wrappers = document.querySelectorAll<HTMLElement>(`.${MARKER_CLASS}`)
  const parents  = new Set<Element>()
  wrappers.forEach(wrapper => {
    if (wrapper.parentElement) parents.add(wrapper.parentElement)
    wrapper.replaceWith(document.createTextNode(wrapper.textContent ?? ''))
  })
  parents.forEach(p => p.normalize())
}