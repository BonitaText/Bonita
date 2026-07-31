/**
 * @file hooks/__tests__/useReadingTools.test.ts
 */
import { vi, type MockedFunction } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useReadingTools } from '../../content/hooks/useReadingTools'
import { makeSettingsWrapper } from '../test-utils/makeSettingsWrapper'
import * as sentenceSplitter from '../../content/utils/sentenceSplitter'
import * as phraseBolder from '../../content/utils/phraseBolder'
import * as posHighlighter from '../../content/utils/posHighlighter'
import * as wordUnderlines from '../../content/utils/wordUnderlines'
import * as phraseExtractor from '../../content/utils/phraseExtractor'
import * as paragraphScorer from '../../content/utils/paragraphScorer'
import * as analysisCache from '../../content/utils/analysisCache'

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../../content/utils/sentenceSplitter')
vi.mock('../../content/utils/phraseBolder')
vi.mock('../../content/utils/posHighlighter')
vi.mock('../../content/utils/wordUnderlines')
vi.mock('../../content/utils/phraseExtractor')
vi.mock('../../content/utils/paragraphScorer')
vi.mock('../../content/utils/analysisCache')

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
const scoreParagraphs     = paragraphScorer.scoreParagraphs      as MockedFunction<typeof paragraphScorer.scoreParagraphs>
const getParagraphs       = analysisCache.getParagraphs          as MockedFunction<typeof analysisCache.getParagraphs>

const MOCK_SCORES    = [{ text: 'Some paragraph.', action: 'split' as const }]
const MOCK_KEYWORDS = [
  { term: 'machine learning', score: 5 },
  { term: 'neural network', score: 3 },
]
const MOCK_FREQ      = new Map([['the', 1], ['complex', 9999]])
const MOCK_PARAGRAPHS = ['paragraph one', 'paragraph two']

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()

  getParagraphs.mockReturnValue(MOCK_PARAGRAPHS)
  getBodyParagraphs.mockReturnValue(MOCK_PARAGRAPHS)
  scoreParagraphs.mockReturnValue(MOCK_SCORES)
  extractKeywords.mockResolvedValue(MOCK_KEYWORDS)
  getFreqMap.mockResolvedValue(MOCK_FREQ)
})

