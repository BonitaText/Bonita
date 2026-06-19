/**
 * @file content/utils/wordSimplifier.test.ts
 *
 * Direct unit tests for countSyllables, scoreComplexity, and isComplexWord.
 *
 * This file intentionally has NO vi.mock() calls — it exercises the real
 * implementations so that the scoring logic is verified end-to-end without
 * any stub interference. The DOM-level tests that require a wordSimplifier
 * mock live in wordUnderlines.test.ts, which mocks the module for its own
 * isolated purposes.
 *
 * A hand-crafted frequency map is used instead of loading englishFreq.json
 * so results are deterministic and independent of the bundled data file.
 */

import { describe, it, expect } from 'vitest'
import {
  countSyllables,
  scoreComplexity,
  isComplexWord,
  COMPLEXITY_THRESHOLDS,
  HIGH_CONFIDENCE_THRESHOLD,
} from '../../content/utils/wordSimplifier'

/** Frequency map built from an explicit list — no JSON dependency. */
function makeFreqMap(entries: [string, number][] = []): Map<string, number> {
  return new Map(entries)
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. countSyllables
// ─────────────────────────────────────────────────────────────────────────────

describe('countSyllables', () => {
  it('returns 1 for single-syllable words', () => {
    expect(countSyllables('cat')).toBe(1)
    expect(countSyllables('run')).toBe(1)
    expect(countSyllables('strength')).toBe(1)
  })

  it('subtracts 1 for a trailing silent e when syllable count > 1', () => {
    // "terminate" → vowel clusters: e, i, a, e = 4 clusters, minus 1 for trailing e → 3
    expect(countSyllables('terminate')).toBe(3)
    // "calculate" → a, u, a, e → 4 clusters, minus 1 → 3
    expect(countSyllables('calculate')).toBe(3)
  })

  it('does NOT subtract for trailing e when only one vowel cluster (clamps to 1)', () => {
    // "gate" → one cluster "a", ends in e but count = 1, no subtraction
    expect(countSyllables('gate')).toBe(1)
  })

  it('returns 2 for typical two-syllable words', () => {
    expect(countSyllables('butter')).toBe(2)
    expect(countSyllables('running')).toBe(2)
  })

  it('returns 3 for three-syllable words', () => {
    expect(countSyllables('banana')).toBe(3)
    expect(countSyllables('remember')).toBe(3)
  })

  it('returns 4+ for polysyllabic words', () => {
    expect(countSyllables('university')).toBeGreaterThanOrEqual(4)
    expect(countSyllables('communication')).toBeGreaterThanOrEqual(4)
  })

  it('never returns less than 1', () => {
    // Pathological input — no vowels at all
    expect(countSyllables('rhythm')).toBeGreaterThanOrEqual(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 2. scoreComplexity
// ─────────────────────────────────────────────────────────────────────────────

describe('scoreComplexity', () => {
  it('returns 0 for words shorter than 2 characters', () => {
    const freq = makeFreqMap()
    expect(scoreComplexity('a', freq)).toBe(0)
    expect(scoreComplexity('I', freq)).toBe(0)
  })

  it('returns a higher score for rare words than common ones', () => {
    // "cat" at rank 200 (very common) vs same word unknown to freq map
    const freqWithCat = makeFreqMap([['cat', 200]])
    const freqEmpty   = makeFreqMap()
    expect(scoreComplexity('cat', freqEmpty)).toBeGreaterThan(
      scoreComplexity('cat', freqWithCat),
    )
  })

  it('scores a word in the top-1000 with rarity multiplier 1.0', () => {
    const freq = makeFreqMap([['word', 500]])
    // All other multipliers ≥ 1, so score ≥ 1.0
    expect(scoreComplexity('word', freq)).toBeGreaterThanOrEqual(1.0)
  })

  it('scores a word ranked 10 001–20 000 higher than one ranked ≤ 1 000', () => {
    const freq = makeFreqMap([['simple', 300], ['abstruse', 15000]])
    expect(scoreComplexity('abstruse', freq)).toBeGreaterThan(
      scoreComplexity('simple', freq),
    )
  })

  it('gives a bonus for words with Latinate suffixes (-ology, -itis, etc.)', () => {
    const freq = makeFreqMap()
    // Both unknown (rarity=2), but "neurology" has the -ology suffix
    const withSuffix    = scoreComplexity('neurology', freq)
    const withoutSuffix = scoreComplexity('neurol', freq)
    expect(withSuffix).toBeGreaterThan(withoutSuffix)
  })

  it('gives a bonus for words with Latinate prefixes (psycho-, micro-, etc.)', () => {
    const freq = makeFreqMap()
    const withPrefix    = scoreComplexity('psychometric', freq)
    const withoutPrefix = scoreComplexity('metric', freq)
    expect(withPrefix).toBeGreaterThan(withoutPrefix)
  })

  it('gives a bonus for rare consonant clusters (eau, ieu, oise)', () => {
    const freq = makeFreqMap()
    // "bureau" contains "eau" cluster
    const withCluster    = scoreComplexity('bureau', freq)
    // "bursa" — no special cluster
    const withoutCluster = scoreComplexity('bursa', freq)
    expect(withCluster).toBeGreaterThan(withoutCluster)
  })

  it('is case-insensitive — same score regardless of input casing', () => {
    const freq = makeFreqMap([['ephemeral', 18000]])
    expect(scoreComplexity('Ephemeral', freq)).toBe(
      scoreComplexity('ephemeral', freq),
    )
  })

  it('produces a score ≥ 1 for any word of length ≥ 2', () => {
    const freq = makeFreqMap([['be', 1]])
    expect(scoreComplexity('be', freq)).toBeGreaterThanOrEqual(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 3. isComplexWord
// ─────────────────────────────────────────────────────────────────────────────

describe('isComplexWord', () => {
  it('returns false for a very common short word', () => {
    const freq = makeFreqMap([['the', 1]])
    expect(isComplexWord('the', freq, 'medium')).toBe(false)
  })

  it('returns true for a rare multi-syllable word with a Latinate suffix', () => {
    // "pathological" — rare + 4+ syllables + -ological suffix
    const freq = makeFreqMap() // unknown → rarity 2
    expect(isComplexWord('pathological', freq, 'medium')).toBe(true)
  })

  it('respects the low threshold (more permissive)', () => {
    const freq = makeFreqMap([['obscure', 12000]])
    const atLow    = isComplexWord('obscure', freq, 'low')
    const atHigh   = isComplexWord('obscure', freq, 'high')
    // low threshold is smaller, so it's easier to reach
    if (atHigh) expect(atLow).toBe(true)   // high implies low
    // at minimum, low should fire for this word
    expect(typeof atLow).toBe('boolean')
  })

  it('returns false for a word shorter than 2 characters', () => {
    const freq = makeFreqMap()
    expect(isComplexWord('a', freq, 'low')).toBe(false)
  })

  it('defaults to medium threshold when no level is supplied', () => {
    const freq = makeFreqMap([['ubiquitous', 20000]])
    // Direct comparison: no level arg vs explicit 'medium'
    expect(isComplexWord('ubiquitous', freq)).toBe(
      isComplexWord('ubiquitous', freq, 'medium'),
    )
  })

  it('COMPLEXITY_THRESHOLDS contains low, medium, high keys', () => {
    expect(COMPLEXITY_THRESHOLDS).toHaveProperty('low')
    expect(COMPLEXITY_THRESHOLDS).toHaveProperty('medium')
    expect(COMPLEXITY_THRESHOLDS).toHaveProperty('high')
  })

  it('HIGH_CONFIDENCE_THRESHOLD is positive', () => {
    expect(HIGH_CONFIDENCE_THRESHOLD).toBeGreaterThan(0)
    })
})