/**
 * Tests for paragraphScorer.ts
 *
 * countSyllables   — vowel-group counting, punctuation stripping, edge cases
 * splitSentences   — basic splitting, abbreviation handling, lowercase merging
 * scoreParagraph   — Flesch score + penalties → action thresholds + debug metrics
 * scoreParagraphs  — maps scoreParagraph over an array
 */

import { describe, it, expect } from 'vitest'
import {
  countSyllables,
  splitSentences,
  scoreParagraph,
  scoreParagraphs,
} from '../../content/utils/paragraphScorer'

// ─── countSyllables ───────────────────────────────────────────────────────────

describe('countSyllables', () => {
  it('returns 1 for a single vowel word', () => {
    expect(countSyllables('a')).toBe(1)
  })

  it('counts one vowel group as one syllable', () => {
    expect(countSyllables('cat')).toBe(1)   // c-a-t
  })

  it('counts two vowel groups as two syllables', () => {
    expect(countSyllables('hello')).toBe(2) // hel-lo → e, o
  })

  it('counts y as a vowel', () => {
    expect(countSyllables('rhythm')).toBe(1) // y is the only vowel
  })

  it('treats consecutive vowels as one syllable group', () => {
    // b-eau-t-i-f-u-l → groups: eau(1), i(2), u(3)
    expect(countSyllables('beautiful')).toBe(3)
  })

  it('strips punctuation before counting', () => {
    expect(countSyllables('hello,')).toBe(countSyllables('hello'))
    expect(countSyllables('word.')).toBe(countSyllables('word'))
  })

  it('returns at least 1 even for strings with no vowels', () => {
    expect(countSyllables('rhythm')).toBeGreaterThanOrEqual(1)
  })

  it('returns 1 for an empty string after cleaning', () => {
    expect(countSyllables('')).toBe(1)
  })
})

// ─── splitSentences ───────────────────────────────────────────────────────────

describe('splitSentences', () => {
  it('splits basic sentences', () => {
    const result = splitSentences('The cat sat. The dog ran.')
    expect(result).toHaveLength(2)
    expect(result[0]).toBe('The cat sat.')
    expect(result[1]).toBe('The dog ran.')
  })

  it('returns the original text as one sentence when no split is possible', () => {
    const text = 'Just one sentence here'
    const result = splitSentences(text)
    expect(result).toHaveLength(1)
    expect(result[0]).toBe(text)
  })

  it('merges lowercase continuation back onto previous sentence (abbreviations)', () => {
    // "Dr." causes a split — "smith went" starts lowercase so should be merged
    const result = splitSentences('She visited Dr. smith yesterday.')
    expect(result).toHaveLength(1)
  })

  it('does not merge a fragment that starts with an uppercase letter', () => {
    const result = splitSentences('She left. He stayed.')
    expect(result).toHaveLength(2)
  })

  it('filters out empty fragments', () => {
    const result = splitSentences('   ')
    expect(result).toEqual([])
  })
})

// ─── scoreParagraph ───────────────────────────────────────────────────────────

describe('scoreParagraph', () => {
  it('returns action "none" for empty text', () => {
    expect(scoreParagraph('').action).toBe('none')
  })

  it('returns action "none" for simple readable text', () => {
    // Short common words, short sentences → high Flesch score
    const simple = 'The cat sat on the mat. The dog ran to the park. She saw a big red ball.'
    expect(scoreParagraph(simple).action).toBe('none')
  })

  it('returns action "split" for moderately complex text', () => {
    // Longer sentences with moderately complex words push score into 40-60 range
    const moderate =
      'The investigation revealed substantial inconsistencies in the documented evidence. ' +
      'Researchers determined that additional verification procedures were necessary to establish credibility. ' +
      'The committee subsequently requested comprehensive supplementary documentation from all participating institutions.'
    const result = scoreParagraph(moderate)
    expect(['split', 'llm']).toContain(result.action)
  })

  it('returns action "llm" for very dense academic text', () => {
    const dense =
      'Epistemological investigations predicated upon phenomenological methodologies necessitate ' +
      'the systematic deconstruction of heterogeneous ontological presuppositions underlying ' +
      'epistemically constrained representational frameworks, thereby precipitating comprehensive ' +
      'reconceptualisation of consciousness as fundamentally intersubjective rather than solipsistically constituted.'
    expect(scoreParagraph(dense).action).toBe('llm')
  })

  it('preserves the original text in the result', () => {
    const text = 'The cat sat on the mat. The dog ran fast to the park.'
    expect(scoreParagraph(text).text).toBe(text)
  })

  it('trims whitespace from the text field', () => {
    const text = 'The cat sat on the mat.'
    expect(scoreParagraph(`  ${text}  `).text).toBe(text)
  })

  it('includes _debug metrics', () => {
    const result = scoreParagraph('The cat sat on the mat. The dog ran to the park.')
    expect(result._debug).toBeDefined()
    expect(result._debug?.flesch).toBeTypeOf('number')
    expect(result._debug?.score).toBeTypeOf('number')
    expect(result._debug?.avgWordLen).toBeTypeOf('number')
    expect(result._debug?.avgSentLen).toBeTypeOf('number')
    expect(result._debug?.syllableDensity).toBeTypeOf('number')
    expect(result._debug?.sentenceCount).toBeTypeOf('number')
  })

  it('score is always between 0 and 100', () => {
    const texts = [
      'Hi.',
      'The cat sat on the mat.',
      'Epistemological phenomenological methodologies necessitate systematic deconstruction.',
    ]
    for (const text of texts) {
      const { _debug } = scoreParagraph(text)
      if (_debug) {
        expect(_debug.score).toBeGreaterThanOrEqual(0)
        expect(_debug.score).toBeLessThanOrEqual(100)
      }
    }
  })
})

// ─── scoreParagraphs ──────────────────────────────────────────────────────────

describe('scoreParagraphs', () => {
  it('returns an empty array for empty input', () => {
    expect(scoreParagraphs([])).toEqual([])
  })

  it('returns one result per paragraph', () => {
    const paragraphs = [
      'The cat sat on the mat. The dog ran to the park.',
      'She saw a big red ball near the old oak tree.',
    ]
    expect(scoreParagraphs(paragraphs)).toHaveLength(2)
  })

  it('each result has a text and action field', () => {
    const results = scoreParagraphs(['The cat sat on the mat. The dog ran fast.'])
    expect(results[0]).toHaveProperty('text')
    expect(results[0]).toHaveProperty('action')
  })
})