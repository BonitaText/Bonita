/**
 * Tests for phraseBolder.ts
 *
 * applyPhraseBolding  — wraps keyword matches in bold spans, handles expansion,
 *                       skips citations and blocked elements, is idempotent
 * removePhraseBolding — strips all marker spans, restores plain text, normalises nodes
 *
 * Internal helpers (expandLeft, expandNounPhrase, isInCitation, isSentenceBoundary,
 * getTextNodeOffset) are exercised indirectly through the exported functions.
 *
 * Citation-skipping tests are split into two suites:
 *
 *   "citation skipping — flat DOM"
 *     The entire paragraph is one uninterrupted text node (plain innerHTML string).
 *     These are the easy cases and were already passing before the split-node fix.
 *
 *   "citation skipping — split DOM"
 *     Inline elements (<a>, <em>, <sup>, etc.) carve the paragraph into multiple
 *     text nodes, placing the opening '(' of a citation in a different node from
 *     the author name.  These are the cases that were silently broken and motivated
 *     the getTextNodeOffset + parent-text approach in boldTextNode.
 *
 * The U.S. / dotted-abbreviation suite at the bottom documents the known regex
 * bug where applyPhraseBolding mishandles dotted targets like "u.s".
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { applyPhraseBolding, removePhraseBolding } from '../../content/utils/phraseBolder'

const MARKER = 'bonita-phrase-bold'

/** Returns all bold spans currently in the document. */
function getBoldSpans() {
  return Array.from(document.querySelectorAll(`.${MARKER}`))
}

/** Returns the text content of all bold spans joined by a single space. */
function getBoldText() {
  return getBoldSpans().map(s => s.textContent).join(' ')
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
  it('does nothing when boldTargets is empty', () => {
    document.body.innerHTML = '<p>Some text on the page here today.</p>'
    applyPhraseBolding([])
    expect(getBoldSpans()).toHaveLength(0)
  })

  it('wraps a matching single word in a bold span', () => {
    document.body.innerHTML = '<p>The climate crisis is urgent and real today.</p>'
    applyPhraseBolding(['climate'])
    expect(getBoldText()).toContain('climate')
  })

  it('matches case-insensitively', () => {
    document.body.innerHTML = '<p>The Climate crisis is urgent today.</p>'
    applyPhraseBolding(['climate'])
    expect(getBoldSpans().length).toBeGreaterThan(0)
  })

  it('wraps a multi-word target as a single span', () => {
    document.body.innerHTML = '<p>The climate crisis is the defining issue today.</p>'
    applyPhraseBolding(['climate crisis'])
    const spans = getBoldSpans()
    expect(spans.length).toBeGreaterThan(0)
    expect(spans[0].textContent).toMatch(/climate crisis/i)
  })

  it('applies the correct class and style to spans', () => {
    document.body.innerHTML = '<p>The climate crisis is urgent today.</p>'
    applyPhraseBolding(['climate'])
    const span = getBoldSpans()[0]
    expect(span.className).toBe(MARKER)
    expect((span as HTMLElement).style.fontWeight).toBe('800')
  })

  it('removes existing bolding before re-applying (idempotent)', () => {
    document.body.innerHTML = '<p>The climate crisis is urgent today.</p>'
    applyPhraseBolding(['climate'])
    applyPhraseBolding(['climate'])
    expect(getBoldSpans()).toHaveLength(1)
  })

  // ── Blocked elements ───────────────────────────────────────────────────────

  it('does not bold text inside <code> elements', () => {
    document.body.innerHTML = '<p>See <code>climate</code> for details today.</p>'
    applyPhraseBolding(['climate'])
    expect(getBoldSpans()).toHaveLength(0)
  })

  it('does not bold text inside <nav>', () => {
    document.body.innerHTML = '<nav><p>climate crisis navigation menu here.</p></nav>'
    applyPhraseBolding(['climate'])
    expect(getBoldSpans()).toHaveLength(0)
  })

  it('does not bold text inside <script>', () => {
    document.body.innerHTML = '<script>var climate = "crisis";</script>'
    applyPhraseBolding(['climate'])
    expect(getBoldSpans()).toHaveLength(0)
  })

  // ── Noun phrase expansion ──────────────────────────────────────────────────

  it('expands rightward to include a proper noun chain', () => {
    document.body.innerHTML =
      '<p>The report was released by the United Nations Security Council last week.</p>'
    applyPhraseBolding(['United'])
    expect(getBoldText()).toMatch(/United Nations/i)
  })

  it('expands to include hyphen-compound words', () => {
    document.body.innerHTML = '<p>This is a well-known issue in the field today.</p>'
    applyPhraseBolding(['well'])
    expect(getBoldText()).toContain('well-known')
  })
})

