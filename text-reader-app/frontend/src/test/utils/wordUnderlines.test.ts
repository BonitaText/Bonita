/**
 * @file content/utils/wordUnderlines.test.ts
 *
 * DOM-level tests for applyWordUnderlines and removeWordUnderlines.
 *
 * wordSimplifier unit tests live in wordSimplifier.test.ts — they must be
 * separate because vi.mock() is hoisted by Vitest and would replace the real
 * implementations before those tests ran.
 *
 * ## Mocking strategy
 * - wordSimplifier: mocked so DOM-walking is tested without real scoring.
 *   Two tiers: COMPLEX_WORDS (score 6 → 'full') and LITE_WORDS (score 4 →
 *   'lite', between COMPLEXITY_THRESHOLDS.medium=3 and HIGH_CONFIDENCE_THRESHOLD=5).
 * - synonymCache/fetchWordInfo: mocked to control hover-handler async flow
 *   without real network calls.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { fireEvent, act } from '@testing-library/react'

import {
  applyWordUnderlines,
  removeWordUnderlines,
} from '../../content/utils/wordUnderlines'
import { fetchWordInfo as _fetchWordInfo } from '../../content/utils/synonymCache'
const fetchWordInfo = _fetchWordInfo as unknown as ReturnType<typeof vi.fn>

// ─── wordSimplifier mock ──────────────────────────────────────────────────────
// Hoisted to top of file by Vitest — affects ALL imports of this module here.

const COMPLEX_WORDS = new Set(['ubiquitous', 'ephemeral', 'well-known'])
const LITE_WORDS    = new Set(['intricate', 'obscure'])

vi.mock('../../content/utils/wordSimplifier', () => ({
  HIGH_CONFIDENCE_THRESHOLD: 5,
  COMPLEXITY_THRESHOLDS: { low: 2, medium: 3, high: 5 },
  scoreComplexity: (word: string) => {
    const w = word.toLowerCase()
    if (COMPLEX_WORDS.has(w)) return 6  // 'full' tier
    if (LITE_WORDS.has(w))   return 4  // 'lite' tier (3 ≤ score < 5)
    return 0
  },
  isComplexWord: (word: string) =>
    COMPLEX_WORDS.has(word.toLowerCase()) || LITE_WORDS.has(word.toLowerCase()),
  countSyllables: (word: string) => word.length,
}))

// ─── synonymCache mock ────────────────────────────────────────────────────────

let mockWordInfo: { hasContent: boolean; entries: unknown[] } = {
  hasContent: false,
  entries: [],
}

vi.mock('../../content/utils/synonymCache', () => ({
  fetchWordInfo: vi.fn(() => Promise.resolve(mockWordInfo)),
}))

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MARKER_CLASS = 'bonita-complex-word'
const POPUP_ID     = 'bonita-synonym-popup'
const mockFreq     = new Map<string, number>()

function resetDOM() {
  document.body.innerHTML = ''
  document.getElementById(POPUP_ID)?.remove()
}

function makeMain(html: string): HTMLElement {
  const main = document.createElement('main')
  main.innerHTML = html
  document.body.appendChild(main)
  return main
}

function makeArticle(html: string): HTMLElement {
  const el = document.createElement('article')
  el.innerHTML = html
  document.body.appendChild(el)
  return el
}

function makeParagraph(html: string): HTMLParagraphElement {
  const p = document.createElement('p')
  p.innerHTML = html
  document.body.appendChild(p)
  return p
}

function getMarkedSpan(): HTMLElement | null {
  return document.querySelector<HTMLElement>(`.${MARKER_CLASS}`)
}

// ─────────────────────────────────────────────────────────────────────────────
// removeWordUnderlines
// ─────────────────────────────────────────────────────────────────────────────

describe('removeWordUnderlines', () => {
  beforeEach(resetDOM)

  it('is a no-op when no underlines are present', () => {
    expect(() => removeWordUnderlines()).not.toThrow()
  })

  it('replaces a wrapper span with a plain text node', () => {
    const p = makeParagraph('before ')
    const span = document.createElement('span')
    span.className   = MARKER_CLASS
    span.textContent = 'ubiquitous'
    p.appendChild(span)
    p.appendChild(document.createTextNode(' after'))

    removeWordUnderlines()

    expect(p.querySelector(`.${MARKER_CLASS}`)).toBeNull()
    expect(p.textContent).toBe('before ubiquitous after')
  })

  it('handles multiple underline elements at once', () => {
    const p = makeParagraph('')
    ;['ubiquitous', 'ephemeral'].forEach((word) => {
      const span = document.createElement('span')
      span.className   = MARKER_CLASS
      span.textContent = word
      p.appendChild(span)
      p.appendChild(document.createTextNode(' '))
    })

    removeWordUnderlines()

    expect(document.querySelectorAll(`.${MARKER_CLASS}`).length).toBe(0)
    expect(p.textContent).toBe('ubiquitous ephemeral ')
  })

  it('removes the popup element if present', () => {
    const popup = document.createElement('div')
    popup.id = POPUP_ID
    document.body.appendChild(popup)

    removeWordUnderlines()

    expect(document.getElementById(POPUP_ID)).toBeNull()
  })

  it('normalises adjacent text nodes left by removal', () => {
    const p = makeParagraph('')
    p.appendChild(document.createTextNode('before '))
    const span = document.createElement('span')
    span.className   = MARKER_CLASS
    span.textContent = 'ubiquitous'
    p.appendChild(span)
    p.appendChild(document.createTextNode(' after'))

    removeWordUnderlines()

    // After normalize(), adjacent text nodes are merged — childNodes.length = 1
    expect(p.childNodes.length).toBe(1)
    expect(p.textContent).toBe('before ubiquitous after')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// applyWordUnderlines — content root selection
// ─────────────────────────────────────────────────────────────────────────────

describe('applyWordUnderlines — content root selection', () => {
  beforeEach(resetDOM)

  it('prefers <main> when present', () => {
    const outside = makeParagraph('ubiquitous word outside')
    const main    = makeMain('<p>ubiquitous word inside</p>')

    applyWordUnderlines(mockFreq, 'medium')

    expect(outside.querySelector(`.${MARKER_CLASS}`)).toBeNull()
    expect(main.querySelector(`.${MARKER_CLASS}`)).not.toBeNull()
  })

  it('falls back to <article> when no <main>', () => {
    const article = makeArticle('<p>ubiquitous word in article</p>')
    applyWordUnderlines(mockFreq, 'medium')
    expect(article.querySelector(`.${MARKER_CLASS}`)).not.toBeNull()
  })

  it('falls back to [role="main"] when no <main> or <article>', () => {
    const div = document.createElement('div')
    div.setAttribute('role', 'main')
    div.innerHTML = '<p>ubiquitous word in role main</p>'
    document.body.appendChild(div)

    applyWordUnderlines(mockFreq, 'medium')

    expect(div.querySelector(`.${MARKER_CLASS}`)).not.toBeNull()
  })

  it('falls back to #content when nothing else matches', () => {
    const div = document.createElement('div')
    div.id = 'content'
    div.innerHTML = '<p>ubiquitous word in content div</p>'
    document.body.appendChild(div)

    applyWordUnderlines(mockFreq, 'medium')

    expect(div.querySelector(`.${MARKER_CLASS}`)).not.toBeNull()
  })

  it('falls back to .content class when nothing else matches', () => {
    const div = document.createElement('div')
    div.className = 'content'
    div.innerHTML = '<p>ubiquitous word in content class</p>'
    document.body.appendChild(div)

    applyWordUnderlines(mockFreq, 'medium')

    expect(div.querySelector(`.${MARKER_CLASS}`)).not.toBeNull()
  })

  it('falls back to document.body when no semantic root exists', () => {
    // Just a bare paragraph, no landmarks
    const p = document.createElement('p')
    p.textContent = 'ubiquitous word in body'
    document.body.appendChild(p)

    applyWordUnderlines(mockFreq, 'medium')

    expect(p.querySelector(`.${MARKER_CLASS}`)).not.toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// applyWordUnderlines — guard conditions
// ─────────────────────────────────────────────────────────────────────────────

describe('applyWordUnderlines — guard conditions', () => {
  beforeEach(resetDOM)

  it('does nothing when no word meets the complexity threshold', () => {
    makeMain('<p>This basic sentence contains nothing complex at all.</p>')
    applyWordUnderlines(mockFreq, 'medium')
    expect(document.querySelector(`.${MARKER_CLASS}`)).toBeNull()
  })

  it('skips elements inside #bonita-root', () => {
    const root = document.createElement('div')
    root.id = 'bonita-root'
    root.innerHTML = '<p>An ubiquitous word inside the extension UI.</p>'
    document.body.appendChild(root)

    applyWordUnderlines(mockFreq, 'medium')

    expect(root.querySelector(`.${MARKER_CLASS}`)).toBeNull()
  })

  it('skips elements inside blocked tags (pre > code)', () => {
    const pre  = document.createElement('pre')
    const code = document.createElement('code')
    code.textContent = 'const ubiquitous = true'
    pre.appendChild(code)
    document.body.appendChild(pre)

    applyWordUnderlines(mockFreq, 'medium')

    expect(pre.querySelector(`.${MARKER_CLASS}`)).toBeNull()
  })

  it('skips elements inside .bonita-dock', () => {
    const dock = document.createElement('div')
    dock.className = 'bonita-dock'
    dock.innerHTML = '<p>An ubiquitous term.</p>'
    document.body.appendChild(dock)

    applyWordUnderlines(mockFreq, 'medium')

    expect(dock.querySelector(`.${MARKER_CLASS}`)).toBeNull()
  })

  it('skips elements inside script tags', () => {
    const script = document.createElement('script')
    script.textContent = 'var x = "ubiquitous"'
    document.body.appendChild(script)

    applyWordUnderlines(mockFreq, 'medium')

    expect(document.querySelector(`.${MARKER_CLASS}`)).toBeNull()
  })

  it('skips elements inside nav tags', () => {
    const nav = document.createElement('nav')
    nav.innerHTML = '<a>ubiquitous link</a>'
    document.body.appendChild(nav)

    applyWordUnderlines(mockFreq, 'medium')

    expect(nav.querySelector(`.${MARKER_CLASS}`)).toBeNull()
  })

  it('skips elements inside .bonita-trigger', () => {
    const trigger = document.createElement('div')
    trigger.className = 'bonita-trigger'
    trigger.innerHTML = '<p>ubiquitous text</p>'
    document.body.appendChild(trigger)

    applyWordUnderlines(mockFreq, 'medium')

    expect(trigger.querySelector(`.${MARKER_CLASS}`)).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// applyWordUnderlines — highlighting behaviour
// ─────────────────────────────────────────────────────────────────────────────

describe('applyWordUnderlines — highlighting behaviour', () => {
  beforeEach(resetDOM)

  it('wraps a matching word in a span with the marker class', () => {
    makeMain('<p>The results were surprisingly ubiquitous across sites.</p>')
    applyWordUnderlines(mockFreq, 'medium')

    const span = document.querySelector(`.${MARKER_CLASS}`)
    expect(span).not.toBeNull()
    expect(span!.textContent).toBe('ubiquitous')
  })

  it('stores the literal word token on data-word', () => {
    makeMain('<p>We found this pattern to be quite ubiquitous in practice.</p>')
    applyWordUnderlines(mockFreq, 'medium')

    const span = document.querySelector(`.${MARKER_CLASS}`) as HTMLElement
    expect(span.dataset.word).toBe('ubiquitous')
  })

  it('never underlines a capitalised occurrence', () => {
    makeMain('<p>Ubiquitous computing changed how we work.</p>')
    applyWordUnderlines(mockFreq, 'medium')
    expect(document.querySelector(`.${MARKER_CLASS}`)).toBeNull()
  })

  it('never underlines an ALL-CAPS occurrence', () => {
    makeMain('<p>UBIQUITOUS is written in capitals here.</p>')
    applyWordUnderlines(mockFreq, 'medium')
    expect(document.querySelector(`.${MARKER_CLASS}`)).toBeNull()
  })

  it('matches a lower-case occurrence even when a capitalised one exists nearby', () => {
    makeMain('<p>UBIQUITOUS in capitals, but ubiquitous also appears lowercase.</p>')
    applyWordUnderlines(mockFreq, 'medium')

    const spans = document.querySelectorAll(`.${MARKER_CLASS}`)
    expect(spans.length).toBe(1)
    expect(spans[0].textContent).toBe('ubiquitous')
  })

  it('wraps multiple matches within the same text node', () => {
    makeMain('<p>The ubiquitous sensors created an ephemeral signal trail.</p>')
    applyWordUnderlines(mockFreq, 'medium')

    const spans = document.querySelectorAll(`.${MARKER_CLASS}`)
    expect(spans.length).toBe(2)
    expect(Array.from(spans).map(s => s.textContent)).toEqual(['ubiquitous', 'ephemeral'])
  })

  it('preserves the surrounding text exactly', () => {
    makeMain('<p>Before the ubiquitous word, and after it too.</p>')
    applyWordUnderlines(mockFreq, 'medium')
    expect(document.querySelector('main')!.textContent).toBe(
      'Before the ubiquitous word, and after it too.',
    )
  })

  it('matches hyphenated words', () => {
    makeMain("<p>It's a well-known fact among researchers.</p>")
    applyWordUnderlines(mockFreq, 'medium')

    const matched = Array.from(document.querySelectorAll(`.${MARKER_CLASS}`))
      .map(s => s.textContent)
    expect(matched).toContain('well-known')
  })

  it('leaves text nodes with no matches completely untouched', () => {
    const main = makeMain('<p id="target">Nothing notable happens here at all.</p>')
    const p    = main.querySelector('#target')!
    const originalNode = p.firstChild

    applyWordUnderlines(mockFreq, 'medium')

    expect(p.firstChild).toBe(originalNode)
  })

  it('preserves inline markup around a highlighted word', () => {
    makeMain('<p>This is an <strong>ubiquitous</strong> finding in the data.</p>')
    applyWordUnderlines(mockFreq, 'medium')

    const strong = document.querySelector('strong')!
    expect(strong.querySelector(`.${MARKER_CLASS}`)).not.toBeNull()
  })

  it('does not double-wrap when called twice', () => {
    makeMain('<p>An ubiquitous and ephemeral pair of words.</p>')
    applyWordUnderlines(mockFreq, 'medium')
    applyWordUnderlines(mockFreq, 'medium')

    expect(document.querySelectorAll(`.${MARKER_CLASS}`).length).toBe(2)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// applyWordUnderlines — complexity tiers
// ─────────────────────────────────────────────────────────────────────────────

describe('applyWordUnderlines — complexity tiers', () => {
  beforeEach(resetDOM)

  it('assigns data-tier="full" for high-scoring words (score 6 > threshold 5)', () => {
    makeMain('<p>An ubiquitous example here.</p>')
    applyWordUnderlines(mockFreq, 'medium')

    const span = document.querySelector(`.${MARKER_CLASS}`) as HTMLElement
    expect(span.dataset.tier).toBe('full')
  })

  it('sets dotted underline style for full-tier words', () => {
    makeMain('<p>An ubiquitous occurrence in the data.</p>')
    applyWordUnderlines(mockFreq, 'medium')

    const span = document.querySelector(`.${MARKER_CLASS}`) as HTMLElement
    expect(span.style.textDecoration).toContain('dotted')
  })

  it('assigns data-tier="lite" for medium-scoring words (score 4, between 3 and 5)', () => {
    makeMain('<p>The intricate design was quite obscure to visitors.</p>')
    applyWordUnderlines(mockFreq, 'medium')

    const spans = Array.from(document.querySelectorAll<HTMLElement>(`.${MARKER_CLASS}`))
    expect(spans.length).toBeGreaterThanOrEqual(1)
    spans.forEach(s => expect(s.dataset.tier).toBe('lite'))
  })

  it('sets solid underline style for lite-tier words', () => {
    makeMain('<p>The intricate pattern was hard to decode.</p>')
    applyWordUnderlines(mockFreq, 'medium')

    const span = document.querySelector(`.${MARKER_CLASS}`) as HTMLElement
    expect(span.style.textDecoration).toContain('solid')
    expect(span.style.textDecoration).not.toContain('dotted')
  })

  it('does not underline words whose score is below the level threshold', () => {
    // Score 0 words — below medium threshold of 3
    makeMain('<p>Simple common words here today.</p>')
    applyWordUnderlines(mockFreq, 'medium')
    expect(document.querySelector(`.${MARKER_CLASS}`)).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// applyWordUnderlines — hover handlers (attachHoverHandlers)
// ─────────────────────────────────────────────────────────────────────────────

describe('applyWordUnderlines — hover handlers', () => {
  beforeEach(() => {
    resetDOM()
    mockWordInfo = { hasContent: false, entries: [] }
    fetchWordInfo.mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('creates the popup element on first mouseenter', async () => {
    makeMain('<p>An ubiquitous word here.</p>')
    applyWordUnderlines(mockFreq, 'medium')

    const span = getMarkedSpan()!
    await act(async () => { fireEvent.mouseEnter(span) })

    expect(document.getElementById(POPUP_ID)).not.toBeNull()
  })

  it('reuses the existing popup on repeated mouseenter', async () => {
    makeMain('<p>An ubiquitous word here.</p>')
    applyWordUnderlines(mockFreq, 'medium')

    const span = getMarkedSpan()!
    await act(async () => { fireEvent.mouseEnter(span) })
    await act(async () => { fireEvent.mouseEnter(span) })

    expect(document.querySelectorAll(`#${POPUP_ID}`).length).toBe(1)
  })

  it('sets popup opacity to 1 on mouseenter when content is available', async () => {
    // When hasContent is true the handler sets opacity='1' and never resets it.
    // With hasContent:false the handler resets opacity to '0' after the await,
    // so we must use hasContent:true to observe the stable opacity='1' state.
    mockWordInfo = {
      hasContent: true,
      entries: [{ pos: 'adjective', synonyms: ['common'], definition: 'Present everywhere.' }],
    }
    makeMain('<p>An ubiquitous word here.</p>')
    applyWordUnderlines(mockFreq, 'medium')

    const span = getMarkedSpan()!
    await act(async () => { fireEvent.mouseEnter(span) })

    const popup = document.getElementById(POPUP_ID)!
    expect(popup.style.opacity).toBe('1')
  })

  it('removes the underline style when fetchWordInfo returns no content', async () => {
    mockWordInfo = { hasContent: false, entries: [] }
    makeMain('<p>An ubiquitous word here.</p>')
    applyWordUnderlines(mockFreq, 'medium')

    const span = getMarkedSpan()!
    await act(async () => { fireEvent.mouseEnter(span) })

    expect(span.style.textDecoration).toBe('none')
    expect(span.style.cursor).toBe('auto')
  })

  it('calls fetchWordInfo with the lowercased word', async () => {
    makeMain('<p>An ubiquitous word here.</p>')
    applyWordUnderlines(mockFreq, 'medium')

    const span = getMarkedSpan()!
    await act(async () => { fireEvent.mouseEnter(span) })

    expect(fetchWordInfo).toHaveBeenCalledWith('ubiquitous', mockFreq)
  })

  it('renders content into popup when fetchWordInfo returns entries', async () => {
    mockWordInfo = {
      hasContent: true,
      entries: [{ pos: 'adjective', synonyms: ['common', 'pervasive'], definition: 'Present everywhere.' }],
    }
    makeMain('<p>An ubiquitous word here.</p>')
    applyWordUnderlines(mockFreq, 'medium')

    const span = getMarkedSpan()!
    await act(async () => { fireEvent.mouseEnter(span) })

    const popup = document.getElementById(POPUP_ID)!
    expect(popup.innerHTML).toContain('common')
  })

  it('fades popup to opacity 0 on mouseleave (after timer)', async () => {
    vi.useFakeTimers()
    makeMain('<p>An ubiquitous word here.</p>')
    applyWordUnderlines(mockFreq, 'medium')

    const span = getMarkedSpan()!
    await act(async () => { fireEvent.mouseEnter(span) })
    fireEvent.mouseLeave(span)
    act(() => { vi.advanceTimersByTime(200) })

    const popup = document.getElementById(POPUP_ID)!
    expect(popup.style.opacity).toBe('0')
    vi.useRealTimers()
  })

  it('cancels the hide timer if mouse re-enters before it fires', async () => {
    vi.useFakeTimers()
    mockWordInfo = {
      hasContent: true,
      entries: [{ pos: 'adjective', synonyms: ['common'], definition: 'Present everywhere.' }],
    }
    makeMain('<p>An ubiquitous word here.</p>')
    applyWordUnderlines(mockFreq, 'medium')

    const span = getMarkedSpan()!
    await act(async () => { fireEvent.mouseEnter(span) })
    fireEvent.mouseLeave(span)

    // Re-enter before the 120ms hide timer fires
    await act(async () => { fireEvent.mouseEnter(span) })
    act(() => { vi.advanceTimersByTime(200) })

    const popup = document.getElementById(POPUP_ID)!
    // The hide timer was cancelled so opacity remains 1
    expect(popup.style.opacity).toBe('1')
    vi.useRealTimers()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// applyWordUnderlines + removeWordUnderlines round-trip
// ─────────────────────────────────────────────────────────────────────────────

describe('applyWordUnderlines + removeWordUnderlines round-trip', () => {
  beforeEach(resetDOM)

  it('fully restores the original text content after removal', () => {
    const html = 'The <em>ubiquitous</em> signal was found in every sample.'
    makeMain(`<p>${html}</p>`)
    const originalText = document.querySelector('p')!.textContent

    applyWordUnderlines(mockFreq, 'medium')
    expect(document.querySelector(`.${MARKER_CLASS}`)).not.toBeNull()

    removeWordUnderlines()

    expect(document.querySelector(`.${MARKER_CLASS}`)).toBeNull()
    expect(document.querySelector('p')!.textContent).toBe(originalText)
  })

  it('can re-apply after removal without errors', () => {
    makeMain('<p>An ubiquitous and ephemeral pair.</p>')

    applyWordUnderlines(mockFreq, 'medium')
    removeWordUnderlines()
    expect(() => applyWordUnderlines(mockFreq, 'medium')).not.toThrow()
    expect(document.querySelectorAll(`.${MARKER_CLASS}`).length).toBe(2)
  })

  it('removes any open popup during re-apply', () => {
    makeMain('<p>An ubiquitous word here.</p>')
    applyWordUnderlines(mockFreq, 'medium')

    // Manually inject a popup to simulate one being open
    const popup = document.createElement('div')
    popup.id = POPUP_ID
    document.body.appendChild(popup)

    applyWordUnderlines(mockFreq, 'medium') // calls removeWordUnderlines first

    expect(document.getElementById(POPUP_ID)).toBeNull()
  })
})