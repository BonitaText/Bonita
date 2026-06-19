/**
 * @file content/utils/wordUnderlines.test.ts
 *
 * DOM-level tests for applyWordUnderlines and removeWordUnderlines.
 *
 * wordSimplifier unit tests (countSyllables, scoreComplexity, isComplexWord)
 * have been moved to wordSimplifier.test.ts so that the vi.mock() call below
 * — which Vitest hoists to the top of this module — does not corrupt those
 * tests by replacing the real implementations before they run.
 *
 * ## DOM environment
 * Provided by jsdom (vitest `environment: "jsdom"` or Jest
 * `testEnvironment: "jsdom"`).
 *
 * ## Mocking strategy
 * scoreComplexity IS mocked so DOM-walking logic can be tested without
 * brittle dependency on frequency data or syllable-counting accuracy.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

import {
  applyWordUnderlines,
  removeWordUnderlines,
} from '../../content/utils/wordUnderlines'

// ─── Shared helpers ───────────────────────────────────────────────────────────

const MARKER_CLASS = 'bonita-complex-word'
const POPUP_ID     = 'bonita-synonym-popup'

/** Frequency map used by DOM tests — contents irrelevant because scorer is mocked. */
const mockFreq = new Map<string, number>()

function resetDOM() {
  document.body.innerHTML = ''
}

function makeMain(html: string): HTMLElement {
  const main = document.createElement('main')
  main.innerHTML = html
  document.body.appendChild(main)
  return main
}

function makeParagraph(html: string): HTMLParagraphElement {
  const p = document.createElement('p')
  p.innerHTML = html
  document.body.appendChild(p)
  return p
}

// ─── wordSimplifier mock ──────────────────────────────────────────────────────
//
// vi.mock is hoisted by Vitest to the top of the file, so this mock applies
// to every import of wordSimplifier within this test module, including the
// indirect import via wordUnderlines. The real scorer is tested separately in
// wordSimplifier.test.ts which has no mock.

const COMPLEX_WORDS = new Set(['ubiquitous', 'ephemeral', 'well-known'])

vi.mock('../../content/utils/wordSimplifier', () => ({
  HIGH_CONFIDENCE_THRESHOLD: 5,
  COMPLEXITY_THRESHOLDS: { low: 2, medium: 3, high: 5 },
  scoreComplexity: (word: string) =>
    COMPLEX_WORDS.has(word.toLowerCase()) ? 6 : 0,
  isComplexWord: (word: string) => COMPLEX_WORDS.has(word.toLowerCase()),
  countSyllables: (word: string) => word.length,
}))

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

  it('only highlights text inside the resolved content root', () => {
    const outside = makeParagraph('An ubiquitous word outside main.')
    const main    = makeMain('<p>An ubiquitous word inside main.</p>')

    applyWordUnderlines(mockFreq, 'medium')

    expect(outside.querySelector(`.${MARKER_CLASS}`)).toBeNull()
    expect(main.querySelector(`.${MARKER_CLASS}`)).not.toBeNull()
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

  it('applies an underline inline style', () => {
    makeMain('<p>An ephemeral moment passed quickly by.</p>')
    applyWordUnderlines(mockFreq, 'medium')

    const span = document.querySelector(`.${MARKER_CLASS}`) as HTMLElement
    expect(span.style.textDecoration).toContain('underline')
    expect(span.style.cursor).toBe('pointer')
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

  it('assigns data-tier="full" for high-scoring words (score=6 > HIGH_CONFIDENCE_THRESHOLD=5)', () => {
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
})