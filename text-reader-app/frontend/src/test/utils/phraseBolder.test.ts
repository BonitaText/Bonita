/**
 * Tests for phraseBolder.ts
 *
 * applyPhraseBolding  — wraps keyword matches in bold spans, handles expansion,
 *                       skips citations and blocked elements, is idempotent
 * removePhraseBolding — strips all marker spans, restores plain text, normalises nodes
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { applyPhraseBolding, removePhraseBolding } from '../../content/utils/phraseBolder'

const MARKER = 'bonita-phrase-bold'

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Wraps a string array into the scored format applyPhraseBolding expects. */
function scored(...terms: string[]) {
  return terms.map((term, i) => ({ term, score: 10 - i }))
}

/** Returns all bold spans currently in the document. */
function getBoldSpans() {
  return Array.from(document.querySelectorAll(`.${MARKER}`))
}

/** Returns the text content of all bold spans joined by a single space. */
function getBoldText() {
  return getBoldSpans().map(s => s.textContent).join(' ')
}

/**
 * Sets document body HTML. All test paragraphs are padded to 30+ words so
 * the word-count filter in applyPhraseBolding doesn't silently skip them.
 * Pass raw=true to set innerHTML directly without padding (for non-<p> tests).
 */
function setBody(html: string, raw = false) {
  if (raw) {
    document.body.innerHTML = html
    return
  }
  // Pad every <p> to ensure it passes the >= 30 word filter
  const padded = html.replace(/<p>([\s\S]*?)<\/p>/g, (_, inner) => {
    const padding = ' word'.repeat(35)
    return `<p>${inner}${padding}</p>`
  })
  document.body.innerHTML = padded
}

beforeEach(() => {
  document.body.innerHTML = ''
})

// ─── removePhraseBolding ──────────────────────────────────────────────────────

describe('removePhraseBolding', () => {
  it('does nothing when no bold spans exist', () => {
    document.body.innerHTML = '<p>No bold here</p>'
    expect(() => removePhraseBolding()).not.toThrow()
  })

  it('removes all marker spans from the DOM', () => {
    document.body.innerHTML = `<p>Hello <span class="${MARKER}">world</span> today</p>`
    removePhraseBolding()
    expect(getBoldSpans()).toHaveLength(0)
  })

  it('preserves the text content after removal', () => {
    document.body.innerHTML = `<p>Hello <span class="${MARKER}">world</span> today</p>`
    removePhraseBolding()
    expect(document.body.textContent).toContain('Hello world today')
  })

  it('handles multiple spans in the same paragraph', () => {
    document.body.innerHTML = `
      <p>
        <span class="${MARKER}">Alpha</span> and
        <span class="${MARKER}">Beta</span> are both removed.
      </p>`
    removePhraseBolding()
    expect(getBoldSpans()).toHaveLength(0)
    expect(document.body.textContent).toContain('Alpha')
    expect(document.body.textContent).toContain('Beta')
  })
})

// ─── applyPhraseBolding — basic matching ─────────────────────────────────────