// ─── Citation skipping — flat DOM ────────────────────────────────────────────
//
// All text lives in a single unbroken text node inside the <p>.
// These cases were passing before the split-node fix and must stay green.

describe('citation skipping — flat DOM', () => {
  it('does not bold an author name inside a parenthetical year citation', () => {
    document.body.innerHTML =
      '<p>Notch mediates cell–cell interactions (Louvi and Artavanis-Tsakonas 2012; Yamamoto et al. 2014b).</p>'
    applyPhraseBolding(['Yamamoto'])
    expect(getBoldSpans()).toHaveLength(0)
  })

  it('does not bold an author name followed by "et al" inside parens', () => {
    document.body.innerHTML =
      '<p>This was shown (Smith et al. 2021) to be effective today.</p>'
    applyPhraseBolding(['Smith'])
    expect(getBoldSpans()).toHaveLength(0)
  })

  it('does bold the same word when it appears OUTSIDE a citation', () => {
    document.body.innerHTML =
      '<p>Johnson argued (Jones 2019) that the evidence is clear today.</p>'
    applyPhraseBolding(['Johnson'])
    expect(getBoldSpans().length).toBeGreaterThan(0)
    expect(getBoldText()).toMatch(/Johnson/i)
  })

  it('does not bold the second author in a semicolon-separated citation', () => {
    // "(Author1 2012; Author2 et al. 2014)" — Author2 must also be blocked.
    document.body.innerHTML =
      '<p>Signalling cascades were described (Hanahan 2011; Weinberg et al. 2014) in detail.</p>'
    applyPhraseBolding(['Weinberg'])
    expect(getBoldSpans()).toHaveLength(0)
  })

  it('does not bold a year-only citation like "(2019)"', () => {
    // No author name to bold, but the year token must not leak out.
    document.body.innerHTML =
      '<p>The phenomenon was confirmed (2019) across multiple cohorts in this study.</p>'
    applyPhraseBolding(['confirmed'])
    // "confirmed" is outside the parens and is a valid bold target
    expect(getBoldSpans().length).toBeGreaterThan(0)
  })

  it('does not treat a non-citation parenthetical as a citation', () => {
    // "(see Methods)" contains no year and no "et al" — must NOT block.
    document.body.innerHTML =
      '<p>The procedure (see Methods) was performed by trained technicians today.</p>'
    applyPhraseBolding(['Methods'])
    expect(getBoldSpans().length).toBeGreaterThan(0)
    expect(getBoldText()).toMatch(/Methods/i)
  })

  it('does not treat a figure reference as a citation', () => {
    document.body.innerHTML =
      '<p>The results are shown (Figure 1A) and confirm the hypothesis of the study.</p>'
    applyPhraseBolding(['Figure'])
    // "Figure" is inside parens but there is no year — should be bolded.
    expect(getBoldSpans().length).toBeGreaterThan(0)
  })
})

// ─── Citation skipping — split DOM ───────────────────────────────────────────
//
// Inline elements (<a>, <em>, <sup>, etc.) split the paragraph into multiple
// text nodes.  The opening '(' of the citation lands in a different text node
// from the author name being tested.  Before the getTextNodeOffset fix, every
// one of these cases would incorrectly bold the author name.
//
// Structure key used in each test comment:
//   [text-node-1] <inline-element>[text-node-2]</inline-element> [text-node-3]
//
// The author name targeted for bolding always lives in text-node-3 (after the
// inline element), while '(' lives in text-node-1 (before it).

