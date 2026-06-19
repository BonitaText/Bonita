/**
 * @file content/utils/posHighlighter.test.ts
 *
 * Unit and integration tests for the posHighlighter module
 * (applyPOSHighlight / removePOSHighlight).
 *
 * ## DOM environment
 * Provided by jsdom (vitest `environment: "jsdom"` or Jest
 * `testEnvironment: "jsdom"`).
 *
 * ## compromise mock
 * The `compromise` NLP library is mocked to return a fixed, predictable term
 * list so tests do not depend on the library's actual tagging accuracy.
 *
 * IMPORTANT: compromise reconstructs the full text by concatenating
 * `term.pre + term.text + term.post` for every term in the sentence. If
 * mockTerms only contains the highlighted words, the rest of the sentence's
 * text is silently dropped, causing textContent assertions to fail. Every
 * test therefore sets mockTerms to the complete token sequence for the
 * sentence being processed, using empty `{}` tags for non-highlighted words.
 *
 * Mock contract: `nlp(text).json({ terms: … })` returns an array of sentence
 * objects whose `terms` arrays follow the shape
 * `{ text, pre, post, tags: Record<string, true> }`.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { applyPOSHighlight, removePOSHighlight } from '../../content/utils/posHighlighter'

// ─── compromise mock ─────────────────────────────────────────────────────────

let mockTerms: Array<{ text: string; pre: string; post: string; tags: Record<string, true> }> = []

vi.mock('compromise', () => ({
  default: (_text: string) => ({
    json: (_opts: unknown) => [{ terms: mockTerms }],
  }),
}))

// ─── Helpers ─────────────────────────────────────────────────────────────────

const MARKER_CLASS = 'bonita-pos-wrapper'
const STYLE_ID     = 'bonita-pos-styles'

const DEFAULT_COLORS = { verbs: '#ff0000', nouns: '#00ff00', adjectives: '#0000ff' }
const ALL_ENABLED    = { verbs: true, nouns: true, adjectives: true }

function resetDOM() {
  document.body.innerHTML = ''
  document.getElementById(STYLE_ID)?.remove()
}

/**
 * Append a <p> inside a <main> (an ALLOWED_TEXT_TAG container).
 * The walker requires text length ≥ 30 chars to accept a node.
 * Text is stored exactly as provided — no padding — because the mock
 * reconstructs the full text from mockTerms, not from the DOM text node.
 * However we still need the text node length to pass the walker filter,
 * so we pad only the DOM text while mockTerms holds the real tokens.
 */
function makeMain(text: string): HTMLElement {
  const main = document.createElement('main')
  const padded = text.length < 30 ? text + ' '.repeat(30 - text.length) : text
  const p = document.createElement('p')
  p.textContent = padded
  main.appendChild(p)
  document.body.appendChild(main)
  return main
}

/**
 * Builds a mock term object with all whitespace fields defaulted.
 * `tags` is a plain object keyed by tag name (compromise's format).
 */
function term(
  text: string,
  tags: Record<string, true>,
  pre = '',
  post = ' ',
): (typeof mockTerms)[number] {
  return { text, pre, post, tags }
}

/**
 * Builds a plain (non-highlighted) term token.
 * Used to fill in all the words surrounding the highlighted word(s) so that
 * the text reconstruction in applyPOSHighlight produces the full sentence.
 */
function plain(text: string, pre = '', post = ' '): (typeof mockTerms)[number] {
  return { text, pre, post, tags: {} as Record<string, true> }
}

/**
 * Tokenises a sentence string into plain mock terms.
 * Words are split on whitespace; the last word gets post=''.
 * Use this as the base, then replace specific entries with tagged terms.
 */
function sentenceTerms(sentence: string): (typeof mockTerms)[number][] {
  const words = sentence.trim().split(/\s+/)
  return words.map((w, i) => plain(w, '', i < words.length - 1 ? ' ' : ''))
}

/**
 * Returns a full term list for a sentence, replacing the occurrence of
 * `targetWord` with a tagged term. If the word appears multiple times,
 * all occurrences are replaced.
 */
