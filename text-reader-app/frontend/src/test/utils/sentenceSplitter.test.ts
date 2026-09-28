/**
 * @file utils/sentenceSplitter.test.ts
 *
 * Unit and integration tests for the sentenceSplitter module.
 *
 * DOM environment is provided by jsdom (configured via vitest's `environment:
 * "jsdom"` setting or Jest's `testEnvironment: "jsdom"`).
 *
 * ── What changed from the previous version ────────────────────────────────
 *
 *  1. applySentenceSplit is now ASYNC (it awaits getFreqMap and
 *     scoreParagraph). Every call must be awaited, otherwise assertions run
 *     before the DOM has been rewritten.
 *
 *  2. applySentenceSplit no longer takes a ParagraphScore[]. It takes an
 *     options object: { overrideScores?, thresholdPercent? }.
 *       • Paragraphs are discovered internally via collectBlockElements, so
 *         the caller no longer supplies (or matches) paragraph text.
 *       • Scoring is per SENTENCE and ranked page-wide. Tests that just want
 *         "split everything" pass { thresholdPercent: 100 }.
 *       • overrideScores are matched against exact SENTENCE text, and only
 *         an action of 'split' produces a bullet.
 *
 *  3. Candidate blocks must contain at least MIN_SPLIT_CANDIDATE_WORDS (20)
 *     words, so every fixture below is deliberately longer than 20 words.
 *
 *  4. Output is "mixed content": selected sentences become <li>s in a shared
 *     <ul>, unselected sentences stay as prose.
 *
 * getContentRoot() caches its result, so resetDOM() also calls
 * invalidateContentRootCache().
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { applySentenceSplit, removeSentenceSplit } from '../../content/utils/sentenceSplitter'
import { invalidateContentRootCache } from '../../content/utils/contentRoot'
import type { ParagraphScore } from '../../content/utils/analysisCache'

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Sensitivity 100 = every sentence on the page becomes a bullet. */
const SPLIT_ALL = { thresholdPercent: 100 }

/**
 * Creates a `<p>` element with the given HTML, appended to `document.body`,
 * and returns it.
 */
function makeParagraph(html: string): HTMLParagraphElement {
  const p = document.createElement('p')
  p.innerHTML = html
  document.body.appendChild(p)
  return p
}

/** Wraps HTML in a minimal `<main>` element appended to `document.body`. */
function makeMain(html: string): HTMLElement {
  const main = document.createElement('main')
  main.innerHTML = html
  document.body.appendChild(main)
  return main
}

/** Removes everything appended to body between tests and resets the root cache. */
function resetDOM() {
  document.body.innerHTML = ''
  invalidateContentRootCache()
}

/** Builds a {@link ParagraphScore} override for an exact sentence. */
function override(text: string, action: ParagraphScore['action']): ParagraphScore {
  return { text, action }
}

// Fixtures — every block has >= 20 words (MIN_SPLIT_CANDIDATE_WORDS).
const S1 = 'The quick brown fox jumps over the lazy dog near the old riverbank every single morning.'
const S2 = 'A second sentence follows directly after the first one and adds enough words to clear the floor.'
const TWO_SENTENCES = `${S1} ${S2}`

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

  it('does nothing when the page has no candidate paragraphs', async () => {
    const p = makeParagraph('Some text here.') // < 20 words
    await applySentenceSplit(SPLIT_ALL)
    expect(p.querySelector('ul')).toBeNull()
  })

  it('does nothing when called with no options and no eligible content', async () => {
    const p = makeParagraph('Some text here.')
    await expect(applySentenceSplit()).resolves.toBeUndefined()
    expect(p.querySelector('ul')).toBeNull()
  })

  it('skips elements inside #bonita-root', async () => {
    const root = document.createElement('div')
    root.id = 'bonita-root'
    root.innerHTML = `<p>${TWO_SENTENCES}</p>`
    document.body.appendChild(root)

    await applySentenceSplit(SPLIT_ALL)

    expect(root.querySelector('ul')).toBeNull()
  })

  it('skips elements inside blocked tags (pre)', async () => {
    const pre = document.createElement('pre')
    const div = document.createElement('div')
    div.textContent = TWO_SENTENCES
    pre.appendChild(div)
    document.body.appendChild(pre)

    await applySentenceSplit(SPLIT_ALL)

    expect(pre.querySelector('ul')).toBeNull()
  })

  it('skips captions inside <figure>', async () => {
    const figure = document.createElement('figure')
    figure.innerHTML = `<figcaption>${TWO_SENTENCES}</figcaption>`
    document.body.appendChild(figure)

    await applySentenceSplit(SPLIT_ALL)

    expect(figure.querySelector('ul')).toBeNull()
  })

  it('skips blocks already inside a native list', async () => {
    const ul = document.createElement('ul')
    ul.innerHTML = `<li>${TWO_SENTENCES}</li>`
    document.body.appendChild(ul)

    await applySentenceSplit(SPLIT_ALL)

    expect(ul.querySelectorAll('ul').length).toBe(0)
    expect(ul.querySelectorAll('li').length).toBe(1)
  })
})

