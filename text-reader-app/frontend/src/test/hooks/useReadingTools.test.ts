/**
 * @file hooks/__tests__/useReadingTools.test.ts
 */
import { vi, type MockedFunction } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import { useReadingTools } from '../../content/hooks/useReadingTools'
import { makeSettingsWrapper } from '../test-utils/makeSettingsWrapper'
import * as sentenceSplitter from '../../content/utils/sentenceSplitter'
import * as phraseBolder from '../../content/utils/phraseBolder'
import * as posHighlighter from '../../content/utils/posHighlighter'
import * as wordUnderlines from '../../content/utils/wordUnderlines'
import * as phraseExtractor from '../../content/utils/phraseExtractor'

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../../content/utils/sentenceSplitter')
vi.mock('../../content/utils/phraseBolder')
vi.mock('../../content/utils/posHighlighter')
vi.mock('../../content/utils/wordUnderlines')
vi.mock('../../content/utils/phraseExtractor')

const applySentenceSplit  = sentenceSplitter.applySentenceSplit  as MockedFunction<typeof sentenceSplitter.applySentenceSplit>
const removeSentenceSplit = sentenceSplitter.removeSentenceSplit as MockedFunction<typeof sentenceSplitter.removeSentenceSplit>
const applyPhraseBolding  = phraseBolder.applyPhraseBolding      as MockedFunction<typeof phraseBolder.applyPhraseBolding>
const removePhraseBolding = phraseBolder.removePhraseBolding     as MockedFunction<typeof phraseBolder.removePhraseBolding>
const applyPOSHighlight   = posHighlighter.applyPOSHighlight     as MockedFunction<typeof posHighlighter.applyPOSHighlight>
const removePOSHighlight  = posHighlighter.removePOSHighlight    as MockedFunction<typeof posHighlighter.removePOSHighlight>
const applyWordUnderlines = wordUnderlines.applyWordUnderlines   as MockedFunction<typeof wordUnderlines.applyWordUnderlines>
const removeWordUnderlines= wordUnderlines.removeWordUnderlines  as MockedFunction<typeof wordUnderlines.removeWordUnderlines>
const extractKeywords     = phraseExtractor.extractKeywords      as MockedFunction<typeof phraseExtractor.extractKeywords>
const getBodyParagraphs   = phraseExtractor.getBodyParagraphs    as MockedFunction<typeof phraseExtractor.getBodyParagraphs>
const getFreqMap          = phraseExtractor.getFreqMap           as MockedFunction<typeof phraseExtractor.getFreqMap>

const MOCK_KEYWORDS = [
  { term: 'machine learning', score: 5 },
  { term: 'neural network', score: 3 },
]
const MOCK_FREQ       = new Map([['the', 1], ['complex', 9999]])
const MOCK_PARAGRAPHS = ['paragraph one', 'paragraph two']

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ticks = async (n = 5) => {
  for (let i = 0; i < n; i++) await Promise.resolve()
}

/** One "round": fire all timers, then drain microtasks, inside act. */
const advance = () =>
  act(async () => {
    vi.runAllTimers()
    await ticks()
  })

/**
 * Runs enough rounds to get through split → epoch bump → re-render →
 * downstream effect timers → beginWork/nextPaint → async work.
 */
async function flush(rounds = 6) {
  for (let i = 0; i < rounds; i++) await advance()
}

/** Advance timers/microtasks until `cond()` is true (or give up after `max` rounds). */
async function flushUntil(cond: () => boolean, max = 20) {
  for (let i = 0; i < max && !cond(); i++) await advance()
  if (!cond()) throw new Error('flushUntil: condition never became true')
}

/** A promise whose resolver is guaranteed to be a function from the start. */
function deferred<T>() {
  let resolve: (v: T) => void = () => {}
  const promise = new Promise<T>(r => { resolve = r })
  return { promise, resolve }
}

