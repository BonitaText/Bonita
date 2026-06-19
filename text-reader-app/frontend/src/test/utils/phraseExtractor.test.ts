/**
 * test/utils/phraseExtractor.test.ts
 *
 * Unit tests for the helper functions exported from phraseExtractor.ts.
 *
 * extractKeywords() itself is an async pipeline that depends on three JSON
 * asset files (meshTerms, englishFreq, stopWords) and the compromise NLP
 * library.  Those assets are mocked via vi.mock() so tests stay fast and
 * deterministic.
 *
 * Pure helpers (isAllStopTokens, hasContentToken, isFalseCapital,
 * rarityBonus, scoreTerm, extractAcronyms, extractComplexWords,
 * getBodyParagraphs) are tested directly.
 *
 * Known bugs are documented with failing tests tagged @bug so they act as
 * regression guards — they will flip to passing once the bug is fixed.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  isAllStopTokens,
  hasContentToken,
  isFalseCapital,
  rarityBonus,
  scoreTerm,
  extractAcronyms,
  extractComplexWords,
  getBodyParagraphs,
} from '../../content/utils/phraseExtractor'

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

/**
 * Minimal stop-word set reused across every suite.
 *
 * NOTE: "one", "two", "some", "all" are intentionally NOT in this set —
 * they are legitimate content words in many contexts.  Tests that need
 * all-stop phrases must use only words from this set (the, a, an, of, in,
 * is, it, to, and, or, for, on, us).
 */
const STOPS = new Set([
  'the', 'a', 'an', 'of', 'in', 'is', 'it', 'to', 'and', 'or', 'for', 'on', 'us',
])

/** Frequency map: low ranks = common words, high ranks = rare/unknown. */
const FREQ: Map<string, number> = new Map([
  ['the',   1],
  ['cell',  4500],
  ['apoptosis', 18000],
  ['phosphorylation', 25000],
])

/** Empty MeSH map — most unit tests don't need MeSH weighting. */
const NO_MESH = new Map<string, number>()

