/**
 * @file utils/sentenceSplitter.test.ts
 *
 * Unit and integration tests for the sentenceSplitter module.
 *
 * DOM environment is provided by jsdom (configured via vitest's `environment:
 * "jsdom"` setting or Jest's `testEnvironment: "jsdom"`).
 *
 * Internal functions that are not exported are tested indirectly through the
 * public API (`applySentenceSplit` / `removeSentenceSplit`) plus the exported
 * helpers re-exposed via a test-only barrel when needed.  Where direct unit
 * testing of a private function is valuable the relevant logic is exercised by
 * constructing controlled DOM fixtures.
 */

import { describe, it, expect, beforeEach} from 'vitest'
import { applySentenceSplit, removeSentenceSplit } from '../../content/utils/sentenceSplitter'
import type { ParagraphScore } from '../../content/utils/analysisCache'

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Creates a `<p>` element with the given HTML, appended to `document.body`,
 * and returns it.  All previously created fixtures are removed by
 * {@link resetDOM} in `beforeEach`.
 */
function makeParagraph(html: string): HTMLParagraphElement {
  const p = document.createElement('p')
  p.innerHTML = html
  document.body.appendChild(p)
  return p
}

/**
 * Wraps text in a minimal `<main>` element so `getContentRoot` inside the
 * module resolves to it rather than `document.body`.
 */
function makeMain(html: string): HTMLElement {
  const main = document.createElement('main')
  main.innerHTML = html
  document.body.appendChild(main)
  return main
}

/** Removes everything appended to body between tests. */
function resetDOM() {
  document.body.innerHTML = ''
}

/**
 * Builds a {@link ParagraphScore} fixture with `action: "split"`.
 *
 * @param text - The paragraph text (first 80 chars are used for matching).
 */
function score(text: string, action: ParagraphScore['action'] = 'split'): ParagraphScore {
  return { text, action }
}

// ─── Test suites ──────────────────────────────────────────────────────────────

describe('removeSentenceSplit', () => {
  beforeEach(resetDOM)

  it('is a no-op when no splits are present', () => {
    expect(() => removeSentenceSplit()).not.toThrow()
  })

  it('restores original innerHTML and removes the marker class', () => {
    const p = makeParagraph('<strong>Hello.</strong> World.')
    const original = p.innerHTML
    p.setAttribute('data-bonita-original', original)
    p.classList.add('bonita-split')
    p.innerHTML = '<ul><li>Hello.</li><li>World.</li></ul>'

    removeSentenceSplit()

    expect(p.classList.contains('bonita-split')).toBe(false)
    expect(p.getAttribute('data-bonita-original')).toBeNull()
    expect(p.innerHTML).toBe(original)
  })

  it('handles multiple split elements at once', () => {
    const originals = ['<em>A.</em>', '<em>B.</em>']
    originals.forEach(html => {
      const p = makeParagraph(html)
      p.setAttribute('data-bonita-original', html)
      p.classList.add('bonita-split')
      p.innerHTML = '<ul><li>placeholder</li></ul>'
    })

    removeSentenceSplit()

    document.querySelectorAll('p').forEach((p, i) => {
      expect(p.innerHTML).toBe(originals[i])
      expect(p.classList.contains('bonita-split')).toBe(false)
    })
  })
})

describe('applySentenceSplit — guard conditions', () => {
  beforeEach(resetDOM)

  it('does nothing when paragraphScores is empty', () => {
    const p = makeParagraph('Some text here.')
    applySentenceSplit([])
    expect(p.querySelector('ul')).toBeNull()
  })

  it('does nothing when paragraphScores is not an array', () => {
    const p = makeParagraph('Some text here.')
    // @ts-expect-error — deliberate bad input
    applySentenceSplit(null)
    expect(p.querySelector('ul')).toBeNull()
  })

  it('skips elements inside #bonita-root', () => {
    const root = document.createElement('div')
    root.id = 'bonita-root'
    root.innerHTML = '<p>First sentence here. Second sentence here too.</p>'
    document.body.appendChild(root)

    const text = root.querySelector('p')!.textContent!.trim()
    applySentenceSplit([score(text)])

    expect(root.querySelector('ul')).toBeNull()
  })

  it('skips elements inside blocked tags (code)', () => {
    const pre = document.createElement('pre')
    const code = document.createElement('code')
    code.textContent = 'const x = 1. const y = 2.'
    pre.appendChild(code)
    document.body.appendChild(pre)

    applySentenceSplit([score(code.textContent)])
    expect(pre.querySelector('ul')).toBeNull()
  })

  it('skips elements that do not match any score', () => {
    const p = makeParagraph('This is a paragraph with no matching score.')
    applySentenceSplit([score('Completely different text that will not match.')])
    expect(p.querySelector('ul')).toBeNull()
  })

  it('skips elements whose score action is neither split nor llm', () => {
    const text = 'First sentence here. Second sentence here also present.'
    const p = makeParagraph(text)
    applySentenceSplit([score(text, 'none' as ParagraphScore['action'])])
    expect(p.querySelector('ul')).toBeNull()
  })
})