describe('applyPhraseBolding', () => {
  it('does nothing when scored list is empty', async () => {
    setBody('<p>Some text on the page here today.</p>')
    await applyPhraseBolding([], 50)
    expect(getBoldSpans()).toHaveLength(0)
  })

  it('wraps a matching single word in a bold span', async () => {
    setBody('<p>The climate crisis is urgent and real today.</p>')
    await applyPhraseBolding(scored('climate'), 100)
    expect(getBoldText()).toContain('climate')
  })

  it('matches case-insensitively', async () => {
    setBody('<p>The Climate crisis is urgent today.</p>')
    await applyPhraseBolding(scored('climate'), 100)
    expect(getBoldSpans().length).toBeGreaterThan(0)
  })

  it('wraps a multi-word target as a single span', async () => {
    setBody('<p>The climate crisis is the defining issue today.</p>')
    await applyPhraseBolding(scored('climate crisis'), 100)
    const spans = getBoldSpans()
    expect(spans.length).toBeGreaterThan(0)
    expect(spans[0].textContent).toMatch(/climate crisis/i)
  })

  it('applies the correct class and style to spans', async () => {
    setBody('<p>The climate crisis is urgent today.</p>')
    await applyPhraseBolding(scored('climate'), 100)
    const span = getBoldSpans()[0]
    expect(span.className).toBe(MARKER)
    expect((span as HTMLElement).style.fontWeight).toBe('800')
  })

  it('removes existing bolding before re-applying (idempotent)', async () => {
    setBody('<p>The climate crisis is urgent today.</p>')
    await applyPhraseBolding(scored('climate'), 100)
    await applyPhraseBolding(scored('climate'), 100)
    expect(getBoldSpans()).toHaveLength(1)
  })

  // ── Threshold behaviour ────────────────────────────────────────────────────

  it('bolds top-ranked term at low threshold', async () => {
    setBody('<p>The climate crisis and carbon emissions are urgent today.</p>')
    // score: climate=10, carbon=9 — at 50% only top 1 of 2 present terms bolds
    await applyPhraseBolding(scored('climate', 'carbon'), 50)
    expect(getBoldText()).toContain('climate')
  })

  it('bolds all terms at 100% threshold', async () => {
    setBody('<p>The climate crisis and carbon emissions are urgent today.</p>')
    await applyPhraseBolding(scored('climate', 'carbon'), 100)
    expect(getBoldText()).toContain('climate')
    expect(getBoldText()).toContain('carbon')
  })

  // ── Blocked elements ───────────────────────────────────────────────────────

  it('does not bold text inside <code> elements', async () => {
    setBody('<p>See <code>climate</code> for details today.</p>')
    await applyPhraseBolding(scored('climate'), 100)
    expect(getBoldSpans()).toHaveLength(0)
  })

  it('does not bold text inside <nav>', async () => {
    document.body.innerHTML = '<nav><p>climate crisis navigation menu here.</p></nav>'
    await applyPhraseBolding(scored('climate'), 100)
    expect(getBoldSpans()).toHaveLength(0)
  })

  it('does not bold text inside <script>', async () => {
    document.body.innerHTML = '<script>var climate = "crisis";</script>'
    await applyPhraseBolding(scored('climate'), 100)
    expect(getBoldSpans()).toHaveLength(0)
  })

  // ── Noun phrase expansion ──────────────────────────────────────────────────

  it('expands rightward to include a proper noun chain', async () => {
    setBody('<p>The report was released by the United Nations Security Council last week.</p>')
    await applyPhraseBolding(scored('United'), 100)
    expect(getBoldText()).toMatch(/United Nations/i)
  })

  it('expands to include hyphen-compound words', async () => {
    setBody('<p>This is a well-known issue in the field today.</p>')
    await applyPhraseBolding(scored('well'), 100)
    expect(getBoldText()).toContain('well-known')
  })
})

// ─── Citation skipping — flat DOM ────────────────────────────────────────────

describe('citation skipping — flat DOM', () => {
  it('does not bold an author name inside a parenthetical year citation', async () => {
    setBody('<p>Notch mediates cell interactions (Louvi and Artavanis-Tsakonas 2012; Yamamoto et al. 2014b).</p>')
    await applyPhraseBolding(scored('Yamamoto'), 100)
    expect(getBoldSpans()).toHaveLength(0)
  })

  it('does not bold an author name followed by "et al" inside parens', async () => {
    setBody('<p>This was shown (Smith et al. 2021) to be effective today.</p>')
    await applyPhraseBolding(scored('Smith'), 100)
    expect(getBoldSpans()).toHaveLength(0)
  })

  it('does bold the same word when it appears OUTSIDE a citation', async () => {
    setBody('<p>Johnson argued (Jones 2019) that the evidence is clear today.</p>')
    await applyPhraseBolding(scored('Johnson'), 100)
    expect(getBoldSpans().length).toBeGreaterThan(0)
    expect(getBoldText()).toMatch(/Johnson/i)
  })

  it('does not bold the second author in a semicolon-separated citation', async () => {
    setBody('<p>Signalling cascades were described (Hanahan 2011; Weinberg et al. 2014) in detail.</p>')
    await applyPhraseBolding(scored('Weinberg'), 100)
    expect(getBoldSpans()).toHaveLength(0)
  })

  it('does not bolt a year-only citation — but does bold the word outside it', async () => {
    setBody('<p>The phenomenon was confirmed (2019) across multiple cohorts in this study.</p>')
    await applyPhraseBolding(scored('confirmed'), 100)
    expect(getBoldSpans().length).toBeGreaterThan(0)
  })

  it('does not treat a non-citation parenthetical as a citation', async () => {
    setBody('<p>The procedure (see Methods) was performed by trained technicians today.</p>')
    await applyPhraseBolding(scored('Methods'), 100)
    expect(getBoldSpans().length).toBeGreaterThan(0)
    expect(getBoldText()).toMatch(/Methods/i)
  })

  it('does not treat a figure reference as a citation', async () => {
    setBody('<p>The results are shown (Figure 1A) and confirm the hypothesis of the study.</p>')
    await applyPhraseBolding(scored('Figure'), 100)
    expect(getBoldSpans().length).toBeGreaterThan(0)
  })
})

