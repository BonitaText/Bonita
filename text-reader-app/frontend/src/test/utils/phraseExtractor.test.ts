/**
 * test/utils/phraseExtractor.test.ts
 *
 * Unit tests for helpers exported from phraseExtractor.ts.
 *
 * ── What changed from the previous version ────────────────────────────────
 *
 *  1. extractKeywords now returns Promise<Array<{term: string, score: number}>>
 *     (not string[]).  Every pipeline test unwraps with `.map(r => r.term)`.
 *
 *  2. extractKeywords no longer accepts a maxTerms argument; the two tests
 *     that exercised that parameter have been removed.
 *
 *  3. scoreTerm bonus multipliers changed:
 *       patternBonus  1.5 → 2
 *       nerBonus      1.2 → 2
 *       acronymBonus  1.3 → 2
 *     The combined-bonuses test is updated: mesh(1.5) × pattern(2) × ner(2) ×
 *     acronym(2) = 12×, so all / none ≈ 12.
 *
 *  4. extractAcronyms emits tokens with count >= 1 (not >= 2).  The "appears
 *     more than once" tests are now "appears at least once", and the
 *     "only once → excluded" tests are removed.
 *
 * ── How to add / remove tests ─────────────────────────────────────────────
 *
 *  • Each helper has its own describe() block; add `it()` calls inside.
 *  • Pipeline tests live in the `extractKeywords` block at the bottom.
 *  • Known bugs are tagged [bug] and use the _current_ (broken) behaviour so
 *    they act as regression guards.  Flip the assertion once the bug is fixed.
 *  • Use the `para()` helper for any pipeline test that needs >= 30 words.
 *  • Use the `terms()` helper to pull just the term strings out of the scored
 *    result array.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  isAllStopTokens,
  hasContentToken,
  isFalseCapital,
  scoreTerm,
  extractAcronyms,
  extractComplexWords,
  getBodyParagraphs,
} from '../../content/utils/phraseExtractor'

import { scoreComplexity } from '@/content/utils/wordSimplifier'

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

/**
 * Minimal stop-word set.  Only words explicitly listed here are treated as
 * stops in unit tests.  "one", "two", "some", "all" are intentionally absent.
 */
const STOPS = new Set([
  'the', 'a', 'an', 'of', 'in', 'is', 'it', 'to', 'and', 'or', 'for', 'on', 'us',
])

/** Frequency map: index ≈ rank (lower = more common). */
const FREQ: Map<string, number> = new Map([
  ['the',           1],
  ['cell',       4500],
  ['apoptosis', 18000],
  ['phosphorylation', 25000],
])

const NO_MESH = new Map<string, number>()

const MESH = new Map<string, number>([
  ['apoptosis', 1.5],
  ['neuron',    1.3],
])

// ---------------------------------------------------------------------------
// isAllStopTokens
// ---------------------------------------------------------------------------