describe('applySentenceSplit — splitting behaviour', () => {
  beforeEach(resetDOM)

  it('wraps sentences in a <ul> with one <li> each', () => {
    const text =
      'The quick brown fox jumps over the lazy dog. ' +
      'A second sentence follows directly after the first one here.'
    makeMain(`<p>${text}</p>`)

    applySentenceSplit([score(text)])

    const ul = document.querySelector('ul')
    expect(ul).not.toBeNull()
    const items = ul!.querySelectorAll('li')
    expect(items.length).toBeGreaterThanOrEqual(2)
  })

  it('stashes the original innerHTML on data-bonita-original', () => {
    const html =
      'First complete sentence is here. Second complete sentence follows it closely.'
    makeMain(`<p>${html}</p>`)

    applySentenceSplit([score(html)])

    const p = document.querySelector('p')!
    expect(p.getAttribute('data-bonita-original')).toBe(html)
  })

  it('adds the bonita-split marker class', () => {
    const text =
      'Sentence number one ends here now. Sentence number two continues right after.'
    makeMain(`<p>${text}</p>`)

    applySentenceSplit([score(text)])

    expect(document.querySelector('p')!.classList.contains('bonita-split')).toBe(true)
  })

  it('preserves inline markup (links) across sentence boundaries', () => {
    const html =
      'Visit <a href="https://example.com">our site</a> for details. ' +
      'More information is available on the linked page above.'
    makeMain(`<p>${html}</p>`)

    applySentenceSplit([score((document.querySelector('p')!.textContent ?? '').trim())])

    // At least one <a> should survive inside an <li>
    const anchors = document.querySelectorAll('li a')
    expect(anchors.length).toBeGreaterThanOrEqual(1)
  })

  it('is idempotent — calling twice does not double-wrap', () => {
    const text =
      'One sentence here for testing. Another sentence here for testing too.'
    makeMain(`<p>${text}</p>`)

    const scores = [score(text)]
    applySentenceSplit(scores)
    applySentenceSplit(scores)

    const uls = document.querySelectorAll('ul')
    expect(uls.length).toBe(1)
  })

  it('accepts llm action in addition to split', () => {
    const text =
      'A sentence produced by the LLM action path. Another LLM-action sentence here.'
    makeMain(`<p>${text}</p>`)

    applySentenceSplit([score(text, 'llm')])

    expect(document.querySelector('ul')).not.toBeNull()
  })
})

describe('applySentenceSplit — false boundary suppression', () => {
  beforeEach(resetDOM)

  it('does not split on "vs." when the continuation is lowercase', () => {
    const text =
      'We estimate that our model organism has lost more than 30% of its support from NIH in the past 5 years vs. ' +
      'a ~15% decline in total support for all fields combined. ' +
      'This represents a significant and troubling disparity worth investigating further.'
    makeMain(`<p>${text}</p>`)

    applySentenceSplit([score(text)])

    const items = document.querySelectorAll('li')
    // "vs. a ~15%..." must remain in the same <li> as the sentence that starts it
    const allText = Array.from(items).map(li => li.textContent ?? '')
    const vsItem = allText.find(t => t.includes('vs.'))
    expect(vsItem).toBeDefined()
    expect(vsItem).toMatch(/vs\.\s+a\s+~?15%/)
  })

  it('does not split on "e.g." followed by a lowercase word', () => {
    const text =
      'Some tools perform well in narrow benchmarks, e.g. image classification tasks on ImageNet. ' +
      'However, generalisation to other domains remains an open challenge for the field.'
    makeMain(`<p>${text}</p>`)

    applySentenceSplit([score(text)])

    const items = document.querySelectorAll('li')
    const allText = Array.from(items).map(li => li.textContent ?? '')
    const egItem = allText.find(t => t.includes('e.g.'))
    expect(egItem).toBeDefined()
    expect(egItem).toMatch(/e\.g\.\s+image/)
  })

  it('does not split "Roe v. Wade" in the middle', () => {
    const text =
      'The landmark ruling in Roe v. Wade was decided in 1973 by the Supreme Court. ' +
      'It was later overturned in the Dobbs decision of 2022.'
    makeMain(`<p>${text}</p>`)

    applySentenceSplit([score(text)])

    const items = document.querySelectorAll('li')
    const allText = Array.from(items).map(li => li.textContent ?? '')
    const vItem = allText.find(t => t.includes('Roe v.'))
    expect(vItem).toBeDefined()
    expect(vItem).toMatch(/Roe v\. Wade/)
  })

  it('still correctly splits two genuine sentences', () => {
    const text =
      'Dr. Smith published the findings in the journal last month. ' +
      'The results have since been independently replicated by two other research groups.'
    makeMain(`<p>${text}</p>`)

    applySentenceSplit([score(text)])

    const items = document.querySelectorAll('li')
    // Should still produce two list items despite the "Dr." abbreviation at the start
    expect(items.length).toBe(2)
  })
})

describe('applySentenceSplit + removeSentenceSplit round-trip', () => {
  beforeEach(resetDOM)

  it('fully restores the original DOM after removal', () => {
    const html =
      'The <strong>first</strong> sentence is here. ' +
      'The <em>second</em> sentence follows immediately after.'
    makeMain(`<p>${html}</p>`)

    const text = (document.querySelector('p')!.textContent ?? '').trim()
    applySentenceSplit([score(text)])

    expect(document.querySelector('ul')).not.toBeNull()

    removeSentenceSplit()

    expect(document.querySelector('ul')).toBeNull()
    expect(document.querySelector('p')!.innerHTML).toBe(html)
  })
})