// ─── Citation skipping — split DOM ───────────────────────────────────────────

describe('citation skipping — split DOM', () => {
  it('skips an author name in a citation whose "(" is separated by an <a> link', async () => {
    setBody('<p>Notch causes numerous diseases (<a href="#">Notch signalling</a> Yamamoto et al. 2014b).</p>')
    await applyPhraseBolding(scored('Yamamoto'), 100)
    expect(getBoldSpans()).toHaveLength(0)
  })

  it('skips all authors when multiple <a> links split a multi-author citation', async () => {
    setBody('<p>This was shown (<a href="#">ref</a> Smith 2020; <a href="#">ref</a> Jones et al. 2021).</p>')
    await applyPhraseBolding(scored('Smith', 'Jones'), 100)
    expect(getBoldSpans()).toHaveLength(0)
  })

  it('still bolds the same author name when it appears OUTSIDE the split citation', async () => {
    setBody('<p>Yamamoto first described this pathway. Later work (<a href="#">source</a> Yamamoto et al. 2019) confirmed it.</p>')
    await applyPhraseBolding(scored('Yamamoto'), 100)
    expect(getBoldSpans()).toHaveLength(1)
    const para = document.querySelector('p')!
    const span = getBoldSpans()[0]
    const spanOffset = para.textContent!.indexOf(span.textContent!)
    const citationOffset = para.textContent!.indexOf('(')
    expect(spanOffset).toBeLessThan(citationOffset)
  })

  it('skips an author name when an <em> element splits the citation', async () => {
    setBody('<p>Cell interactions (<em>Drosophila</em> Yamamoto et al. 2014b) are well characterised.</p>')
    await applyPhraseBolding(scored('Yamamoto'), 100)
    expect(getBoldSpans()).toHaveLength(0)
  })

  it('skips a year-bearing citation split by an <em> even without "et al"', async () => {
    setBody('<p>The effect was confirmed (<em>see also</em> Patel 2018) in cohort studies today.</p>')
    await applyPhraseBolding(scored('Patel'), 100)
    expect(getBoldSpans()).toHaveLength(0)
  })

  it('skips an author name when a <sup> footnote marker splits the citation', async () => {
    setBody('<p>Numerous diseases (<sup>14</sup> Yamamoto et al. 2014b) have been linked to this pathway.</p>')
    await applyPhraseBolding(scored('Yamamoto'), 100)
    expect(getBoldSpans()).toHaveLength(0)
  })

  it('skips author name when <sup> reference number appears between two authors', async () => {
    setBody('<p>This is supported (Smith 2019;<sup>15</sup> Jones et al. 2021) by the literature.</p>')
    await applyPhraseBolding(scored('Jones'), 100)
    expect(getBoldSpans()).toHaveLength(0)
  })

  it('skips an author name when a <span> wrapper splits the citation text', async () => {
    setBody('<p>Notch signalling (<span>Artavanis-Tsakonas</span> 2012; Yamamoto et al. 2014b) is conserved.</p>')
    await applyPhraseBolding(scored('Yamamoto'), 100)
    expect(getBoldSpans()).toHaveLength(0)
  })

  it('reproduces the exact Louvi / Yamamoto sentence with an <a> split — neither author bolds', async () => {
    setBody(
      '<p>Notch mediates cell–cell interactions in diverse contexts, and aberrations in Notch signal ' +
      'transduction can cause numerous cancer and other human diseases ' +
      '(<a href="https://doi.org/10.1242/dev.01438">Louvi and Artavanis-Tsakonas 2012</a>; ' +
      'Yamamoto et al. 2014b).</p>'
    )
    await applyPhraseBolding(scored('Yamamoto', 'Louvi'), 100)
    expect(getBoldSpans()).toHaveLength(0)
  })

  it('reproduces the Louvi / Yamamoto sentence — "Notch" outside the citation still bolds', async () => {
    setBody(
      '<p>Notch mediates cell–cell interactions in diverse contexts, and aberrations in Notch signal ' +
      'transduction can cause numerous cancer and other human diseases ' +
      '(<a href="https://doi.org/10.1242/dev.01438">Louvi and Artavanis-Tsakonas 2012</a>; ' +
      'Yamamoto et al. 2014b).</p>'
    )
    await applyPhraseBolding(scored('Notch'), 100)
    expect(getBoldSpans().length).toBeGreaterThanOrEqual(1)
    getBoldSpans().forEach(s => expect(s.textContent).toMatch(/Notch/i))
  })
})