afterEach(() => {
  vi.useRealTimers()
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('useReadingTools', () => {

  // ── Ordering ───────────────────────────────────────────────────────────────

  describe('apply ordering', () => {
    it('always cleans all DOM passes before re-applying', () => {
      renderHook(() => useReadingTools(), {
        wrapper: makeSettingsWrapper({ sentenceSplitting: true }),
      })

      act(() => { vi.runAllTimers() })

      expect(removeSentenceSplit).toHaveBeenCalled()
      expect(removePhraseBolding).toHaveBeenCalled()
      expect(removeWordUnderlines).toHaveBeenCalled()
      expect(removePOSHighlight).toHaveBeenCalled()
    })

    it('applies sentence split before POS highlight', () => {
      const callOrder: string[] = []
      applySentenceSplit.mockImplementation(() => { callOrder.push('split') })
      applyPOSHighlight.mockImplementation(()  => { callOrder.push('pos') })

      renderHook(() => useReadingTools(), {
        wrapper: makeSettingsWrapper({
          sentenceSplitting: true,
          posEnabled: { verbs: true, nouns: false, adjectives: false },
        }),
      })

      act(() => { vi.runAllTimers() })

      expect(callOrder.indexOf('split')).toBeLessThan(callOrder.indexOf('pos'))
    })

    it('defers all DOM work until setTimeout fires', () => {
      renderHook(() => useReadingTools(), {
        wrapper: makeSettingsWrapper({ sentenceSplitting: true }),
      })

      expect(applySentenceSplit).not.toHaveBeenCalled()

      act(() => { vi.runAllTimers() })

      expect(applySentenceSplit).toHaveBeenCalled()
    })
  })

  // ── Individual features ────────────────────────────────────────────────────

  describe('sentence splitting', () => {
    it('calls applySentenceSplit when sentenceSplitting is on', () => {
      renderHook(() => useReadingTools(), {
        wrapper: makeSettingsWrapper({ sentenceSplitting: true }),
      })

      act(() => { vi.runAllTimers() })

      expect(scoreParagraphs).toHaveBeenCalled()
      expect(applySentenceSplit).toHaveBeenCalledWith(MOCK_SCORES)
    })

    it('does not call applySentenceSplit when sentenceSplitting is off', () => {
      renderHook(() => useReadingTools(), {
        wrapper: makeSettingsWrapper({ sentenceSplitting: false }),
      })

      act(() => { vi.runAllTimers() })

      expect(applySentenceSplit).not.toHaveBeenCalled()
    })
  })

  describe('POS highlight', () => {
    it('calls applyPOSHighlight when at least one POS flag is on', () => {
      const posColors  = { verbs: '#ff0000', nouns: '#00ff00', adjectives: '#0000ff' }
      const posEnabled = { verbs: true, nouns: false, adjectives: false }

      renderHook(() => useReadingTools(), {
        wrapper: makeSettingsWrapper({ posEnabled, posColors }),
      })

      act(() => { vi.runAllTimers() })

      expect(applyPOSHighlight).toHaveBeenCalledWith(posColors, posEnabled)
    })

    it('does not call applyPOSHighlight when all POS flags are off', () => {
      renderHook(() => useReadingTools(), {
        wrapper: makeSettingsWrapper({
          posEnabled: { verbs: false, nouns: false, adjectives: false },
        }),
      })

      act(() => { vi.runAllTimers() })

      expect(applyPOSHighlight).not.toHaveBeenCalled()
    })

    it('applies POS highlight without sentence splitting when only POS is on', () => {
      renderHook(() => useReadingTools(), {
        wrapper: makeSettingsWrapper({
          sentenceSplitting: false,
          posEnabled: { verbs: true, nouns: false, adjectives: false },
        }),
      })

      act(() => { vi.runAllTimers() })

      expect(applySentenceSplit).not.toHaveBeenCalled()
      expect(applyPOSHighlight).toHaveBeenCalled()
    })
  })

  describe('phrase bolding', () => {
    it('calls extractKeywords and applyPhraseBolding when keywordBolding is on', async () => {
      renderHook(() => useReadingTools(), {
        wrapper: makeSettingsWrapper({ keywordBolding: true, boldTargetCount: 5 }),
      })

      act(() => { vi.runAllTimers() })
      await act(async () => { await Promise.resolve() })

      expect(extractKeywords).toHaveBeenCalledWith(MOCK_PARAGRAPHS)
      expect(applyPhraseBolding).toHaveBeenCalledWith(MOCK_KEYWORDS, 50)
    })

    it('does not call extractKeywords when keywordBolding is off', () => {
      renderHook(() => useReadingTools(), {
        wrapper: makeSettingsWrapper({ keywordBolding: false }),
      })

      act(() => { vi.runAllTimers() })

      expect(extractKeywords).not.toHaveBeenCalled()
    })

    it('applies phrase bolding without sentence splitting when only bolding is on', async () => {
      renderHook(() => useReadingTools(), {
        wrapper: makeSettingsWrapper({
          sentenceSplitting: false,
          keywordBolding: true,
        }),
      })

      act(() => { vi.runAllTimers() })
      await act(async () => { await Promise.resolve() })

      expect(applySentenceSplit).not.toHaveBeenCalled()
      expect(applyPhraseBolding).toHaveBeenCalled()
    })
  })

  describe('word simplification', () => {
    it('calls getFreqMap and applyWordUnderlines when wordSimplification is on', async () => {
      renderHook(() => useReadingTools(), {
        wrapper: makeSettingsWrapper({
          wordSimplification: true,
          wordComplexity: 'medium',
        }),
      })

      act(() => { vi.runAllTimers() })
      await act(async () => { await Promise.resolve() })

      expect(getFreqMap).toHaveBeenCalled()
      expect(applyWordUnderlines).toHaveBeenCalledWith(MOCK_FREQ, 'medium')
    })

    it('does not call getFreqMap when wordSimplification is off', () => {
      renderHook(() => useReadingTools(), {
        wrapper: makeSettingsWrapper({ wordSimplification: false }),
      })

      act(() => { vi.runAllTimers() })

      expect(getFreqMap).not.toHaveBeenCalled()
    })

    it('applies word underlines without sentence splitting when only word simplification is on', async () => {
      renderHook(() => useReadingTools(), {
        wrapper: makeSettingsWrapper({
          sentenceSplitting: false,
          wordSimplification: true,
        }),
      })

      act(() => { vi.runAllTimers() })
      await act(async () => { await Promise.resolve() })

      expect(applySentenceSplit).not.toHaveBeenCalled()
      expect(applyWordUnderlines).toHaveBeenCalled()
    })
  })

  // ── Combinations ───────────────────────────────────────────────────────────

  describe('feature combinations', () => {
    it('applies all four features together in order', async () => {
      const callOrder: string[] = []
      applySentenceSplit.mockImplementation(() => { callOrder.push('split') })
      applyPOSHighlight.mockImplementation(()  => { callOrder.push('pos') })
      applyPhraseBolding.mockImplementation(() => { callOrder.push('bold'); return Promise.resolve() })
      applyWordUnderlines.mockImplementation(()=> { callOrder.push('underline') })

      renderHook(() => useReadingTools(), {
        wrapper: makeSettingsWrapper({
          sentenceSplitting: true,
          posEnabled: { verbs: true, nouns: false, adjectives: false },
          keywordBolding: true,
          wordSimplification: true,
        }),
      })

      act(() => { vi.runAllTimers() })
      await act(async () => { await Promise.resolve() })
      await act(async () => { await Promise.resolve() })

      expect(callOrder[0]).toBe('split')
      expect(callOrder[1]).toBe('pos')
      expect(callOrder).toContain('bold')
      expect(callOrder).toContain('underline')
    })

    it('all four features off — only remove functions are called', () => {
      renderHook(() => useReadingTools(), {
        wrapper: makeSettingsWrapper({
          sentenceSplitting: false,
          posEnabled: { verbs: false, nouns: false, adjectives: false },
          keywordBolding: false,
          wordSimplification: false,
        }),
      })

      act(() => { vi.runAllTimers() })

      expect(applySentenceSplit).not.toHaveBeenCalled()
      expect(applyPOSHighlight).not.toHaveBeenCalled()
      expect(extractKeywords).not.toHaveBeenCalled()
      expect(getFreqMap).not.toHaveBeenCalled()
    })
  })

  // ── Cleanup / cancellation ─────────────────────────────────────────────────

  describe('cleanup', () => {
    it('calls all remove functions on unmount', () => {
      const { unmount } = renderHook(() => useReadingTools(), {
        wrapper: makeSettingsWrapper({ sentenceSplitting: true }),
      })

      unmount()

      expect(removeSentenceSplit).toHaveBeenCalled()
      expect(removePhraseBolding).toHaveBeenCalled()
      expect(removeWordUnderlines).toHaveBeenCalled()
      expect(removePOSHighlight).toHaveBeenCalled()
    })

    it('cancels the setTimeout when unmounted before it fires', () => {
      const { unmount } = renderHook(() => useReadingTools(), {
        wrapper: makeSettingsWrapper({ sentenceSplitting: true }),
      })

      unmount()
      act(() => { vi.runAllTimers() })

      expect(applySentenceSplit).not.toHaveBeenCalled()
    })

    it('does not apply phrase bolding if unmounted before extractKeywords resolves', async () => {
      const { unmount } = renderHook(() => useReadingTools(), {
        wrapper: makeSettingsWrapper({ keywordBolding: true }),
      })

      act(() => { vi.runAllTimers() })
      unmount()
      await act(async () => { await Promise.resolve() })

      expect(applyPhraseBolding).not.toHaveBeenCalled()
    })

    it('does not apply word underlines if unmounted before getFreqMap resolves', async () => {
      const { unmount } = renderHook(() => useReadingTools(), {
        wrapper: makeSettingsWrapper({ wordSimplification: true }),
      })

      act(() => { vi.runAllTimers() })
      unmount()
      await act(async () => { await Promise.resolve() })

      expect(applyWordUnderlines).not.toHaveBeenCalled()
    })
  })
})