// ─── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()

  // jsdom doesn't implement requestAnimationFrame; nextPaint()'s double-rAF
  // needs a stand-in that still resolves under fake timers.
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) =>
    setTimeout(() => cb(performance.now()), 0) as unknown as number,
  )

  getBodyParagraphs.mockReturnValue(MOCK_PARAGRAPHS)
  applySentenceSplit.mockResolvedValue(undefined)
  extractKeywords.mockResolvedValue(MOCK_KEYWORDS)
  getFreqMap.mockResolvedValue(MOCK_FREQ)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('useReadingTools', () => {

  // ── Ordering ───────────────────────────────────────────────────────────────

  describe('apply ordering', () => {
    it('applies sentence split before POS highlight', async () => {
      const callOrder: string[] = []
      applySentenceSplit.mockImplementation(async () => { callOrder.push('split') })
      applyPOSHighlight.mockImplementation(() => { callOrder.push('pos') })

      renderHook(() => useReadingTools(), {
        wrapper: makeSettingsWrapper({
          sentenceSplitting: true,
          posEnabled: { verbs: true, nouns: false, adjectives: false },
        }),
      })

      await flush()

      expect(callOrder).toContain('split')
      expect(callOrder).toContain('pos')
      expect(callOrder.indexOf('split')).toBeLessThan(callOrder.indexOf('pos'))
    })

    it('does not run POS/bolding/underlines before the initial split resolves', async () => {
      const split = deferred<void>()
      applySentenceSplit.mockImplementation(() => split.promise)

      renderHook(() => useReadingTools(), {
        wrapper: makeSettingsWrapper({
          sentenceSplitting: true,
          posEnabled: { verbs: true, nouns: false, adjectives: false },
        }),
      })

      await flushUntil(() => applySentenceSplit.mock.calls.length > 0)
      await flush(2)
      expect(applyPOSHighlight).not.toHaveBeenCalled()

      split.resolve()
      await flush()
      expect(applyPOSHighlight).toHaveBeenCalled()
    })

    it('defers all DOM work until setTimeout fires', () => {
      renderHook(() => useReadingTools(), {
        wrapper: makeSettingsWrapper({ sentenceSplitting: true }),
      })

      expect(applySentenceSplit).not.toHaveBeenCalled()
    })
  })

  // ── Individual features ────────────────────────────────────────────────────

  describe('sentence splitting', () => {
    it('calls applySentenceSplit with the threshold when sentenceSplitting is on', async () => {
      renderHook(() => useReadingTools(), {
        wrapper: makeSettingsWrapper({ sentenceSplitting: true, splitThresholdPercent: 65 }),
      })

      await flush()

      expect(applySentenceSplit).toHaveBeenCalledWith({ thresholdPercent: 65 })
    })

    it('calls removeSentenceSplit (not applySentenceSplit) when sentenceSplitting is off', async () => {
      renderHook(() => useReadingTools(), {
        wrapper: makeSettingsWrapper({ sentenceSplitting: false }),
      })

      await flush()

      expect(applySentenceSplit).not.toHaveBeenCalled()
      expect(removeSentenceSplit).toHaveBeenCalled()
    })
  })

  describe('POS highlight', () => {
    it('calls applyPOSHighlight when at least one POS flag is on', async () => {
      const posColors  = { verbs: '#ff0000', nouns: '#00ff00', adjectives: '#0000ff' }
      const posEnabled = { verbs: true, nouns: false, adjectives: false }

      renderHook(() => useReadingTools(), {
        wrapper: makeSettingsWrapper({ sentenceSplitting: false, posEnabled, posColors }),
      })

      await flush()

      expect(applyPOSHighlight).toHaveBeenCalledWith(posColors, posEnabled)
    })

    it('does not call applyPOSHighlight when all POS flags are off', async () => {
      renderHook(() => useReadingTools(), {
        wrapper: makeSettingsWrapper({
          sentenceSplitting: false,
          posEnabled: { verbs: false, nouns: false, adjectives: false },
        }),
      })

      await flush()

      expect(applyPOSHighlight).not.toHaveBeenCalled()
    })

    it('applies POS highlight without sentence splitting when only POS is on', async () => {
      renderHook(() => useReadingTools(), {
        wrapper: makeSettingsWrapper({
          sentenceSplitting: false,
          posEnabled: { verbs: true, nouns: false, adjectives: false },
        }),
      })

      await flush()

      expect(applySentenceSplit).not.toHaveBeenCalled()
      expect(applyPOSHighlight).toHaveBeenCalled()
    })
  })

  describe('phrase bolding', () => {
    it('calls extractKeywords and applyPhraseBolding when keywordBolding is on', async () => {
      renderHook(() => useReadingTools(), {
        wrapper: makeSettingsWrapper({
          sentenceSplitting: false,
          keywordBolding: true,
          boldThresholdPercent: 40,
        }),
      })

      await flush()
      await flush()

      expect(extractKeywords).toHaveBeenCalledWith(MOCK_PARAGRAPHS)
      expect(applyPhraseBolding).toHaveBeenCalledWith(MOCK_KEYWORDS, 40)
    })

    it('does not call extractKeywords when keywordBolding is off', async () => {
      renderHook(() => useReadingTools(), {
        wrapper: makeSettingsWrapper({ sentenceSplitting: false, keywordBolding: false }),
      })

      await flush()

      expect(extractKeywords).not.toHaveBeenCalled()
    })

    it('calls removePhraseBolding even when keywordBolding is off (cleanup still runs)', async () => {
      renderHook(() => useReadingTools(), {
        wrapper: makeSettingsWrapper({ sentenceSplitting: false, keywordBolding: false }),
      })

      await flush()

      expect(removePhraseBolding).toHaveBeenCalled()
    })
  })

  describe('word simplification', () => {
    it('calls getFreqMap and applyWordUnderlines when wordSimplification is on', async () => {
      renderHook(() => useReadingTools(), {
        wrapper: makeSettingsWrapper({
          sentenceSplitting: false,
          wordSimplification: true,
          wordComplexity: 'medium',
        }),
      })

      await flush()
      await flush()

      expect(getFreqMap).toHaveBeenCalled()
      expect(applyWordUnderlines).toHaveBeenCalledWith(MOCK_FREQ, 'medium')
    })

    it('does not call getFreqMap when wordSimplification is off', async () => {
      renderHook(() => useReadingTools(), {
        wrapper: makeSettingsWrapper({ sentenceSplitting: false, wordSimplification: false }),
      })

      await flush()

      expect(getFreqMap).not.toHaveBeenCalled()
    })
  })

  // ── Busy / spinner ─────────────────────────────────────────────────────────

  describe('busy flag', () => {
    it('is false when neither bolding nor simplification is enabled', async () => {
      const { result } = renderHook(() => useReadingTools(), {
        wrapper: makeSettingsWrapper({
          sentenceSplitting: false,
          keywordBolding: false,
          wordSimplification: false,
        }),
      })

      await flush()

      expect(result.current).toBe(false)
    })

    it('goes true while bolding is in flight and false once it resolves and MIN_SPINNER_MS elapses', async () => {
      const extract = deferred<typeof MOCK_KEYWORDS>()
      extractKeywords.mockImplementation(() => extract.promise)

      const { result } = renderHook(() => useReadingTools(), {
        wrapper: makeSettingsWrapper({ sentenceSplitting: false, keywordBolding: true }),
      })

      await flushUntil(() => extractKeywords.mock.calls.length > 0) // spinner painted, extract in flight

      expect(result.current).toBe(true)

      extract.resolve(MOCK_KEYWORDS)
      await act(async () => { await ticks() }) // extract → applyPhraseBolding → finally → endWork
      await advance()                          // MIN_SPINNER_MS hide timer

      expect(result.current).toBe(false)
    })
  })

  // ── Cleanup / cancellation ─────────────────────────────────────────────────

  describe('cleanup', () => {
    it('calls all remove functions on unmount', async () => {
      const { unmount } = renderHook(() => useReadingTools(), {
        wrapper: makeSettingsWrapper({ sentenceSplitting: true }),
      })

      await flush()       // let the split finish so effects 2–4 are registered
      vi.clearAllMocks()  // only count calls made by unmount

      unmount()

      expect(removeSentenceSplit).toHaveBeenCalled()
      expect(removePhraseBolding).toHaveBeenCalled()
      expect(removeWordUnderlines).toHaveBeenCalled()
      expect(removePOSHighlight).toHaveBeenCalled()
    })

    it('cancels the split setTimeout when unmounted before it fires', () => {
      const { unmount } = renderHook(() => useReadingTools(), {
        wrapper: makeSettingsWrapper({ sentenceSplitting: true }),
      })

      unmount()
      act(() => { vi.runAllTimers() })

      expect(applySentenceSplit).not.toHaveBeenCalled()
    })

    it('does not apply phrase bolding if unmounted before extractKeywords resolves', async () => {
      const extract = deferred<typeof MOCK_KEYWORDS>()
      extractKeywords.mockImplementation(() => extract.promise)

      const { unmount } = renderHook(() => useReadingTools(), {
        wrapper: makeSettingsWrapper({ sentenceSplitting: false, keywordBolding: true }),
      })

      await flushUntil(() => extractKeywords.mock.calls.length > 0) // extract in flight
      unmount()

      extract.resolve(MOCK_KEYWORDS)
      await act(async () => { await ticks() })

      expect(applyPhraseBolding).not.toHaveBeenCalled()
    })

    it('does not apply word underlines if unmounted before getFreqMap resolves', async () => {
      const freq = deferred<typeof MOCK_FREQ>()
      getFreqMap.mockImplementation(() => freq.promise)

      const { unmount } = renderHook(() => useReadingTools(), {
        wrapper: makeSettingsWrapper({ sentenceSplitting: false, wordSimplification: true }),
      })

      await flushUntil(() => getFreqMap.mock.calls.length > 0) // getFreqMap in flight
      unmount()

      freq.resolve(MOCK_FREQ)
      await act(async () => { await ticks() })

      expect(applyWordUnderlines).not.toHaveBeenCalled()
    })
  })
})