describe('citation skipping — split DOM', () => {
  // ── <a> splits ────────────────────────────────────────────────────────────

  it('skips an author name in a citation whose "(" is separated by an <a> link', () => {
    // Publisher markup: journal title is a hyperlink sitting between the
    // opening paren and the author name.
    // DOM: ["diseases ("] <a>["Notch signalling"]</a> [" Yamamoto et al. 2014b)."]
    document.body.innerHTML =
      '<p>Notch causes numerous diseases (<a href="#">Notch signalling</a> Yamamoto et al. 2014b).</p>'
    applyPhraseBolding(['Yamamoto'])
    expect(getBoldSpans()).toHaveLength(0)
  })

  it('skips all authors when multiple <a> links split a multi-author citation', () => {
    // DOM: ["shown ("] <a>["ref"]</a> [" Smith 2020; "] <a>["ref"]</a> [" Jones et al. 2021)."]
    document.body.innerHTML =
      '<p>This was shown (<a href="#">ref</a> Smith 2020; <a href="#">ref</a> Jones et al. 2021).</p>'
    applyPhraseBolding(['Smith', 'Jones'])
    expect(getBoldSpans()).toHaveLength(0)
  })

  it('still bolds the same author name when it appears OUTSIDE the split citation', () => {
    // "Yamamoto" appears once in body text (should bold) and once in the split citation (should not).
    document.body.innerHTML =
      '<p>Yamamoto first described this pathway. Later work (<a href="#">source</a> Yamamoto et al. 2019) confirmed it.</p>'
    applyPhraseBolding(['Yamamoto'])
    // Only the first (outside-citation) occurrence should be bolded.
    expect(getBoldSpans()).toHaveLength(1)
    // The bolded span must come before the citation, not inside it.
    const para = document.querySelector('p')!
    const span = getBoldSpans()[0]
    const spanOffset = para.textContent!.indexOf(span.textContent!)
    const citationOffset = para.textContent!.indexOf('(')
    expect(spanOffset).toBeLessThan(citationOffset)
  })

  // ── <em> splits ───────────────────────────────────────────────────────────

  it('skips an author name when an <em> element splits the citation', () => {
    // Biology papers often italicise genus names inline inside citations.
    // DOM: ["interactions ("] <em>["Drosophila"]</em> [" Yamamoto et al. 2014b)."]
    document.body.innerHTML =
      '<p>Cell interactions (<em>Drosophila</em> Yamamoto et al. 2014b) are well characterised.</p>'
    applyPhraseBolding(['Yamamoto'])
    expect(getBoldSpans()).toHaveLength(0)
  })

  it('skips a year-bearing citation split by an <em> even without "et al"', () => {
    // Single-author citation: no "et al", but year is present.
    // DOM: ["confirmed ("] <em>["see also"]</em> [" Patel 2018) in cohort studies."]
    document.body.innerHTML =
      '<p>The effect was confirmed (<em>see also</em> Patel 2018) in cohort studies today.</p>'
    applyPhraseBolding(['Patel'])
    expect(getBoldSpans()).toHaveLength(0)
  })

  // ── <sup> splits (footnote / numbered reference style) ────────────────────

  it('skips an author name when a <sup> footnote marker splits the citation', () => {
    // Some CMS platforms render citations as: text<sup>1</sup>(Author year)
    // where the superscript sits inside the opening paren's text node.
    // DOM: ["diseases ("] <sup>["14"]</sup> [" Yamamoto et al. 2014b)."]
    document.body.innerHTML =
      '<p>Numerous diseases (<sup>14</sup> Yamamoto et al. 2014b) have been linked to this pathway.</p>'
    applyPhraseBolding(['Yamamoto'])
    expect(getBoldSpans()).toHaveLength(0)
  })

  it('skips author name when <sup> reference number appears between two authors', () => {
    // DOM: ["(Smith 2019;"] <sup>["15"]</sup> [" Jones et al. 2021)"]
    document.body.innerHTML =
      '<p>This is supported (Smith 2019;<sup>15</sup> Jones et al. 2021) by the literature.</p>'
    applyPhraseBolding(['Jones'])
    expect(getBoldSpans()).toHaveLength(0)
  })

  // ── <span> splits (e.g. from prior bolding or CMS wrappers) ──────────────

  it('skips an author name when a <span> wrapper splits the citation text', () => {
    // Some CMSes wrap individual words in <span> for styling; the resulting
    // text-node split is identical to the <a>/<em> case.
    // DOM: ["("] <span>["Artavanis-Tsakonas"]</span> [" 2012; Yamamoto et al. 2014b)"]
    document.body.innerHTML =
      '<p>Notch signalling (<span>Artavanis-Tsakonas</span> 2012; Yamamoto et al. 2014b) is conserved.</p>'
    applyPhraseBolding(['Yamamoto'])
    expect(getBoldSpans()).toHaveLength(0)
  })

  // ── Realistic full-sentence reproductions ─────────────────────────────────

  it('reproduces the exact Louvi / Yamamoto sentence with an <a> split — neither author bolds', () => {
    // This is the original failing case that motivated the fix, reconstructed
    // with an <a> tag as would appear on a publisher page linking to the source.
    document.body.innerHTML =
      '<p>Notch mediates cell–cell interactions in diverse contexts, and aberrations in Notch signal ' +
      'transduction can cause numerous cancer and other human diseases ' +
      '(<a href="https://doi.org/10.1242/dev.01438">Louvi and Artavanis-Tsakonas 2012</a>; ' +
      'Yamamoto et al. 2014b).</p>'
    applyPhraseBolding(['Yamamoto', 'Louvi'])
    expect(getBoldSpans()).toHaveLength(0)
  })

  it('reproduces the Louvi / Yamamoto sentence — "Notch" outside the citation still bolds', () => {
    document.body.innerHTML =
      '<p>Notch mediates cell–cell interactions in diverse contexts, and aberrations in Notch signal ' +
      'transduction can cause numerous cancer and other human diseases ' +
      '(<a href="https://doi.org/10.1242/dev.01438">Louvi and Artavanis-Tsakonas 2012</a>; ' +
      'Yamamoto et al. 2014b).</p>'
    applyPhraseBolding(['Notch'])
    // "Notch" appears twice before the citation — both should be bolded.
    expect(getBoldSpans().length).toBeGreaterThanOrEqual(1)
    getBoldSpans().forEach(s => expect(s.textContent).toMatch(/Notch/i))
  })
})