describe('applySentenceSplit — override scores', () => {
  beforeEach(resetDOM)

  it('bullets a sentence whose override action is "split" and leaves others as prose', async () => {
    const p = makeMain(`<p>${TWO_SENTENCES}</p>`).querySelector('p')!

    await applySentenceSplit({
      overrideScores: [override(S1, 'split'), override(S2, 'none' as ParagraphScore['action'])],
    })

    const items = p.querySelectorAll('li')
    expect(items.length).toBe(1)
    expect(items[0].textContent).toBe(S1)
    // S2 is still present, but outside the list
    expect(p.textContent).toContain(S2)
    expect(p.querySelector('ul')!.textContent).not.toContain(S2)
  })

  it('does not split when every sentence is overridden to a non-split action', async () => {
    const p = makeMain(`<p>${TWO_SENTENCES}</p>`).querySelector('p')!

    await applySentenceSplit({
      overrideScores: [
        override(S1, 'none' as ParagraphScore['action']),
        override(S2, 'none' as ParagraphScore['action']),
      ],
    })

    expect(p.querySelector('ul')).toBeNull()
    expect(p.classList.contains('bonita-split')).toBe(false)
  })

})

describe('applySentenceSplit — splitting behaviour', () => {
  beforeEach(resetDOM)

  it('wraps sentences in a <ul> with one <li> each', async () => {
    makeMain(`<p>${TWO_SENTENCES}</p>`)

    await applySentenceSplit(SPLIT_ALL)

    const ul = document.querySelector('ul')
    expect(ul).not.toBeNull()
    expect(ul!.querySelectorAll('li').length).toBeGreaterThanOrEqual(2)
  })

  it('stashes the original innerHTML on data-bonita-original', async () => {
    makeMain(`<p>${TWO_SENTENCES}</p>`)

    await applySentenceSplit(SPLIT_ALL)

    const p = document.querySelector('p')!
    expect(p.getAttribute('data-bonita-original')).toBe(TWO_SENTENCES)
  })

  it('adds the bonita-split marker class', async () => {
    makeMain(`<p>${TWO_SENTENCES}</p>`)

    await applySentenceSplit(SPLIT_ALL)

    expect(document.querySelector('p')!.classList.contains('bonita-split')).toBe(true)
  })

  it('preserves inline markup (links) across sentence boundaries', async () => {
    const html =
      'Visit <a href="https://example.com">our site</a> for details about the project and its long history. ' +
      'More information is available on the linked page above, along with several other helpful resources.'
    makeMain(`<p>${html}</p>`)

    await applySentenceSplit(SPLIT_ALL)

    expect(document.querySelectorAll('li a').length).toBeGreaterThanOrEqual(1)
  })

  it('is idempotent — calling twice does not double-wrap', async () => {
    makeMain(`<p>${TWO_SENTENCES}</p>`)

    await applySentenceSplit(SPLIT_ALL)
    await applySentenceSplit(SPLIT_ALL)

    expect(document.querySelectorAll('ul').length).toBe(1)
  })
})

describe('applySentenceSplit — false boundary suppression', () => {
  beforeEach(resetDOM)

  it('does not split on "vs." when the continuation is lowercase', async () => {
    const text =
      'We estimate that our model organism has lost more than 30% of its support from NIH in the past 5 years vs. ' +
      'a ~15% decline in total support for all fields combined. ' +
      'This represents a significant and troubling disparity worth investigating further.'
    makeMain(`<p>${text}</p>`)

    await applySentenceSplit(SPLIT_ALL)

    const allText = Array.from(document.querySelectorAll('li')).map(li => li.textContent ?? '')
    const vsItem = allText.find(t => t.includes('vs.'))
    expect(vsItem).toBeDefined()
    expect(vsItem).toMatch(/vs\.\s+a\s+~?15%/)
  })

  it('does not split on "e.g." followed by a lowercase word', async () => {
    const text =
      'Some tools perform well in narrow benchmarks, e.g. image classification tasks on ImageNet. ' +
      'However, generalisation to other domains remains an open challenge for the field.'
    makeMain(`<p>${text}</p>`)

    await applySentenceSplit(SPLIT_ALL)

    const allText = Array.from(document.querySelectorAll('li')).map(li => li.textContent ?? '')
    const egItem = allText.find(t => t.includes('e.g.'))
    expect(egItem).toBeDefined()
    expect(egItem).toMatch(/e\.g\.\s+image/)
  })

  it('does not split "Roe v. Wade" in the middle', async () => {
    const text =
      'The landmark ruling in Roe v. Wade was decided in 1973 by the Supreme Court. ' +
      'It was later overturned in the Dobbs decision of 2022.'
    makeMain(`<p>${text}</p>`)

    await applySentenceSplit(SPLIT_ALL)

    const allText = Array.from(document.querySelectorAll('li')).map(li => li.textContent ?? '')
    const vItem = allText.find(t => t.includes('Roe v.'))
    expect(vItem).toBeDefined()
    expect(vItem).toMatch(/Roe v\. Wade/)
  })

  it('still correctly splits two genuine sentences', async () => {
    const text =
      'Dr. Smith published the findings in the journal last month. ' +
      'The results have since been independently replicated by two other research groups.'
    makeMain(`<p>${text}</p>`)

    await applySentenceSplit(SPLIT_ALL)

    // Two list items despite the "Dr." abbreviation at the start
    expect(document.querySelectorAll('li').length).toBe(2)
  })
})

describe('applySentenceSplit + removeSentenceSplit round-trip', () => {
  beforeEach(resetDOM)

  it('fully restores the original DOM after removal', async () => {
    const html =
      'The <strong>first</strong> sentence is here and it is long enough to matter for the test. ' +
      'The <em>second</em> sentence follows immediately after and also carries enough words to pass.'
    makeMain(`<p>${html}</p>`)

    await applySentenceSplit(SPLIT_ALL)
    expect(document.querySelector('ul')).not.toBeNull()

    removeSentenceSplit()

    expect(document.querySelector('ul')).toBeNull()
    expect(document.querySelector('p')!.innerHTML).toBe(html)
  })
})