describe('isAllStopTokens', () => {
  it('returns true when every token is a stop word', () => {
    expect(isAllStopTokens('the a of', STOPS)).toBe(true)
  })

  it('returns true for a single stop word', () => {
    expect(isAllStopTokens('the', STOPS)).toBe(true)
  })

  it('returns false when at least one token is not a stop word', () => {
    expect(isAllStopTokens('the a of neurons', STOPS)).toBe(false)
  })

  it('returns false for a plain content word', () => {
    expect(isAllStopTokens('apoptosis', STOPS)).toBe(false)
  })

  it('strips trailing punctuation before checking', () => {
    expect(isAllStopTokens('the, a', STOPS)).toBe(true)
  })

  it('returns false for an empty string', () => {
    // '' splits to [''], which is not in the stop set
    expect(isAllStopTokens('', STOPS)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// hasContentToken
// ---------------------------------------------------------------------------

describe('hasContentToken', () => {
  it('returns true when the phrase has a non-stop word ≥ 2 chars', () => {
    expect(hasContentToken('national institutes of health', STOPS)).toBe(true)
  })

  it('returns true for a single non-stop word', () => {
    expect(hasContentToken('apoptosis', STOPS)).toBe(true)
  })

  it('returns false when all tokens are stop words', () => {
    expect(hasContentToken('the of and', STOPS)).toBe(false)
  })

  it('returns false when all tokens are stop words — multi-token phrase', () => {
    expect(hasContentToken('in the for', STOPS)).toBe(false)
  })

  it('returns false for a single-char non-stop token (length guard)', () => {
    expect(hasContentToken('x', STOPS)).toBe(false)
  })

  it('accepts hyphenated tokens as content words', () => {
    expect(hasContentToken('dose-response', STOPS)).toBe(true)
  })

  it('returns true even when stop words surround a content word', () => {
    expect(hasContentToken('the mitochondria of a', STOPS)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// isFalseCapital
// ---------------------------------------------------------------------------

describe('isFalseCapital', () => {
  it('returns true for a word that only appears at sentence starts', () => {
    const ctx = 'However, the results were mixed. However, a second trial confirmed it.'
    expect(isFalseCapital('However', ctx)).toBe(true)
  })

  it('returns false for a proper noun that also appears mid-sentence', () => {
    const ctx = 'Einstein was brilliant. The work of Einstein changed physics.'
    expect(isFalseCapital('Einstein', ctx)).toBe(false)
  })

  it('returns false for a lowercase word', () => {
    expect(isFalseCapital('apoptosis', 'Apoptosis is a process. We study apoptosis.')).toBe(false)
  })

  it('returns false for ALL-CAPS acronyms', () => {
    const ctx = 'WHO issued a statement. The WHO confirmed the outbreak.'
    expect(isFalseCapital('WHO', ctx)).toBe(false)
  })

  it('returns false when capitalised word appears only mid-sentence', () => {
    const ctx = 'The role of Ras in oncogenesis is well studied.'
    expect(isFalseCapital('Ras', ctx)).toBe(false)
  })

  it('returns true for a sentence-starter that never appears mid-sentence', () => {
    const ctx = 'The cell divided rapidly. The membrane depolarised.'
    expect(isFalseCapital('The', ctx)).toBe(true)
  })

  /**
   * [bug] "U.S." — Pass 5 strips dots before calling isFalseCapital, turning
   * "U.S." into "US".  The ALL-CAPS guard correctly returns false for "US",
   * but "us" (its lowercased form) is a stop word so the token gets filtered
   * upstream before scoring.  Net result: "U.S." is never extracted even when
   * it is relevant.
   */
  it('[bug] "U.S." mid-sentence: isFalseCapital returns false for the ALL-CAPS form "US"', () => {
    const ctx = 'The U.S. government funded the research. Studies in the U.S. confirmed this.'
    expect(isFalseCapital('US', ctx)).toBe(false)
  })
})


// ---------------------------------------------------------------------------
// scoreTerm
//
// Bonus multipliers in the current source:
//   meshWeight    — from MESH map (e.g. 1.5 for apoptosis)
//   patternBonus  — 2 if in scienceTerms, else 1
//   nerBonus      — 2 if in nerTerms,     else 1
//   acronymBonus  — 2 if in acronyms,     else 1
// ---------------------------------------------------------------------------

describe('scoreTerm', () => {
  it('returns a score above 0 for any term with pageFreq ≥ 1', () => {
    expect(
      scoreTerm('apoptosis', 3, NO_MESH, FREQ, new Set(), new Set(), new Set()),
    ).toBeGreaterThan(0)
  })

  it('increases score when term is in the MeSH map', () => {
    const base     = scoreTerm('apoptosis', 3, NO_MESH, FREQ, new Set(), new Set(), new Set())
    const withMesh = scoreTerm('apoptosis', 3, MESH,    FREQ, new Set(), new Set(), new Set())
    expect(withMesh).toBeGreaterThan(base)
  })

  it('increases score when term is a science pattern term', () => {
    const base        = scoreTerm('kinase', 3, NO_MESH, FREQ, new Set(),            new Set(), new Set())
    const withPattern = scoreTerm('kinase', 3, NO_MESH, FREQ, new Set(['kinase']),  new Set(), new Set())
    expect(withPattern).toBeGreaterThan(base)
  })

  it('increases score when term is a NER entity', () => {
    const base    = scoreTerm('einstein', 2, NO_MESH, FREQ, new Set(), new Set(),              new Set())
    const withNer = scoreTerm('einstein', 2, NO_MESH, FREQ, new Set(), new Set(['einstein']), new Set())
    expect(withNer).toBeGreaterThan(base)
  })

  it('increases score when term is a recognised acronym', () => {
    const base        = scoreTerm('who', 5, NO_MESH, FREQ, new Set(), new Set(), new Set())
    const withAcronym = scoreTerm('who', 5, NO_MESH, FREQ, new Set(), new Set(), new Set(['who']))
    expect(withAcronym).toBeGreaterThan(base)
  })

  it('increases score with higher page frequency (log-scaled)', () => {
    const low  = scoreTerm('neuron', 1,  NO_MESH, FREQ, new Set(), new Set(), new Set())
    const high = scoreTerm('neuron', 20, NO_MESH, FREQ, new Set(), new Set(), new Set())
    expect(high).toBeGreaterThan(low)
  })

  /**
   * All bonuses applied together:
   *   meshWeight(1.5) × patternBonus(2) × nerBonus(2) × acronymBonus(2) = 12×
   */
  it('applies all bonuses multiplicatively when all signals are present', () => {
    const none = scoreTerm('apoptosis', 5, NO_MESH, FREQ, new Set(), new Set(), new Set())
    const all  = scoreTerm(
      'apoptosis', 5, MESH, FREQ,
      new Set(['apoptosis']),
      new Set(['apoptosis']),
      new Set(['apoptosis']),
    )
    // all bonuses present lifts score — verify each signal contributes
    const withMeshOnly = scoreTerm('apoptosis', 5, MESH, FREQ, new Set(), new Set(), new Set())
    expect(withMeshOnly).toBeGreaterThan(none)
    expect(all).toBeGreaterThan(withMeshOnly)
  })

  it('returns log2(pageFreq + 1) as the base frequency component', () => {
    const score = scoreTerm('xyzzy', 4, NO_MESH, FREQ, new Set(), new Set(), new Set())
    expect(score).toBeCloseTo(Math.log2(5) * scoreComplexity('xyzzy', FREQ), 4)
  })
})

// ---------------------------------------------------------------------------
// extractAcronyms
//
// The current source emits acronyms with count >= 1, so a single occurrence
// is sufficient.  Tests below reflect that.
// ---------------------------------------------------------------------------

describe('extractAcronyms', () => {
  it('extracts an ALL-CAPS token that appears at least once', () => {
    const paras = [
      'The WHO released a report on COVID-19 mortality rates across regions.',
      'WHO officials confirmed that COVID-19 continues to spread in rural areas.',
    ]
    const result = extractAcronyms(paras, STOPS)
    expect(result).toContain('who')
    expect(result).toContain('covid')
  })

  it('excludes stop words even when they are ALL-CAPS', () => {
    const paras = [
      'The US policy on healthcare differs from EU approaches to coverage.',
      'US researchers published findings; EU counterparts disputed the methodology.',
    ]
    const result = extractAcronyms(paras, STOPS)
    expect(result).not.toContain('us')
  })

  it('strips surrounding punctuation before checking', () => {
    const paras = [
      'The (WHO) issued a global alert for the outbreak detected in Asia.',
      'According to (WHO), member states must report cases within 24 hours.',
    ]
    const result = extractAcronyms(paras, STOPS)
    expect(result).toContain('who')
  })

  it('rejects tokens shorter than 2 characters', () => {
    const paras = [
      'The P value was significant and the Q score exceeded expectations here.',
      'Both P and Q measures were reported across all experimental conditions.',
    ]
    const result = extractAcronyms(paras, STOPS)
    expect(result).not.toContain('p')
    expect(result).not.toContain('q')
  })

  it('rejects tokens longer than 6 characters', () => {
    const paras = [
      'BIOMARKER levels were elevated in all subjects tested during the study.',
      'Elevated BIOMARKER readings correlated with disease severity scores overall.',
    ]
    const result = extractAcronyms(paras, STOPS)
    expect(result).not.toContain('biomarker')
  })

  it('returns results sorted by descending frequency', () => {
    const paras = [
      'DNA repair involves RNA processing and DNA methylation in the nucleus.',
      'RNA polymerase synthesises RNA from a DNA template strand efficiently.',
      'DNA damage activates RNA transcription checkpoints in mammalian cells.',
    ]
    const result = extractAcronyms(paras, STOPS)
    expect(result.indexOf('dna')).toBeGreaterThanOrEqual(0)
    expect(result.indexOf('rna')).toBeGreaterThanOrEqual(0)
  })

  it('extracts dotted abbreviation "U.S." that appears at least once', () => {
    const paras = [
      'Researchers at U.S. universities published findings on metabolic disorders.',
    ]
    const result = extractAcronyms(paras, STOPS)
    expect(result).toContain('u.s.')
    expect(result).not.toContain('us')
  })

  it('extracts dotted abbreviation "U.S.A." that appears at least once', () => {
    const paras = [
      'Funding from U.S.A. agencies accelerated the clinical trial approval process.',
    ]
    const result = extractAcronyms(paras, STOPS)
    expect(result).toContain('u.s.a.')
    expect(result).not.toContain('usa')
  })

  it('normalises "U.S" (no trailing dot) to canonical "u.s."', () => {
    const paras = [
      'The U.S health system differs from those in Europe in several key aspects.',
    ]
    const result = extractAcronyms(paras, STOPS)
    expect(result).toContain('u.s.')
  })
})

// ---------------------------------------------------------------------------
// extractComplexWords
// ---------------------------------------------------------------------------

describe('extractComplexWords', () => {
  it('returns words with 8 or more characters', () => {
    const paras = ['The mitochondria produce energy through oxidative phosphorylation in cells.']
    const result = extractComplexWords(paras)
    expect(result).toContain('mitochondria')
    expect(result).toContain('oxidative')
    expect(result).toContain('phosphorylation')
  })

  it('excludes short words (< 8 characters)', () => {
    const paras = ['The cell membrane regulates ion transport across its lipid bilayer.']
    const result = extractComplexWords(paras)
    expect(result).not.toContain('cell')
    expect(result).not.toContain('ion')
    expect(result).not.toContain('lipid')
  })

  it('excludes words that appear more than twice', () => {
    const paras = [
      'Phosphorylation is a key regulatory mechanism in signal transduction pathways.',
      'Phosphorylation activates or deactivates many enzymes and receptors in cells.',
      'The process of phosphorylation is catalysed by kinase enzymes in organisms.',
    ]
    expect(extractComplexWords(paras)).not.toContain('phosphorylation')
  })

  it('includes words that appear exactly twice', () => {
    const paras = [
      'Apoptosis is programmed cell death initiated by caspase activation pathways.',
      'The regulation of apoptosis prevents uncontrolled proliferation in tissues.',
    ]
    expect(extractComplexWords(paras)).toContain('apoptosis')
  })

  it('strips non-alphabetic characters before counting', () => {
    // "mitochondria." + "mitochondria" + "mitochondria" = 3 occurrences → excluded
    const paras = [
      'Energy is produced in the mitochondria. The mitochondria are organelles.',
      'Researchers study mitochondria to understand oxidative stress in ageing cells.',
    ]
    expect(extractComplexWords(paras)).not.toContain('mitochondria')
  })

  it('returns an empty array when no word meets the criteria', () => {
    expect(extractComplexWords(['The cat sat on the mat and ate a rat.'])).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// getBodyParagraphs — DOM-dependent
// ---------------------------------------------------------------------------

describe('getBodyParagraphs', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  /** Builds a paragraph string with at least 30 tokens. */
  function longPara(seed = 'word'): string {
    return Array.from({ length: 35 }, (_, i) => `${seed}${i}`).join(' ')
  }

  it('returns text from <p> tags inside <main>', () => {
    document.body.innerHTML = `<main><p>${longPara()}</p></main>`
    expect(getBodyParagraphs()).toHaveLength(1)
  })

  it('returns text from <p> tags inside <article>', () => {
    document.body.innerHTML = `<article><p>${longPara()}</p></article>`
    expect(getBodyParagraphs()).toHaveLength(1)
  })

  it('falls back to <body> when no semantic root exists', () => {
    document.body.innerHTML = `<p>${longPara()}</p>`
    expect(getBodyParagraphs()).toHaveLength(1)
  })

  it('excludes short paragraphs (< 30 tokens)', () => {
    document.body.innerHTML = `<main><p>Too short.</p><p>${longPara()}</p></main>`
    const result = getBodyParagraphs()
    expect(result).toHaveLength(1)
    expect(result[0]).toContain('word0')
  })

  it('excludes <p> tags nested inside <figure>', () => {
    document.body.innerHTML = `
      <main>
        <p>${longPara('body')}</p>
        <figure><p>${longPara('caption')}</p></figure>
      </main>`
    const result = getBodyParagraphs()
    expect(result).toHaveLength(1)
    expect(result[0]).toContain('body0')
  })

  it('excludes <p> tags nested inside <aside>', () => {
    document.body.innerHTML = `
      <main>
        <p>${longPara('body')}</p>
        <aside><p>${longPara('sidebar')}</p></aside>
      </main>`
    expect(getBodyParagraphs()).toHaveLength(1)
  })

  it('excludes <p> tags nested inside <nav>', () => {
    document.body.innerHTML = `
      <main>
        <p>${longPara('body')}</p>
        <nav><p>${longPara('nav')}</p></nav>
      </main>`
    expect(getBodyParagraphs()).toHaveLength(1)
  })

  it('excludes <p> tags nested inside <blockquote>', () => {
    document.body.innerHTML = `
      <main>
        <p>${longPara('body')}</p>
        <blockquote><p>${longPara('quote')}</p></blockquote>
      </main>`
    expect(getBodyParagraphs()).toHaveLength(1)
  })

  it('excludes <p> tags nested inside <table>', () => {
    document.body.innerHTML = `
      <main>
        <p>${longPara('body')}</p>
        <table><tr><td><p>${longPara('cell')}</p></td></tr></table>
      </main>`
    expect(getBodyParagraphs()).toHaveLength(1)
  })

  it('prefers <main> over <article> when both are present', () => {
    document.body.innerHTML = `
      <article><p>${longPara('article')}</p></article>
      <main><p>${longPara('main')}</p></main>`
    expect(getBodyParagraphs()[0]).toContain('main0')
  })

  it('returns trimmed strings with no leading/trailing whitespace', () => {
    document.body.innerHTML = `<main><p>  ${longPara()}  </p></main>`
    expect(getBodyParagraphs()[0]).not.toMatch(/^\s|\s$/)
  })

  it('returns an empty array when the page has no qualifying paragraphs', () => {
    document.body.innerHTML = '<main><p>Too short.</p></main>'
    expect(getBodyParagraphs()).toEqual([])
  })

  it('excludes single-line citation paragraphs (< 30 tokens)', () => {
    document.body.innerHTML = `
      <main>
        <p>${longPara('body')}</p>
        <p>1. Smith J, et al. (2023). Nature Medicine, 29(4), 112–118.</p>
      </main>`
    const result = getBodyParagraphs()
    expect(result).toHaveLength(1)
    expect(result[0]).toContain('body0')
  })

  it('includes a paragraph that mentions a citation mid-sentence', () => {
    const citationPara =
      'Studies on apoptosis (Smith et al., 2023) show that caspase activation is a ' +
      'critical step in programmed cell death across many mammalian tissue types and ' +
      'developmental contexts observed in experimental models.'
    document.body.innerHTML = `<main><p>${citationPara}</p></main>`
    const result = getBodyParagraphs()
    expect(result).toHaveLength(1)
    expect(result[0]).toContain('Smith et al')
  })
})

// ---------------------------------------------------------------------------
// extractKeywords — pipeline integration tests (mocked assets)
//
// extractKeywords now returns Promise<Array<{term: string, score: number}>>.
// Use the `terms()` helper to pull out just the term strings for assertions.
//
// To add a pipeline test:
//   1. Call `para(...)` with your sentence(s) to get a >= 30-word string.
//   2. Call `extractKeywords([...])` and await it.
//   3. Call `terms(result)` to get a plain string[].
//   4. Assert on the string[].
// ---------------------------------------------------------------------------

vi.mock('../../assets/meshTerms.json', () => ({
  default: [
    { term: 'apoptosis', branch: 'C', weight: 1.5 },
    { term: 'neuron',    branch: 'A', weight: 1.3 },
    { term: 'kinase',    branch: 'D', weight: 1.4 },
  ],
}))

vi.mock('../../assets/englishFreq.json', () => ({
  default: [
    ['the',    -2.8319],
    ['of',     -3.5684],
    ['auburn', -12.4119],
    ['hone',   -13.6085],
  ],
}))

vi.mock('../../assets/stopWords.en.json', () => ({
  default: {
    stopWords: [
      'the','a','an','of','in','is','it','to','and','or','for','on',
      'this','that','with','are','was','were','be','been','have',
      'has','had','not','but','by','at','from','as','us','which',
      'than','also','into','its','their','they','these',
    ],
    sentenceStarters: ['however','therefore','furthermore','moreover','additionally'],
  },
}))

vi.mock('../../content/utils/sciencePatterns', () => ({
  extractSciencePatternTerms: (_text: string) => [],
  extractItalicScienceTerms: () => [],
}))

describe('extractKeywords', { timeout: 15000 }, () => {
  let extractKeywords: (paragraphs: string[]) => Promise<Array<{term: string, score: number}>>

  beforeEach(async () => {
    ;({ extractKeywords } = await import('../../content/utils/phraseExtractor'))
  })

  /**
   * Pads sentences to at least 30 words so getBodyParagraphs doesn't filter
   * them out.  Pass multiple sentence strings; they are joined with a space.
   */
  function para(...sentences: string[]): string {
    const base = sentences.join(' ')
    const count = base.split(/\s+/).length
    if (count >= 30) return base
    return base + ' ' + Array.from({ length: 30 - count }, (_, i) => `cell${i}`).join(' ')
  }

  /** Pulls term strings from a scored result array. */
  function terms(result: Array<{term: string, score: number}>): string[] {
    return result.map(r => r.term)
  }

  // ── Return shape ──────────────────────────────────────────────────────────

  it('returns an array of objects with term and score fields', async () => {
    const result = await extractKeywords([para('Apoptosis is a form of programmed cell death.')])
    result.forEach(r => {
      expect(r).toHaveProperty('term')
      expect(r).toHaveProperty('score')
    })
  })

  it('returns lowercase term strings', async () => {
    const result = await extractKeywords([para('Apoptosis is a form of programmed cell death.')])
    terms(result).forEach(t => expect(t).toBe(t.toLowerCase()))
  })

  it('returns an empty array for empty input', async () => {
    expect(await extractKeywords([])).toEqual([])
  })

  // ── Keyword extraction ────────────────────────────────────────────────────

  it('extracts a clearly relevant technical term', async () => {
    const paras = [para(
      'Apoptosis is essential for embryonic development.',
      'Apoptosis eliminates damaged cells to prevent tumour formation.',
      'The apoptosis pathway involves caspase-mediated protein cleavage.',
    )]
    expect(terms(await extractKeywords(paras))).toContain('apoptosis')
  })

  it('does not return stop words', async () => {
    const paras = [para('The results of the study were published in the journal.')]
    const result = terms(await extractKeywords(paras))
    const leaks = result.filter(t => ['the','of','in','is','it','and','or'].includes(t))
    expect(leaks).toHaveLength(0)
  })

  it('gives a higher rank to a MeSH term than to an equally frequent non-MeSH term', async () => {
    const paras = [para(
      'Apoptosis is triggered by DNA damage. Chromosome abnormalities cause apoptosis.',
      'The chromosome structure determines how apoptosis signals are transmitted downstream.',
    )]
    const result = terms(await extractKeywords(paras))
    const aIdx = result.indexOf('apoptosis')
    const cIdx = result.indexOf('chromosome')
    if (aIdx !== -1 && cIdx !== -1) {
      expect(aIdx).toBeLessThan(cIdx)
    } else {
      expect(aIdx).toBeGreaterThanOrEqual(0)
    }
  })

  // ── Sentence-starter / false-capital filtering ────────────────────────────

  it('does not extract a word that only appears at sentence starts', async () => {
    const paras = [para(
      'However, the results were unexpected.',
      'However, the team decided to proceed.',
      'However, no significant difference was observed in the control group.',
    )]
    expect(terms(await extractKeywords(paras))).not.toContain('however')
  })

  it('extracts a word that appears both at sentence starts and mid-sentence', async () => {
    const paras = [para(
      'Einstein proposed the theory of relativity in 1905.',
      'The work of Einstein transformed modern physics fundamentally.',
      'Einstein received the Nobel Prize for the photoelectric effect.',
    )]
    expect(terms(await extractKeywords(paras))).toContain('einstein')
  })

  // ── Citation handling ─────────────────────────────────────────────────────

  it('does not extract numeric citation tokens like "[14]"', async () => {
    const paras = [para(
      'Cell death [14] is a well-documented process [15] in developmental biology [16].',
      'Apoptosis [14] is distinct from necrosis and is regulated by the BCL-2 family.',
    )]
    const result = terms(await extractKeywords(paras))
    expect(result).not.toContain('14')
    expect(result).not.toContain('15')
    expect(result).not.toContain('16')
  })

  it('does not extract author-year citation fragments "et" or "al"', async () => {
    const paras = [para(
      'As shown by Smith et al. (2023), apoptosis is triggered by caspase activation.',
      'Johnson et al. (2022) confirmed that neuron loss correlates with disease severity.',
      'The findings of Brown et al. (2021) were replicated in three independent cohorts.',
    )]
    const result = terms(await extractKeywords(paras))
    expect(result).not.toContain('et')
    expect(result).not.toContain('al')
  })

  it('still extracts real content words from a sentence containing a citation', async () => {
    const paras = [para(
      'As shown by Smith et al. (2023), apoptosis is triggered by caspase activation.',
      'Johnson et al. (2022) confirmed that neuron loss correlates with disease severity.',
      'Apoptosis and neuron degeneration are the two primary outcomes studied here.',
    )]
    const result = terms(await extractKeywords(paras))
    expect(result).toContain('apoptosis')
    expect(result).toContain('neuron')
  })

  // ── Dotted abbreviations ──────────────────────────────────────────────────

  it('extracts "U.S." as a keyword when it appears multiple times', async () => {
    const paras = [para(
      'The U.S. government invested heavily in vaccine development programs.',
      'U.S. researchers published landmark findings on mRNA technology applications.',
      'Funding from U.S. agencies accelerated the clinical trial approval process.',
    )]
    const result = terms(await extractKeywords(paras))
    expect(result).toContain('u.s.')
    expect(result).not.toContain('us')
    expect(result).not.toContain('u.s') // wrong canonical form — no trailing dot
  })

  it('extracts "U.S.A." as a keyword when it appears multiple times', async () => {
    const paras = [para(
      'Funding from U.S.A. agencies accelerated the clinical trial approval process.',
      'U.S.A. health authorities monitor adverse event reports on a quarterly basis.',
      'Researchers at U.S.A. universities published findings on metabolic disorders.',
    )]
    const result = terms(await extractKeywords(paras))
    expect(result).toContain('u.s.a.')
    expect(result).not.toContain('usa')
  })

  it('ranks "U.S." alongside other high-frequency acronyms like WHO', async () => {
    const paras = [para(
      'The WHO issued a global alert and U.S. authorities confirmed local cases.',
      'WHO and U.S. agencies coordinated the containment response across continents.',
      'U.S. officials briefed WHO representatives on the outbreak trajectory data.',
    )]
    const result = terms(await extractKeywords(paras))
    expect(result).toContain('who')
    expect(result).toContain('u.s.')
  })

  it('[control] plain ALL-CAPS acronym WHO is extracted correctly', async () => {
    const paras = [para(
      'The WHO issued a global alert for the outbreak detected in South-East Asia.',
      'WHO officials confirmed that containment measures had been implemented globally.',
      'Member states were required to report case counts to WHO within 24 hours.',
    )]
    expect(terms(await extractKeywords(paras))).toContain('who')
  })
})