function sentenceWithTagged(
  sentence: string,
  taggedWords: Array<{ word: string; tags: Record<string, true> }>,
): (typeof mockTerms)[number][] {
  const base = sentenceTerms(sentence)
  const tagMap = new Map(taggedWords.map(t => [t.word, t.tags]))
  return base.map(t => {
    const tags = tagMap.get(t.text)
    return tags ? { ...t, tags } : t
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. removePOSHighlight
// ─────────────────────────────────────────────────────────────────────────────

describe('removePOSHighlight', () => {
  beforeEach(resetDOM)

  it('is a no-op when nothing has been highlighted', () => {
    expect(() => removePOSHighlight()).not.toThrow()
  })

  it('removes all wrapper spans and restores text content', () => {
    const p = document.createElement('p')
    p.appendChild(document.createTextNode('The '))
    const span = document.createElement('span')
    span.className   = MARKER_CLASS
    span.textContent = 'running'
    p.appendChild(span)
    p.appendChild(document.createTextNode(' fast'))
    document.body.appendChild(p)

    removePOSHighlight()

    expect(p.querySelector(`.${MARKER_CLASS}`)).toBeNull()
    expect(p.textContent).toBe('The running fast')
  })

  it('removes the injected <style> tag', () => {
    const style = document.createElement('style')
    style.id = STYLE_ID
    document.head.appendChild(style)

    removePOSHighlight()

    expect(document.getElementById(STYLE_ID)).toBeNull()
  })

  it('handles multiple wrapper spans across different parents', () => {
    const container = document.createElement('div')
    ;['walked', 'sprinted'].forEach((word) => {
      const p    = document.createElement('p')
      const span = document.createElement('span')
      span.className   = MARKER_CLASS
      span.textContent = word
      p.appendChild(span)
      container.appendChild(p)
    })
    document.body.appendChild(container)

    removePOSHighlight()

    expect(document.querySelectorAll(`.${MARKER_CLASS}`).length).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 2. applyPOSHighlight — guard / early-exit conditions
// ─────────────────────────────────────────────────────────────────────────────

describe('applyPOSHighlight — guard conditions', () => {
  beforeEach(resetDOM)

  it('does nothing when all POS categories are disabled', () => {
    const sentence = 'The runner quickly finished the long exhausting race.'
    makeMain(sentence)
    mockTerms = sentenceWithTagged(sentence, [{ word: 'runner', tags: { Noun: true } }])

    applyPOSHighlight(DEFAULT_COLORS, { verbs: false, nouns: false, adjectives: false })

    expect(document.querySelector(`.${MARKER_CLASS}`)).toBeNull()
    expect(document.getElementById(STYLE_ID)).toBeNull()
  })

  it('skips text inside #bonita-root', () => {
    const root = document.createElement('div')
    root.id = 'bonita-root'
    const p  = document.createElement('p')
    p.textContent = 'The runner quickly finished the long exhausting race here.'
    root.appendChild(p)
    document.body.appendChild(root)
    mockTerms = [term('runner', { Noun: true })]

    applyPOSHighlight(DEFAULT_COLORS, ALL_ENABLED)

    expect(root.querySelector(`.${MARKER_CLASS}`)).toBeNull()
  })

  it('skips text inside blocked tags (script)', () => {
    const script = document.createElement('script')
    script.textContent = 'var runner = "quickly finished the long exhausting race here";'
    document.body.appendChild(script)
    mockTerms = [term('runner', { Noun: true })]

    applyPOSHighlight(DEFAULT_COLORS, ALL_ENABLED)

    expect(document.querySelector(`.${MARKER_CLASS}`)).toBeNull()
  })

  it('skips text inside <code> / <pre>', () => {
    const pre  = document.createElement('pre')
    const code = document.createElement('code')
    code.textContent = 'const runner = quickly("finished the long exhausting race")'
    pre.appendChild(code)
    document.body.appendChild(pre)
    mockTerms = [term('runner', { Noun: true })]

    applyPOSHighlight(DEFAULT_COLORS, ALL_ENABLED)

    expect(pre.querySelector(`.${MARKER_CLASS}`)).toBeNull()
  })

  it('skips text inside <nav>', () => {
    const nav = document.createElement('nav')
    nav.innerHTML = '<a>The runner quickly finished the long exhausting race.</a>'
    document.body.appendChild(nav)
    mockTerms = [term('runner', { Noun: true })]

    applyPOSHighlight(DEFAULT_COLORS, ALL_ENABLED)

    expect(nav.querySelector(`.${MARKER_CLASS}`)).toBeNull()
  })

  it('skips text nodes shorter than 30 characters', () => {
    const p = document.createElement('p')
    p.textContent = 'Short text.'
    document.body.appendChild(p)
    mockTerms = [term('Short', { Adjective: true })]

    applyPOSHighlight(DEFAULT_COLORS, ALL_ENABLED)

    expect(p.querySelector(`.${MARKER_CLASS}`)).toBeNull()
  })

  it('injects the shared <style> tag when at least one category is enabled', () => {
    const sentence = 'The runner quickly finished the long exhausting race today.'
    makeMain(sentence)
    mockTerms = sentenceWithTagged(sentence, [{ word: 'runner', tags: { Noun: true } }])

    applyPOSHighlight(DEFAULT_COLORS, { verbs: false, nouns: true, adjectives: false })

    expect(document.getElementById(STYLE_ID)).not.toBeNull()
  })

  it('does not inject duplicate <style> tags on repeated calls', () => {
    const sentence = 'The runner quickly finished the long exhausting race today.'
    makeMain(sentence)
    mockTerms = sentenceWithTagged(sentence, [{ word: 'runner', tags: { Noun: true } }])

    applyPOSHighlight(DEFAULT_COLORS, ALL_ENABLED)
    applyPOSHighlight(DEFAULT_COLORS, ALL_ENABLED)

    expect(document.querySelectorAll(`#${STYLE_ID}`).length).toBe(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 3. applyPOSHighlight — highlighting behaviour
// ─────────────────────────────────────────────────────────────────────────────

describe('applyPOSHighlight — highlighting behaviour', () => {
  beforeEach(resetDOM)

  it('wraps a noun with the marker class and data-pos="nouns"', () => {
    const sentence = 'The runner quickly finished the long exhausting race today.'
    makeMain(sentence)
    mockTerms = sentenceWithTagged(sentence, [{ word: 'runner', tags: { Noun: true } }])

    applyPOSHighlight(DEFAULT_COLORS, ALL_ENABLED)

    const span = document.querySelector(`.${MARKER_CLASS}`) as HTMLElement
    expect(span).not.toBeNull()
    expect(span.dataset.pos).toBe('nouns')
    expect(span.textContent).toBe('runner')
  })

  it('wraps a verb with data-pos="verbs"', () => {
    const sentence = 'The runner quickly finished the long exhausting race today.'
    makeMain(sentence)
    mockTerms = sentenceWithTagged(sentence, [{ word: 'finished', tags: { Verb: true } }])

    applyPOSHighlight(DEFAULT_COLORS, ALL_ENABLED)

    const span = document.querySelector(`.${MARKER_CLASS}`) as HTMLElement
    expect(span?.dataset.pos).toBe('verbs')
  })

  it('wraps an adjective with data-pos="adjectives"', () => {
    const sentence = 'The runner quickly finished the long exhausting race today.'
    makeMain(sentence)
    mockTerms = sentenceWithTagged(sentence, [{ word: 'exhausting', tags: { Adjective: true } }])

    applyPOSHighlight(DEFAULT_COLORS, ALL_ENABLED)

    const span = document.querySelector(`.${MARKER_CLASS}`) as HTMLElement
    expect(span?.dataset.pos).toBe('adjectives')
  })

  it('sets the correct --pos-color CSS variable on the span', () => {
    const sentence = 'The runner quickly finished the long exhausting race today.'
    makeMain(sentence)
    mockTerms = sentenceWithTagged(sentence, [{ word: 'runner', tags: { Noun: true } }])

    applyPOSHighlight(DEFAULT_COLORS, ALL_ENABLED)

    const span = document.querySelector(`.${MARKER_CLASS}`) as HTMLElement
    expect(span.style.getPropertyValue('--pos-color')).toBe('#00ff00')
  })

  it('sets a border-bottom style', () => {
    const sentence = 'The runner quickly finished the long exhausting race today.'
    makeMain(sentence)
    mockTerms = sentenceWithTagged(sentence, [{ word: 'runner', tags: { Noun: true } }])

    applyPOSHighlight(DEFAULT_COLORS, ALL_ENABLED)

    const span = document.querySelector(`.${MARKER_CLASS}`) as HTMLElement
    expect(span.style.borderBottom).toBeTruthy()
  })

  it('sets data-label to "n" for nouns, "v" for verbs, "a" for adjectives', () => {
    const sentence = 'The runner quickly finished the long exhausting race today.'
    makeMain(sentence)
    mockTerms = sentenceWithTagged(sentence, [
      { word: 'runner',    tags: { Noun: true } },
      { word: 'finished',  tags: { Verb: true } },
      { word: 'exhausting', tags: { Adjective: true } },
    ])

    applyPOSHighlight(DEFAULT_COLORS, ALL_ENABLED)

    const spans = Array.from(document.querySelectorAll<HTMLElement>(`.${MARKER_CLASS}`))
    const labels = spans.map(s => s.dataset.label)
    expect(labels).toContain('n')
    expect(labels).toContain('v')
    expect(labels).toContain('a')
  })

  it('skips words shorter than 4 alphabetic characters', () => {
    const sentence = 'The run was quickly finished the long exhausting race today.'
    makeMain(sentence)
    // "run" has 3 letters — should be skipped even though it is tagged as a Verb
    mockTerms = sentenceWithTagged(sentence, [{ word: 'run', tags: { Verb: true } }])

    applyPOSHighlight(DEFAULT_COLORS, ALL_ENABLED)

    expect(document.querySelector(`.${MARKER_CLASS}`)).toBeNull()
  })

  it('skips pronouns', () => {
    const sentence = 'They quickly finished the long exhausting race today here.'
    makeMain(sentence)
    mockTerms = sentenceWithTagged(sentence, [{ word: 'They', tags: { Pronoun: true, Verb: false as unknown as true } }])

    applyPOSHighlight(DEFAULT_COLORS, ALL_ENABLED)

    expect(document.querySelector(`.${MARKER_CLASS}`)).toBeNull()
  })

  it('skips auxiliary / modal verbs', () => {
    const sentence = 'They could quickly finish the long exhausting difficult race.'
    makeMain(sentence)
    mockTerms = sentenceWithTagged(sentence, [{ word: 'could', tags: { Modal: true, Verb: true } }])

    applyPOSHighlight(DEFAULT_COLORS, ALL_ENABLED)

    expect(document.querySelector(`.${MARKER_CLASS}`)).toBeNull()
  })

  it('does not highlight nouns when nouns are disabled', () => {
    const sentence = 'The runner quickly finished the long exhausting race today.'
    makeMain(sentence)
    mockTerms = sentenceWithTagged(sentence, [{ word: 'runner', tags: { Noun: true } }])

    applyPOSHighlight(DEFAULT_COLORS, { verbs: false, nouns: false, adjectives: false })

    expect(document.querySelector(`.${MARKER_CLASS}`)).toBeNull()
  })

  it('preserves surrounding text when wrapping a term', () => {
    const sentence = 'The runner quickly finished the long exhausting race today.'
    makeMain(sentence)
    mockTerms = sentenceWithTagged(sentence, [{ word: 'runner', tags: { Noun: true } }])

    applyPOSHighlight(DEFAULT_COLORS, ALL_ENABLED)

    const full = document.body.textContent ?? ''
    expect(full).toContain('runner')
    expect(full).toContain('The')
  })

  it('wraps multiple matching terms in the same text node', () => {
    const sentence = 'The runner quickly finished the long exhausting race today.'
    makeMain(sentence)
    mockTerms = sentenceWithTagged(sentence, [
      { word: 'runner',   tags: { Noun: true } },
      { word: 'finished', tags: { Verb: true } },
    ])

    applyPOSHighlight(DEFAULT_COLORS, ALL_ENABLED)

    expect(document.querySelectorAll(`.${MARKER_CLASS}`).length).toBe(2)
  })

  it('verb takes priority over noun when a term has both tags', () => {
    const sentence = 'The runner quickly finished the long exhausting race today.'
    makeMain(sentence)
    mockTerms = sentenceWithTagged(sentence, [{ word: 'finished', tags: { Verb: true, Noun: true } }])

    applyPOSHighlight(DEFAULT_COLORS, ALL_ENABLED)

    const span = document.querySelector(`.${MARKER_CLASS}`) as HTMLElement
    expect(span?.dataset.pos).toBe('verbs')
  })

  it('adjective takes priority over noun when verbs are disabled', () => {
    const sentence = 'The runner quickly finished the long exhausting race today.'
    makeMain(sentence)
    mockTerms = sentenceWithTagged(sentence, [{ word: 'exhausting', tags: { Adjective: true, Noun: true } }])

    applyPOSHighlight(DEFAULT_COLORS, { verbs: false, nouns: true, adjectives: true })

    const span = document.querySelector(`.${MARKER_CLASS}`) as HTMLElement
    expect(span?.dataset.pos).toBe('adjectives')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 4. applyPOSHighlight + removePOSHighlight round-trip
// ─────────────────────────────────────────────────────────────────────────────

describe('applyPOSHighlight + removePOSHighlight round-trip', () => {
  beforeEach(resetDOM)

  it('fully restores original text content after removal', () => {
    const sentence = 'The runner quickly finished the long exhausting race today.'
    const main = makeMain(sentence)
    const originalText = main.textContent

    mockTerms = sentenceWithTagged(sentence, [{ word: 'runner', tags: { Noun: true } }])
    applyPOSHighlight(DEFAULT_COLORS, ALL_ENABLED)
    expect(document.querySelector(`.${MARKER_CLASS}`)).not.toBeNull()

    removePOSHighlight()

    expect(document.querySelector(`.${MARKER_CLASS}`)).toBeNull()
    expect(main.textContent).toBe(originalText)
  })

  it('removes the <style> tag after removal', () => {
    const sentence = 'The runner quickly finished the long exhausting race today.'
    makeMain(sentence)
    mockTerms = sentenceWithTagged(sentence, [{ word: 'runner', tags: { Noun: true } }])

    applyPOSHighlight(DEFAULT_COLORS, ALL_ENABLED)
    expect(document.getElementById(STYLE_ID)).not.toBeNull()

    removePOSHighlight()

    expect(document.getElementById(STYLE_ID)).toBeNull()
  })

  it('can re-apply after removal without errors', () => {
    const sentence = 'The runner quickly finished the long exhausting race today.'
    makeMain(sentence)
    mockTerms = sentenceWithTagged(sentence, [{ word: 'runner', tags: { Noun: true } }])

    applyPOSHighlight(DEFAULT_COLORS, ALL_ENABLED)
    removePOSHighlight()
    expect(() => applyPOSHighlight(DEFAULT_COLORS, ALL_ENABLED)).not.toThrow()
    expect(document.querySelector(`.${MARKER_CLASS}`)).not.toBeNull()
  })

  it('previous highlights are removed before a fresh pass (no double-wrapping)', () => {
    const sentence = 'The runner quickly finished the long exhausting race today.'
    makeMain(sentence)
    mockTerms = sentenceWithTagged(sentence, [{ word: 'runner', tags: { Noun: true } }])

    applyPOSHighlight(DEFAULT_COLORS, ALL_ENABLED)
    applyPOSHighlight(DEFAULT_COLORS, ALL_ENABLED)

    expect(document.querySelectorAll(`.${MARKER_CLASS}`).length).toBe(1)
  })
})