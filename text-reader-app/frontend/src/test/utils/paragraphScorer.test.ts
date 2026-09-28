/**
 * Tests for paragraphScorer.ts
 *
 * complexityOf (indirect) — cache hit/miss via analysisCache
 * scoreParagraph  — word-complexity density scoring, empty-text edge case
 * selectSplitTargets — page-relative ranking + threshold selection
 * scoreParagraphs — end-to-end orchestration
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  scoreParagraph,
  selectSplitTargets,
  scoreParagraphs,
  type ScoredParagraph,
} from '../../content/utils/paragraphScorer'
import * as wordSimplifier from '../../content/utils/wordSimplifier'
import * as phraseExtractor from '../../content/utils/phraseExtractor'
import * as analysisCache from '../../content/utils/analysisCache'

vi.mock('../../content/utils/wordSimplifier', async () => {
  const actual = await vi.importActual<typeof wordSimplifier>('../../content/utils/wordSimplifier')
  return {
    ...actual,
    scoreComplexity: vi.fn(),
  }
})
vi.mock('../../content/utils/phraseExtractor')
vi.mock('../../content/utils/analysisCache')

const scoreComplexity   = wordSimplifier.scoreComplexity as ReturnType<typeof vi.fn>
const getFreqMap        = phraseExtractor.getFreqMap as ReturnType<typeof vi.fn>
const getCachedComplexity = analysisCache.getCachedComplexity as ReturnType<typeof vi.fn>
const setCachedComplexity = analysisCache.setCachedComplexity as ReturnType<typeof vi.fn>

const MEDIUM = wordSimplifier.COMPLEXITY_THRESHOLDS.medium // 0.3
const MOCK_FREQ = new Map<string, number>()

/** Assigns a fixed complexity score per lowercase word for a test. */
function mockScores(scores: Record<string, number>) {
  scoreComplexity.mockImplementation((word: string) => scores[word.toLowerCase()] ?? 0)
}

beforeEach(() => {
  vi.clearAllMocks()
  getFreqMap.mockResolvedValue(MOCK_FREQ)
  getCachedComplexity.mockReturnValue(null) // default: always a cache miss
})

// ─── scoreParagraph ───────────────────────────────────────────────────────────

describe('scoreParagraph', () => {
  it('returns action "none" and no _debug for empty text', async () => {
    const result = await scoreParagraph('')
    expect(result.action).toBe('none')
    expect(result._debug).toBeUndefined()
  })

  it('returns action "none" and no _debug for whitespace-only text', async () => {
    const result = await scoreParagraph('   ')
    expect(result.action).toBe('none')
    expect(result._debug).toBeUndefined()
  })

  it('computes density as the fraction of words at/above the medium threshold', async () => {
    // 4 words, 1 at/above medium → density 0.25
    mockScores({ the: 0.1, cat: 0.1, sat: 0.1, quixotically: MEDIUM })
    const result = await scoreParagraph('the cat sat quixotically', MOCK_FREQ)
    expect(result._debug?.wordCount).toBe(4)
    expect(result._debug?.complexWordCount).toBe(1)
    expect(result._debug?.density).toBeCloseTo(0.25, 3)
  })

  it('computes avgComplexity as the mean of all word scores', async () => {
    mockScores({ a: 0.2, b: 0.4 })
    const result = await scoreParagraph('a b', MOCK_FREQ)
    expect(result._debug?.avgComplexity).toBeCloseTo(0.3, 3)
  })

  it('always returns action "none" — real action is assigned later by selectSplitTargets', async () => {
    mockScores({ hard: 0.99 })
    const result = await scoreParagraph('hard hard hard', MOCK_FREQ)
    expect(result.action).toBe('none')
  })

  it('preserves the original text, trimmed', async () => {
    mockScores({ hello: 0.1 })
    const result = await scoreParagraph('  hello world  ', MOCK_FREQ)
    expect(result.text).toBe('hello world')
  })

  it('uses the passed freq map without calling getFreqMap', async () => {
    mockScores({ word: 0.1 })
    await scoreParagraph('word', MOCK_FREQ)
    expect(getFreqMap).not.toHaveBeenCalled()
  })

  it('calls getFreqMap when no freq map is passed', async () => {
    mockScores({ word: 0.1 })
    await scoreParagraph('word')
    expect(getFreqMap).toHaveBeenCalled()
  })

  it('uses the cached complexity score and skips scoreComplexity on a cache hit', async () => {
    getCachedComplexity.mockReturnValue(0.77)
    const result = await scoreParagraph('anything', MOCK_FREQ)
    expect(scoreComplexity).not.toHaveBeenCalled()
    expect(result._debug?.avgComplexity).toBeCloseTo(0.77, 3)
  })

  it('scores and caches on a cache miss', async () => {
    getCachedComplexity.mockReturnValue(null)
    mockScores({ novel: 0.55 })
    await scoreParagraph('novel', MOCK_FREQ)
    expect(scoreComplexity).toHaveBeenCalledWith('novel', MOCK_FREQ)
    expect(setCachedComplexity).toHaveBeenCalledWith('novel', 0.55)
  })
})