// ─── U.S. / dotted abbreviation bolding ──────────────────────────────────────
//
// These tests document the known regex bug where applyPhraseBolding receives
// a dotted abbreviation target like "u.s" or "u.s." and fails to match the
// full token "U.S." in the text, instead matching a partial slice.
//
// Snapshot tests lock in the current broken output so any change is visible.
// Tests tagged [bug] assert the wrong behaviour that currently occurs.
// Tests tagged [regression guard] will start failing once the bug is fixed —
// that is the signal to flip the assertion to the correct positive form.
// Tests tagged [control] must always pass; failure means a broader regression.

describe('applyPhraseBolding — dotted abbreviations (U.S. bug)', () => {
  // ── Snapshot / diagnostic tests ───────────────────────────────────────────

  it('[bug] documents what slice gets bolded for "u.s" mid-sentence', () => {
    document.body.innerHTML =
      '<p>Researchers at U.S. universities published findings on metabolic disorders.</p>'
    applyPhraseBolding(['u.s'])
    const bolded = getBoldSpans().map(s => s.textContent)
    console.log('[u.s mid-sentence] bolded slices:', JSON.stringify(bolded))
    expect(getBoldSpans().length).toMatchSnapshot()
    expect(bolded).toMatchSnapshot()
  })

  it('[bug] documents what slice gets bolded for "u.s" at sentence start', () => {
    document.body.innerHTML =
      '<p>U.S. health authorities continue to monitor adverse event reports quarterly.</p>'
    applyPhraseBolding(['u.s'])
    const bolded = getBoldSpans().map(s => s.textContent)
    console.log('[u.s sentence-start] bolded slices:', JSON.stringify(bolded))
    expect(getBoldSpans().length).toMatchSnapshot()
    expect(bolded).toMatchSnapshot()
  })

  it('[bug] documents what happens when "u.s." (trailing dot) is the target', () => {
    document.body.innerHTML =
      '<p>The U.S. government invested heavily in vaccine development programs.</p>'
    applyPhraseBolding(['u.s.'])
    const bolded = getBoldSpans().map(s => s.textContent)
    console.log('[u.s. with trailing dot] bolded slices:', JSON.stringify(bolded))
    expect(getBoldSpans().length).toMatchSnapshot()
    expect(bolded).toMatchSnapshot()
  })

  it('[bug] documents what happens with "u.s.a" mid-sentence', () => {
    document.body.innerHTML =
      '<p>Funding from U.S.A. agencies accelerated the clinical trial approval process.</p>'
    applyPhraseBolding(['u.s.a'])
    const bolded = getBoldSpans().map(s => s.textContent)
    console.log('[u.s.a] bolded slices:', JSON.stringify(bolded))
    expect(getBoldSpans().length).toMatchSnapshot()
    expect(bolded).toMatchSnapshot()
  })

  // ── Explicit failure-mode assertions ──────────────────────────────────────

  it('[bug] does NOT bold the full token "U.S." as a single span', () => {
    document.body.innerHTML =
      '<p>The U.S. Food and Drug Administration approved the treatment last year.</p>'
    applyPhraseBolding(['u.s'])
    const bolded = getBoldSpans().map(s => s.textContent)
    // Flip to: expect(bolded).toEqual(['U.S.']) once the bug is fixed.
    expect(bolded).not.toEqual(['U.S.'])
  })

  it('[bug] partial slice does NOT equal the correct full token "U.S."', () => {
    document.body.innerHTML =
      '<p>Researchers at U.S. universities published findings on metabolic disorders.</p>'
    applyPhraseBolding(['u.s'])
    const bolded = getBoldSpans().map(s => s.textContent)
    // When fixed: expect(bolded).toEqual(['U.S.'])
    if (bolded.length > 0) {
      expect(bolded.every(s => s !== 'U.S.')).toBe(true)
    }
  })

  it('[bug] U.S. appears multiple times — none of the spans capture the full token', () => {
    document.body.innerHTML = `
      <p>
        The U.S. government invested in research. U.S. scientists made breakthroughs.
        Funding from U.S. agencies supported the program over several years.
      </p>`
    applyPhraseBolding(['u.s'])
    const bolded = getBoldSpans().map(s => s.textContent)
    console.log('[u.s multiple] bolded slices:', JSON.stringify(bolded))
    // When fixed: expect(bolded).toEqual(['U.S.', 'U.S.', 'U.S.'])
    expect(bolded.some(s => s === 'U.S.')).toBe(false)
  })

  // ── Regression guard ──────────────────────────────────────────────────────

  it('[regression guard] U.S. is NOT currently bolded as a full span', () => {
    document.body.innerHTML =
      '<p>The U.S. Food and Drug Administration approved the treatment last year.</p>'
    applyPhraseBolding(['u.s'])
    const bolded = getBoldSpans().map(s => s.textContent)
    console.log('[regression guard] bolded slices:', JSON.stringify(bolded))
    // Remove .not and change to: expect(bolded).toEqual(['U.S.']) once fixed.
    expect(bolded).not.toEqual(['U.S.'])
  })

  // ── Sanity controls ───────────────────────────────────────────────────────
  //
  // Plain ALL-CAPS acronyms without dots must always bold correctly.
  // If either of these fails, a regression beyond the U.S. bug has occurred.

  it('[control] plain "WHO" without dots bolds correctly', () => {
    document.body.innerHTML =
      '<p>The WHO issued a global alert for the outbreak detected in Asia.</p>'
    applyPhraseBolding(['who'])
    expect(getBoldSpans().length).toBeGreaterThan(0)
    expect(getBoldText()).toMatch(/WHO/i)
  })

  it('[control] plain "DNA" without dots bolds correctly', () => {
    document.body.innerHTML =
      '<p>DNA repair mechanisms protect cells from mutation and damage over time.</p>'
    applyPhraseBolding(['dna'])
    expect(getBoldSpans().length).toBeGreaterThan(0)
    expect(getBoldText()).toMatch(/DNA/i)
  })
})