// ─── Dotted abbreviations (U.S. bug) ─────────────────────────────────────────
//
// These document the known regex limitation with dotted abbreviations.
// Tests tagged [bug] lock in current broken behaviour.
// Tests tagged [regression guard] should be flipped once the bug is fixed.
// Tests tagged [control] must always pass.

describe('applyPhraseBolding — dotted abbreviations (U.S. bug)', () => {
  it('[bug] documents what slice gets bolded for "u.s" mid-sentence', async () => {
    setBody('<p>Researchers at U.S. universities published findings on metabolic disorders.</p>')
    await applyPhraseBolding(scored('u.s'), 100)
    const bolded = getBoldSpans().map(s => s.textContent)
    expect(getBoldSpans().length).toMatchSnapshot()
    expect(bolded).toMatchSnapshot()
  })

  it('[bug] documents what slice gets bolded for "u.s" at sentence start', async () => {
    setBody('<p>U.S. health authorities continue to monitor adverse event reports quarterly.</p>')
    await applyPhraseBolding(scored('u.s'), 100)
    const bolded = getBoldSpans().map(s => s.textContent)
    expect(getBoldSpans().length).toMatchSnapshot()
    expect(bolded).toMatchSnapshot()
  })

  it('[bug] documents what happens when "u.s." (trailing dot) is the target', async () => {
    setBody('<p>The U.S. government invested heavily in vaccine development programs.</p>')
    await applyPhraseBolding(scored('u.s.'), 100)
    const bolded = getBoldSpans().map(s => s.textContent)
    expect(getBoldSpans().length).toMatchSnapshot()
    expect(bolded).toMatchSnapshot()
  })

  it('[bug] documents what happens with "u.s.a" mid-sentence', async () => {
    setBody('<p>Funding from U.S.A. agencies accelerated the clinical trial approval process.</p>')
    await applyPhraseBolding(scored('u.s.a'), 100)
    const bolded = getBoldSpans().map(s => s.textContent)
    expect(getBoldSpans().length).toMatchSnapshot()
    expect(bolded).toMatchSnapshot()
  })

  it('[bug] does NOT bold the full token "U.S." as a single span', async () => {
    setBody('<p>The U.S. Food and Drug Administration approved the treatment last year.</p>')
    await applyPhraseBolding(scored('u.s'), 100)
    const bolded = getBoldSpans().map(s => s.textContent)
    // Flip to: expect(bolded).toEqual(['U.S.']) once fixed
    expect(bolded).not.toEqual(['U.S.'])
  })

  it('[regression guard] U.S. is NOT currently bolded as a full span', async () => {
    setBody('<p>The U.S. Food and Drug Administration approved the treatment last year.</p>')
    await applyPhraseBolding(scored('u.s'), 100)
    const bolded = getBoldSpans().map(s => s.textContent)
    // Remove .not and change to: expect(bolded).toEqual(['U.S.']) once fixed
    expect(bolded).not.toEqual(['U.S.'])
  })

  it('[control] plain "WHO" without dots bolds correctly', async () => {
    setBody('<p>The WHO issued a global alert for the outbreak detected in Asia.</p>')
    await applyPhraseBolding(scored('who'), 100)
    expect(getBoldSpans().length).toBeGreaterThan(0)
    expect(getBoldText()).toMatch(/WHO/i)
  })

  it('[control] plain "DNA" without dots bolds correctly', async () => {
    setBody('<p>DNA repair mechanisms protect cells from mutation and damage over time.</p>')
    await applyPhraseBolding(scored('dna'), 100)
    expect(getBoldSpans().length).toBeGreaterThan(0)
    expect(getBoldText()).toMatch(/DNA/i)
  })
})