// ─── selectSplitTargets ───────────────────────────────────────────────────────

function fake(density: number, wordCount = 10): ScoredParagraph {
  return {
    text: `para-${density}`,
    action: 'none',
    _debug: { density, avgComplexity: density, wordCount, complexWordCount: Math.round(density * wordCount) },
  }
}

describe('selectSplitTargets', () => {
  it('returns an empty array for empty input', () => {
    expect(selectSplitTargets([], 50)).toEqual([])
  })

  it('marks nothing "split" when thresholdPercent is 0', () => {
    const scores = [fake(0.9), fake(0.1)]
    const result = selectSplitTargets(scores, 0)
    expect(result.every(r => r.action === 'none')).toBe(true)
  })

  it('marks every eligible paragraph "split" when thresholdPercent is 100', () => {
    const scores = [fake(0.9), fake(0.1), fake(0.5)]
    const result = selectSplitTargets(scores, 100)
    expect(result.every(r => r.action === 'split')).toBe(true)
  })

  it('splits only the densest paragraphs for a partial threshold', () => {
    const scores = [fake(0.9), fake(0.1), fake(0.5), fake(0.7)]
    // 50% of 4 = 2 → densest two (0.9, 0.7) should split
    const result = selectSplitTargets(scores, 50)
    expect(result[0].action).toBe('split') // 0.9
    expect(result[3].action).toBe('split') // 0.7
    expect(result[1].action).toBe('none')  // 0.1
    expect(result[2].action).toBe('none')  // 0.5
  })

  it('excludes empty (wordCount 0) paragraphs from the eligible pool', () => {
    const empty: ScoredParagraph = { text: '', action: 'none' }
    const scores = [fake(0.9), empty]
    const result = selectSplitTargets(scores, 100)
    expect(result[0].action).toBe('split')
    expect(result[1].action).toBe('none')
  })

  it('breaks ties by original array order', () => {
    const scores = [fake(0.5), fake(0.5), fake(0.5), fake(0.5)]
    // 50% of 4 = 2 → first two in original order win the tie
    const result = selectSplitTargets(scores, 50)
    expect(result[0].action).toBe('split')
    expect(result[1].action).toBe('split')
    expect(result[2].action).toBe('none')
    expect(result[3].action).toBe('none')
  })
})

// ─── scoreParagraphs ────────────────────────────────────────────────────────

describe('scoreParagraphs', () => {
  it('returns an empty array for empty input', async () => {
    await expect(scoreParagraphs([])).resolves.toEqual([])
  })

  it('returns one result per paragraph, each with text and action', async () => {
    mockScores({ hello: 0.1, world: 0.1 })
    const result = await scoreParagraphs(['hello world', 'hello world'])
    expect(result).toHaveLength(2)
    for (const r of result) {
      expect(r).toHaveProperty('text')
      expect(r).toHaveProperty('action')
    }
  })

  it('resolves the freq map once and reuses it for every paragraph', async () => {
    mockScores({ hello: 0.1 })
    await scoreParagraphs(['hello', 'hello', 'hello'])
    expect(getFreqMap).toHaveBeenCalledTimes(1)
  })

  it('applies the threshold across all paragraphs together, not per-paragraph', async () => {
    mockScores({ easy: 0.1, hard: 0.9 })
    // 30% of 3 eligible = 0.9 → ceil → 1 split, and it must be the densest paragraph
    const result = await scoreParagraphs(['hard hard', 'easy easy', 'easy easy'], 30)
    expect(result.map(r => r.action)).toEqual(['split', 'none', 'none'])
  })

  it('rounds the split count up (ceil), so any nonzero threshold splits at least one', () => {
    const result = selectSplitTargets([fake(0.9), fake(0.1), fake(0.5)], 1)
    expect(result.filter(r => r.action === 'split')).toHaveLength(1)
  })
})