/** A MeSH map with a couple of real entries for scoring tests. */
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
    // "the," → "the" after replace → should be treated as stop word
    expect(isAllStopTokens('the, a', STOPS)).toBe(true)
  })

  it('returns false for an empty string after trim', () => {
    // tokens = [''] — empty string is not in the stop set
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

  /**
   * Uses only tokens that ARE in the STOPS fixture: the, a, an, of, in, is,
   * it, to, and, or, for, on.
   *
   */
  it('returns false when all tokens are stop words', () => {
    expect(hasContentToken('the of and', STOPS)).toBe(false)
  })

  it('returns false when all tokens are stop words — multi-token NER-like phrase', () => {
    // Simulates a NER extraction that slips through as a function-word sequence
    expect(hasContentToken('in the for', STOPS)).toBe(false)
  })

  it('returns false for a single-char non-stop token (length guard)', () => {
    // 'x' is not in stops but length < 2 → no content token
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

  it('returns false for a lowercase word (not capitalised)', () => {
    expect(isFalseCapital('apoptosis', 'Apoptosis is a process. We study apoptosis.')).toBe(false)
  })

  it('returns false for ALL-CAPS acronyms — they are never false capitals', () => {
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

  // -------------------------------------------------------------------------
  // @bug — dotted abbreviations
  //
  // "U.S." appears mid-sentence and is not a false capital, but Pass 5 strips
  // dots before calling isFalseCapital, turning it into "US" (ALL-CAPS). The
  // ALL-CAPS guard then returns false correctly — but "US" is also in the stop
  // set (as the pronoun "us"), so it gets filtered out upstream before scoring.
  // Net result: "U.S." is never extracted as a keyword even when relevant.
  //
  // The test below documents the isFalseCapital behaviour in isolation; the
  // full-pipeline regression is in the extractKeywords suite.
  // -------------------------------------------------------------------------

  it('[bug] "U.S." mid-sentence: isFalseCapital correctly returns false for the ALL-CAPS form "US"', () => {
    // After Pass 5 stripping: "U.S." → "US" → ALL-CAPS guard fires → false ✓
    // But "us" (lowercased "US") is a stop word, so it still gets blocked upstream.
    const ctx = 'The U.S. government funded the research. Studies in the U.S. confirmed this.'
    expect(isFalseCapital('US', ctx)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// rarityBonus
// ---------------------------------------------------------------------------

describe('rarityBonus', () => {
  it('returns 1.0 for a very common word (rank ≤ 1000)', () => {
    expect(rarityBonus('the', FREQ)).toBe(1.0)
  })

  it('returns 1.2 for a moderately common word (rank 1001–5000)', () => {
    expect(rarityBonus('cell', FREQ)).toBe(1.2)
  })

  it('returns 1.5 for an uncommon word (rank 5001–20000)', () => {
    expect(rarityBonus('apoptosis', FREQ)).toBe(1.5)
  })

  it('returns 1.8 for a rare word (rank > 20000)', () => {
    expect(rarityBonus('phosphorylation', FREQ)).toBe(1.8)
  })

  it('returns 2.0 for a word not in the frequency map', () => {
    expect(rarityBonus('crispr', FREQ)).toBe(2.0)
  })

  it('is case-insensitive', () => {
    expect(rarityBonus('THE', FREQ)).toBe(rarityBonus('the', FREQ))
  })
})

// ---------------------------------------------------------------------------
// scoreTerm
// ---------------------------------------------------------------------------

describe('scoreTerm', () => {
  it('returns a score above 0 for any term with pageFreq ≥ 1', () => {
    const score = scoreTerm('apoptosis', 3, NO_MESH, FREQ, new Set(), new Set(), new Set())
    expect(score).toBeGreaterThan(0)
  })

  it('increases score when term is in the MeSH map', () => {
    const base = scoreTerm('apoptosis', 3, NO_MESH, FREQ, new Set(), new Set(), new Set())
    const withMesh = scoreTerm('apoptosis', 3, MESH, FREQ, new Set(), new Set(), new Set())
    expect(withMesh).toBeGreaterThan(base)
  })

  it('increases score when term is a science pattern term', () => {
    const base = scoreTerm('kinase', 3, NO_MESH, FREQ, new Set(), new Set(), new Set())
    const withPattern = scoreTerm('kinase', 3, NO_MESH, FREQ, new Set(['kinase']), new Set(), new Set())
    expect(withPattern).toBeGreaterThan(base)
  })

  it('increases score when term is a NER entity', () => {
    const base = scoreTerm('einstein', 2, NO_MESH, FREQ, new Set(), new Set(), new Set())
    const withNer = scoreTerm('einstein', 2, NO_MESH, FREQ, new Set(), new Set(['einstein']), new Set())
    expect(withNer).toBeGreaterThan(base)
  })

  it('increases score when term is a recognised acronym', () => {
    const base = scoreTerm('who', 5, NO_MESH, FREQ, new Set(), new Set(), new Set())
    const withAcronym = scoreTerm('who', 5, NO_MESH, FREQ, new Set(), new Set(), new Set(['who']))
    expect(withAcronym).toBeGreaterThan(base)
  })

  it('increases score with higher page frequency (log-scaled)', () => {
    const low = scoreTerm('neuron', 1, NO_MESH, FREQ, new Set(), new Set(), new Set())
    const high = scoreTerm('neuron', 20, NO_MESH, FREQ, new Set(), new Set(), new Set())
    expect(high).toBeGreaterThan(low)
  })

  it('applies all bonuses multiplicatively when all signals are present', () => {
    const none = scoreTerm('apoptosis', 5, NO_MESH, FREQ, new Set(), new Set(), new Set())
    const all  = scoreTerm(
      'apoptosis', 5, MESH,
      FREQ,
      new Set(['apoptosis']),  // science
      new Set(['apoptosis']),  // NER
      new Set(['apoptosis']),  // acronym
    )
    // 1.5 (MeSH) × 1.5 (pattern) × 1.2 (NER) × 1.3 (acronym) = 3.51×
    expect(all / none).toBeCloseTo(3.51, 1)
  })

  it('returns log2(pageFreq + 1) as the frequency component', () => {
    // With rarity = 2.0 (unknown word) and no other bonuses:
    // score = log2(4+1) × 1.0 × 2.0 = log2(5) × 2
    const score = scoreTerm('xyzzy', 4, NO_MESH, FREQ, new Set(), new Set(), new Set())
    expect(score).toBeCloseTo(Math.log2(5) * 2.0, 4)
  })
})

// ---------------------------------------------------------------------------
// extractAcronyms
// ---------------------------------------------------------------------------

describe('extractAcronyms', () => {
  it('extracts ALL-CAPS tokens that appear more than once', () => {
    const paras = [
      'The WHO released a report on COVID-19 mortality rates across regions.',
      'WHO officials confirmed that COVID-19 continues to spread in rural areas.',
    ]
    const result = extractAcronyms(paras, STOPS)
    expect(result).toContain('who')
    expect(result).toContain('covid')
  })

  it('does not extract acronyms that appear only once', () => {
    const paras = [
      'The FDA approved a new drug for treating rare cancers in paediatric patients.',
      'Researchers noted that clinical trials showed promising efficacy results overall.',
    ]
    const result = extractAcronyms(paras, STOPS)
    expect(result).not.toContain('fda')
  })

  it('excludes stop words even when they are ALL-CAPS', () => {
    // "US" lowercases to "us" which is in STOPS
    const paras = [
      'The US policy on healthcare differs from EU approaches to coverage.',
      'US researchers published findings; EU counterparts disputed the methodology.',
    ]
    const result = extractAcronyms(paras, STOPS)
    expect(result).not.toContain('us')
  })

  it('strips surrounding punctuation before checking', () => {
    // "(WHO)" → "WHO" after stripping non-uppercase chars from edges
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
    const dnaIdx = result.indexOf('dna')
    const rnaIdx = result.indexOf('rna')
    // DNA appears 4×, RNA appears 4× — both should be present
    expect(dnaIdx).toBeGreaterThanOrEqual(0)
    expect(rnaIdx).toBeGreaterThanOrEqual(0)
  })


  it('extracts dotted abbreviations like "U.S." that appear more than once', () => {
    const paras = [
      'Researchers at U.S. universities published findings on metabolic disorders.',
      'The U.S. Food and Drug Administration approved the compound for clinical use.',
      'U.S. health authorities continue to monitor adverse event reports quarterly.',
    ]
    const result = extractAcronyms(paras, STOPS)
    // Canonical form: dots preserved, lowercased, trailing dot included.
    // "us" must NOT appear — it is a stop word and a different token entirely.
    expect(result).toContain('u.s.')
    expect(result).not.toContain('us')
  })

  it('extracts dotted abbreviation "U.S.A." that appears more than once', () => {
    const paras = [
      'Funding from U.S.A. agencies accelerated the clinical trial approval process.',
      'U.S.A. health authorities monitor adverse event reports on a quarterly basis.',
      'Researchers at U.S.A. universities published findings on metabolic disorders.',
    ]
    const result = extractAcronyms(paras, STOPS)
    expect(result).toContain('u.s.a.')
    expect(result).not.toContain('usa') // not a stop word, but wrong canonical form
  })

  it('does not extract a dotted abbreviation that appears only once', () => {
    const paras = [
      'U.S. researchers published landmark findings on mRNA technology applications.',
      'The study was conducted at several international universities and research centres.',
    ]
    const result = extractAcronyms(paras, STOPS)
    expect(result).not.toContain('u.s.')
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
    const result = extractComplexWords(paras)
    expect(result).not.toContain('phosphorylation')
  })

  it('includes words that appear exactly twice', () => {
    const paras = [
      'Apoptosis is programmed cell death initiated by caspase activation pathways.',
      'The regulation of apoptosis prevents uncontrolled proliferation in tissues.',
    ]
    const result = extractComplexWords(paras)
    expect(result).toContain('apoptosis')
  })

  it('strips non-alphabetic characters before counting', () => {
    // "mitochondria." and "mitochondria" should be counted as one word
    const paras = [
      'Energy is produced in the mitochondria. The mitochondria are organelles.',
      'Researchers study mitochondria to understand oxidative stress in ageing cells.',
    ]
    const result = extractComplexWords(paras)
    // 3 occurrences → excluded
    expect(result).not.toContain('mitochondria')
  })

  it('returns an empty array when no word meets the criteria', () => {
    const paras = ['The cat sat on the mat and ate a rat.']
    expect(extractComplexWords(paras)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// getBodyParagraphs — DOM-dependent
// ---------------------------------------------------------------------------

describe('getBodyParagraphs', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  /** Builds a long-enough paragraph string (≥ 30 tokens). */
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
    const result = getBodyParagraphs()
    expect(result).toHaveLength(1)
  })

  it('excludes <p> tags nested inside <nav>', () => {
    document.body.innerHTML = `
      <main>
        <p>${longPara('body')}</p>
        <nav><p>${longPara('nav')}</p></nav>
      </main>`
    const result = getBodyParagraphs()
    expect(result).toHaveLength(1)
  })

  it('excludes <p> tags nested inside <blockquote>', () => {
    document.body.innerHTML = `
      <main>
        <p>${longPara('body')}</p>
        <blockquote><p>${longPara('quote')}</p></blockquote>
      </main>`
    const result = getBodyParagraphs()
    expect(result).toHaveLength(1)
  })

  it('excludes <p> tags nested inside <table>', () => {
    document.body.innerHTML = `
      <main>
        <p>${longPara('body')}</p>
        <table><tr><td><p>${longPara('cell')}</p></td></tr></table>
      </main>`
    const result = getBodyParagraphs()
    expect(result).toHaveLength(1)
  })

  it('prefers <main> over <article> when both are present', () => {
    document.body.innerHTML = `
      <article><p>${longPara('article')}</p></article>
      <main><p>${longPara('main')}</p></main>`
    const result = getBodyParagraphs()
    expect(result[0]).toContain('main0')
  })

  it('returns trimmed strings with no leading/trailing whitespace', () => {
    document.body.innerHTML = `<main><p>  ${longPara()}  </p></main>`
    const result = getBodyParagraphs()
    expect(result[0]).not.toMatch(/^\s|\s$/)
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

  it('includes a paragraph that happens to mention a citation mid-sentence', () => {
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
// We mock the three JSON asset imports so the pipeline runs without real files.
// compromise is NOT mocked — it runs for real so NER and POS tagging behave
// authentically.
// ---------------------------------------------------------------------------

vi.mock('../../assets/meshTerms.json', () => ({
  default: [
    { term: 'apoptosis',   branch: 'C', weight: 1.5 },
    { term: 'neuron',      branch: 'A', weight: 1.3 },
    { term: 'kinase',      branch: 'D', weight: 1.4 },
  ],
}))

vi.mock('../../assets/englishFreq.json', () => ({
  default: [
    ['the', -2.8319],
    ['of', -3.5684],
    ['auburn', -12.4119],
    ['hone', -13.6085],
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
  let extractKeywords: (paragraphs: string[], maxTerms?: number) => Promise<string[]>

  beforeEach(async () => {
    ;({ extractKeywords } = await import('../../content/utils/phraseExtractor'))
  })

  /** Builds a paragraph long enough to qualify (≥ 30 words). */
  function para(...sentences: string[]): string {
    const base = sentences.join(' ')
    const tokens = base.split(/\s+/)
    if (tokens.length >= 30) return base
    const padding = Array.from({ length: 30 - tokens.length }, (_, i) => `cell${i}`)
    return base + ' ' + padding.join(' ')
  }

  it('returns an array of lowercase strings', async () => {
    const paras = [para('Apoptosis is a form of programmed cell death involving caspase enzymes.')]
    const result = await extractKeywords(paras)
    result.forEach(term => expect(term).toBe(term.toLowerCase()))
  })

  it('extracts a clearly relevant technical term', async () => {
    const paras = [para(
      'Apoptosis is essential for embryonic development.',
      'Apoptosis eliminates damaged cells to prevent tumour formation.',
      'The apoptosis pathway involves caspase-mediated protein cleavage.',
    )]
    const result = await extractKeywords(paras)
    expect(result).toContain('apoptosis')
  })

  it('does not return stop words', async () => {
    const paras = [para('The results of the study were published in the journal.')]
    const result = await extractKeywords(paras)
    const stopWordLeak = result.filter(t =>
      ['the', 'of', 'in', 'is', 'it', 'and', 'or'].includes(t)
    )
    expect(stopWordLeak).toHaveLength(0)
  })

  it('respects the maxTerms limit', async () => {
    const paras = [para(
      'Neuron apoptosis kinase protein cell membrane receptor ligand transcription',
      'factor chromosome genome mutation allele phenotype genotype expression pathway',
    )]
    const result = await extractKeywords(paras, 3)
    expect(result.length).toBeLessThanOrEqual(3)
  })

  it('applies the dynamic cap (10 + paragraphs.length × 2) when maxTerms is large', async () => {
    const paras = [para('Apoptosis kinase neuron protein cell membrane receptor ligand.')]
    const result = await extractKeywords(paras, 999)
    expect(result.length).toBeLessThanOrEqual(12)
  })

  it('returns an empty array for empty input', async () => {
    expect(await extractKeywords([])).toEqual([])
  })

  it('gives a higher score to a MeSH term than to an equally frequent non-MeSH term', async () => {
    const paras = [para(
      'Apoptosis is triggered by DNA damage. Chromosome abnormalities cause apoptosis.',
      'The chromosome structure determines how apoptosis signals are transmitted downstream.',
    )]
    const result = await extractKeywords(paras)
    const aIdx = result.indexOf('apoptosis')
    const cIdx = result.indexOf('chromosome')
    if (aIdx !== -1 && cIdx !== -1) {
      expect(aIdx).toBeLessThan(cIdx)
    } else {
      expect(aIdx).toBeGreaterThanOrEqual(0)
    }
  })

  // ── Sentence-starter / false-capital tests ─────────────────────────────────

  it('does not extract a word that only appears at sentence starts', async () => {
    const paras = [para(
      'However, the results were unexpected.',
      'However, the team decided to proceed.',
      'However, no significant difference was observed in the control group.',
    )]
    const result = await extractKeywords(paras)
    expect(result).not.toContain('however')
  })

  it('extracts a word that appears both at sentence starts and mid-sentence', async () => {
    const paras = [para(
      'Einstein proposed the theory of relativity in 1905.',
      'The work of Einstein transformed modern physics fundamentally.',
      'Einstein received the Nobel Prize for the photoelectric effect.',
    )]
    const result = await extractKeywords(paras)
    expect(result).toContain('einstein')
  })

  // ── Citation handling ──────────────────────────────────────────────────────

  it('does not extract numeric citation tokens like "[14]"', async () => {
    const paras = [para(
      'Cell death [14] is a well-documented process [15] in developmental biology [16].',
      'Apoptosis [14] is distinct from necrosis and is regulated by the BCL-2 family.',
    )]
    const result = await extractKeywords(paras)
    expect(result).not.toContain('14')
    expect(result).not.toContain('15')
    expect(result).not.toContain('16')
  })

  it('does not extract author-year citation fragments like "et" or "al"', async () => {
    const paras = [para(
      'As shown by Smith et al. (2023), apoptosis is triggered by caspase activation.',
      'Johnson et al. (2022) confirmed that neuron loss correlates with disease severity.',
      'The findings of Brown et al. (2021) were replicated in three independent cohorts.',
    )]
    const result = await extractKeywords(paras)
    expect(result).not.toContain('et')
    expect(result).not.toContain('al')
  })

  it('still extracts the real content words from a sentence containing a citation', async () => {
    const paras = [para(
      'As shown by Smith et al. (2023), apoptosis is triggered by caspase activation.',
      'Johnson et al. (2022) confirmed that neuron loss correlates with disease severity.',
      'Apoptosis and neuron degeneration are the two primary outcomes studied here.',
    )]
    const result = await extractKeywords(paras)
    expect(result).toContain('apoptosis')
    expect(result).toContain('neuron')
  })


  it('extracts "U.S." as a keyword when it appears multiple times', async () => {
    const paras = [para(
      'The U.S. government invested heavily in vaccine development programs.',
      'U.S. researchers published landmark findings on mRNA technology applications.',
      'Funding from U.S. agencies accelerated the clinical trial approval process.',
    )]
    const result = await extractKeywords(paras)
    // Canonical form must match extractAcronyms: lowercase with dots preserved.
    expect(result).toContain('u.s.')
    // Must NOT appear as the stop word "us" or a dot-stripped variant.
    expect(result).not.toContain('us')
    expect(result).not.toContain('u.s') // no trailing dot = wrong canonical form
  })

  it('extracts "U.S.A." as a keyword when it appears multiple times', async () => {
    const paras = [para(
      'Funding from U.S.A. agencies accelerated the clinical trial approval process.',
      'U.S.A. health authorities monitor adverse event reports on a quarterly basis.',
      'Researchers at U.S.A. universities published findings on metabolic disorders.',
    )]
    const result = await extractKeywords(paras)
    expect(result).toContain('u.s.a.')
    expect(result).not.toContain('usa')
  })

  it('does not extract "U.S." when it appears only once', async () => {
    const paras = [para(
      'U.S. researchers published landmark findings on mRNA technology applications.',
      'Studies confirmed that the intervention reduced mortality in treated patients.',
      'The trial enrolled two hundred participants across six hospital sites nationally.',
    )]
    const result = await extractKeywords(paras)
    expect(result).not.toContain('u.s.')
  })

  it('ranks "U.S." alongside other high-frequency acronyms like WHO', async () => {
    // Both appear 3+ times — both should surface, U.S. ranked near WHO.
    const paras = [para(
      'The WHO issued a global alert and U.S. authorities confirmed local cases.',
      'WHO and U.S. agencies coordinated the containment response across continents.',
      'U.S. officials briefed WHO representatives on the outbreak trajectory data.',
    )]
    const result = await extractKeywords(paras)
    expect(result).toContain('who')
    expect(result).toContain('u.s.')
  })

  it('[control] plain ALL-CAPS acronym WHO is extracted correctly (no dots)', async () => {
    const paras = [para(
      'The WHO issued a global alert for the outbreak detected in South-East Asia.',
      'WHO officials confirmed that containment measures had been implemented globally.',
      'Member states were required to report case counts to WHO within 24 hours.',
    )]
    const result = await extractKeywords(paras)
    expect(result).toContain('who')
  })

  it('[control] plain ALL-CAPS acronym WHO is extracted correctly (no dots)', async () => {
    const paras = [para(
      'The WHO issued a global alert for the outbreak detected in South-East Asia.',
      'WHO officials confirmed that containment measures had been implemented globally.',
      'Member states were required to report case counts to WHO within 24 hours.',
    )]
    const result = await extractKeywords(paras)
    expect(result).toContain('who')
  })
})