/**
 * @file content/hooks/useReadingTools.ts
 *
 * Single orchestrator hook that coordinates all reading-tool DOM passes in
 * the correct order.
 *
 * ## Why one hook instead of four
 * `applySentenceSplit` restructures the DOM, which silently removes any spans
 * previously written by `applyPOSHighlight`, `applyPhraseBolding`, and
 * `applyWordUnderlines`. If those features each run their own `useEffect`,
 * React offers no ordering guarantee between siblings — a POS effect can fire
 * *after* a sentence-split effect has already torn out its spans, leaving the
 * page un-highlighted. Collapsing all four into one effect enforces a strict
 * apply order:
 *
 *   1. Clean everything
 *   2. Sentence split (restructures DOM)
 *   3. POS highlight (paints on restructured DOM)
 *   4. Phrase bolding (async — paints after keyword extraction resolves)
 *   5. Word underlines (async — paints after freq map loads)
 *
 * Each feature is independently gated by its own setting flag; the orchestrator
 * controls ordering, not coupling.
 *
 * ## Usage
 * Replace all four individual reading-tool hooks in `App.tsx` with a single
 * call:
 *
 * ```tsx
 * function App() {
 *   useReadingTools()
 *   return <Dock />
 * }
 * ```
 *
 * ## Lifecycle
 * - On mount or any watched setting change → clean all DOM mutations, then
 *   re-apply whichever features are enabled in order.
 * - On unmount (e.g. master toggle off) → clean all DOM mutations via the
 *   effect cleanup function.
 *
 * ## Deferred execution
 * All DOM work is deferred behind `setTimeout(fn, 0)` so React paints the
 * toggled button state before the (potentially expensive) DOM walk begins.
 * Without this the button appears frozen until all work completes.
 *
 * ## Cancellation
 * A `cancelled` flag and `clearTimeout` guard both the timer and the two
 * async operations (`extractKeywords`, `getFreqMap`) so no stale work is
 * applied after unmount or a settings change that fires the next effect cycle.
 */

import { useEffect, useRef } from 'react'
import { useSettings } from './useSettings'
import { applySentenceSplit, removeSentenceSplit } from '../utils/sentenceSplitter'
import { applyPhraseBolding, removePhraseBolding } from '../utils/phraseBolder'
import { applyWordUnderlines, removeWordUnderlines } from '../utils/wordUnderlines'
import { applyPOSHighlight, removePOSHighlight } from '../utils/posHighlighter'
import { getParagraphs } from '../utils/analysisCache'
import { scoreParagraphs } from '../utils/paragraphScorer'
import { extractKeywords, getBodyParagraphs, getFreqMap } from '../utils/phraseExtractor'
import type { BonitaSettings } from '../../shared/settings'

/** Removes every reading-tool DOM mutation in a single sweep. */
function removeAll(): void {
  removeSentenceSplit()
  removePhraseBolding()
  removeWordUnderlines()
  removePOSHighlight()
}

/**
 * Coordinates all reading-tool DOM passes in a guaranteed order so that
 * sentence splitting (which restructures the DOM) always runs before the
 * annotation passes that depend on a stable DOM.
 *
 * Returns `void` — all side-effects and cleanup are managed internally.
 */
export function useReadingTools(): void {
  const { settings } = useSettings()

  // Extract primitives to avoid infinite loops from new object references.
  // useSettings may return a fresh settings object on every render; listing
  // the whole object as a dep would re-fire the effect every render.
  const verbOn    = settings.posEnabled.verbs
  const nounOn    = settings.posEnabled.nouns
  const adjOn     = settings.posEnabled.adjectives
  const verbColor = settings.posColors.verbs
  const nounColor = settings.posColors.nouns
  const adjColor  = settings.posColors.adjectives

  const sentenceSplitting  = settings.sentenceSplitting
  const keywordBolding     = settings.keywordBolding
  const boldTargetCount    = settings.boldTargetCount ?? 7
  const wordSimplification = settings.wordSimplification
  const wordComplexity     = settings.wordComplexity

  /**
   * Always holds the latest settings so the deferred callback reads fresh
   * values even if settings change between scheduling and execution.
   */
  const settingsRef = useRef<BonitaSettings>(settings)
  settingsRef.current = settings

  useEffect(() => {
    let cancelled = false
    let timerId: ReturnType<typeof setTimeout>

    timerId = setTimeout(() => {
      if (cancelled) return
      const s = settingsRef.current
      const anyPOSOn = s.posEnabled.verbs || s.posEnabled.nouns || s.posEnabled.adjectives

      // ── 1. Clean slate ───────────────────────────────────────────────────
      removeAll()

      // ── 2. Sentence split (restructures DOM — must run first) ────────────
      if (s.sentenceSplitting) {
        const paragraphScores = scoreParagraphs(getParagraphs())
        applySentenceSplit(paragraphScores)
      }

      // ── 3. POS highlight (synchronous — runs on post-split DOM) ──────────
      if (anyPOSOn) {
        applyPOSHighlight(s.posColors, s.posEnabled)
      }

      // ── 4. Phrase bolding (async) ────────────────────────────────────────
      if (s.keywordBolding) {
        extractKeywords(getBodyParagraphs(), s.boldTargetCount ?? 7).then(targets => {
          if (!cancelled) applyPhraseBolding(targets)
        })
      }

      // ── 5. Word underlines (async) ───────────────────────────────────────
      if (s.wordSimplification) {
        getFreqMap().then(freq => {
          if (!cancelled) applyWordUnderlines(freq, s.wordComplexity)
        })
      }
    }, 0)

    return () => {
      cancelled = true
      clearTimeout(timerId)
      removeAll()
    }
  }, [
    sentenceSplitting,
    verbOn, nounOn, adjOn,
    verbColor, nounColor, adjColor,
    keywordBolding, boldTargetCount,
    wordSimplification, wordComplexity,
  ])
}