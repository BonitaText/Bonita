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
 *
 * ── Scoring model note ────────────────────────────────────────────────────
 * scoreComplexity is a fitted ridge regression (intercept + weighted logs of
 * the rarity / syllable / prefix / suffix / cluster multipliers + an
 * abbreviation signal), NOT a ≥1.0 product. Consequences for these tests:
 *   • Individual multipliers are asserted through getComplexityFeatures,
 *     because some fitted weights are negative (suffix, cluster), so a
 *     "bigger multiplier" no longer implies a "bigger score".
 *   • Score-level tests are relative (A > B) or check the intercept-free
 *     invariants (finite, positive), never absolute values, so they survive
 *     a refit of FITTED_WEIGHTS.
 *   • The old `length < 2 → 0` guard is gone; only tokens with no letters
 *     score 0. Short uppercase tokens get a bonus via abbreviationSignal.
 */

import { describe, it, expect } from 'vitest'
import {
  countSyllables,
  scoreComplexity,
  isComplexWord,
  getComplexityFeatures,
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
// 2. getComplexityFeatures — the individual multipliers
// ─────────────────────────────────────────────────────────────────────────────

describe('getComplexityFeatures', () => {
  it('gives a top-1000 word a rarity multiplier of 1.0', () => {
    const freq = makeFreqMap([['word', 500]])
    expect(getComplexityFeatures('word', freq).rarity).toBe(1.0)
  })

  it('gives a word missing from the frequency map the maximum rarity multiplier (1.8)', () => {
    expect(getComplexityFeatures('word', makeFreqMap()).rarity).toBe(1.8)
  })

  it('rarity increases as frequency rank gets worse', () => {
    const freq = makeFreqMap([['a1', 500], ['a2', 3000], ['a3', 8000], ['a4', 15000], ['a5', 50000]])
    const r = ['a1', 'a2', 'a3', 'a4', 'a5'].map(w => getComplexityFeatures(w, freq).rarity)
    for (let i = 1; i < r.length; i++) expect(r[i]).toBeGreaterThan(r[i - 1])
  })

  it('detects Latinate suffixes (-ology, etc.)', () => {
    const freq = makeFreqMap()
    expect(getComplexityFeatures('neurology', freq).suffix).toBeGreaterThan(
      getComplexityFeatures('neurol', freq).suffix,
    )
  })

  it('detects Latinate prefixes (micro-, etc.)', () => {
    const freq = makeFreqMap()
    expect(getComplexityFeatures('microscope', freq).prefix).toBeGreaterThan(
      getComplexityFeatures('scope', freq).prefix,
    )
  })

  it('detects rare consonant clusters (eau, ieu, oise)', () => {
    const freq = makeFreqMap()
    // "bureau" contains the "eau" cluster; "bursa" has no special cluster
    expect(getComplexityFeatures('bureau', freq).cluster).toBeGreaterThan(
      getComplexityFeatures('bursa', freq).cluster,
    )
  })

  it('returns 1.0 for prefix / suffix / cluster when nothing matches', () => {
    const f = getComplexityFeatures('cat', makeFreqMap())
    expect(f.prefix).toBe(1.0)
    expect(f.suffix).toBe(1.0)
    expect(f.cluster).toBe(1.0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 3. scoreComplexity
// ─────────────────────────────────────────────────────────────────────────────

describe('scoreComplexity', () => {
  it('returns 0 for tokens that contain no letters', () => {
    const freq = makeFreqMap()
    expect(scoreComplexity('', freq)).toBe(0)
    expect(scoreComplexity('123', freq)).toBe(0)
    expect(scoreComplexity('--', freq)).toBe(0)
  })

  it('no longer zeroes out single-letter tokens; uppercase ones get the abbreviation bonus', () => {
    const freq = makeFreqMap()
    expect(scoreComplexity('a', freq)).toBeGreaterThan(0)
    expect(scoreComplexity('I', freq)).toBeGreaterThan(scoreComplexity('a', freq))
  })

  it('returns a higher score for rare words than common ones', () => {
    // "cat" at rank 200 (very common) vs same word unknown to freq map
    const freqWithCat = makeFreqMap([['cat', 200]])
    const freqEmpty   = makeFreqMap()
    expect(scoreComplexity('cat', freqEmpty)).toBeGreaterThan(
      scoreComplexity('cat', freqWithCat),
    )
  })

  it('scores a top-1000 word with no morphology below an unknown word', () => {
    const known   = makeFreqMap([['word', 500]])
    const unknown = makeFreqMap()
    expect(scoreComplexity('word', known)).toBeLessThan(scoreComplexity('word', unknown))
  })

  it('scores a word ranked 10 001–20 000 higher than one ranked ≤ 1 000', () => {
    const freq = makeFreqMap([['simple', 300], ['abstruse', 15000]])
    expect(scoreComplexity('abstruse', freq)).toBeGreaterThan(
      scoreComplexity('simple', freq),
    )
  })

  it('is case-insensitive for long words — same score regardless of input casing', () => {
    const freq = makeFreqMap([['ephemeral', 18000]])
    expect(scoreComplexity('Ephemeral', freq)).toBe(scoreComplexity('ephemeral', freq))
    expect(scoreComplexity('EPHEMERAL', freq)).toBe(scoreComplexity('ephemeral', freq))
  })

  it('is case-SENSITIVE for short tokens (abbreviation signal)', () => {
    const freq = makeFreqMap([['es', 5000]])
    expect(scoreComplexity('ES', freq)).toBeGreaterThan(scoreComplexity('es', freq))
  })

  it('gives no abbreviation bonus to uppercase tokens longer than 6 letters', () => {
    const freq = makeFreqMap([['biomarker', 9000]])
    expect(scoreComplexity('BIOMARKER', freq)).toBe(scoreComplexity('biomarker', freq))
  })

  it('produces a finite, positive score for any word containing a letter', () => {
    const freq = makeFreqMap([['be', 1]])
    const score = scoreComplexity('be', freq)
    expect(Number.isFinite(score)).toBe(true)
    expect(score).toBeGreaterThan(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 4. isComplexWord
// ─────────────────────────────────────────────────────────────────────────────

describe('isComplexWord', () => {
  it('returns false for a very common short word', () => {
    const freq = makeFreqMap([['the', 1]])
    expect(isComplexWord('the', freq, 'medium')).toBe(false)
  })

  it('returns true for a rare multi-syllable word with a Latinate suffix', () => {
    // "pathological" — rare + 4+ syllables + -ological suffix
    const freq = makeFreqMap() // unknown → rarity 1.8
    expect(isComplexWord('pathological', freq, 'medium')).toBe(true)
  })

  it('respects the low threshold (more permissive)', () => {
    const freq = makeFreqMap([['obscure', 12000]])
    const atLow  = isComplexWord('obscure', freq, 'low')
    const atHigh = isComplexWord('obscure', freq, 'high')
    // low threshold is smaller, so it's easier to reach
    if (atHigh) expect(atLow).toBe(true) // high implies low
    expect(typeof atLow).toBe('boolean')
  })

  it('returns false for a very common single-letter word', () => {
    // A single letter is no longer auto-rejected by a length guard; it is
    // rejected because a top-ranked word scores near the intercept, below
    // every threshold. (With an empty freq map it would be "unknown" and
    // score above all thresholds — that is the stale-threshold known issue.)
    const freq = makeFreqMap([['a', 1]])
    expect(isComplexWord('a', freq, 'low')).toBe(false)
  })

  it('defaults to medium threshold when no level is supplied', () => {
    const freq = makeFreqMap([['ubiquitous', 20000]])
    // Direct comparison: no level arg vs explicit 'medium'
    expect(isComplexWord('ubiquitous', freq)).toBe(
      isComplexWord('ubiquitous', freq, 'medium'),
    )
  })

  it('COMPLEXITY_THRESHOLDS contains low, medium, high keys in ascending order', () => {
    expect(COMPLEXITY_THRESHOLDS).toHaveProperty('low')
    expect(COMPLEXITY_THRESHOLDS).toHaveProperty('medium')
    expect(COMPLEXITY_THRESHOLDS).toHaveProperty('high')
    expect(COMPLEXITY_THRESHOLDS.low).toBeLessThan(COMPLEXITY_THRESHOLDS.medium)
    expect(COMPLEXITY_THRESHOLDS.medium).toBeLessThan(COMPLEXITY_THRESHOLDS.high)
  })

  it('HIGH_CONFIDENCE_THRESHOLD is positive', () => {
    expect(HIGH_CONFIDENCE_THRESHOLD).toBeGreaterThan(0)
  })
})