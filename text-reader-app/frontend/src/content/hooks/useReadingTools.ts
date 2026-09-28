/**
 * @file content/hooks/useReadingTools.ts
 *
 * Orchestrator hook that coordinates all reading-tool DOM passes.
 *
 * ## Four effects, not one
 * Each pass — split, POS, bolding, underlines — has its own effect with
 * only its own settings in its dependency array. Toggling `wordComplexity`
 * now touches only the underline pass; POS and bolding, which are
 * expensive DOM walks + `replaceWith` calls, are left completely alone.
 *
 * ## The one real coupling: sentence split restructures the DOM
 * Sentence splitting is the only pass that rewrites paragraph *contents*
 * wholesale, which destroys any spans POS/bolding/underlines painted
 * inside an affected paragraph. Those three still need to repaint after a
 * real split (or split-removal) — but only then, not on every unrelated
 * settings change.
 *
 * `splitEpoch` is bumped once, by the split effect, only after
 * `applySentenceSplit`/`removeSentenceSplit` has actually finished. The
 * other three effects list `splitEpoch` in their deps, so they repaint
 * exactly when the DOM under them changed.
 *
 * ## Mount-time ordering
 * `splitEpoch` starts at `0`. The three downstream effects bail out while
 * it's still `0`, so nothing paints onto pre-split DOM before the initial
 * split pass (enabled or not) has resolved.
 *
 * ## Reliable loading spinner
 * `setBusy(true)` and the heavy work used to run in the same task, so on
 * slower machines the spinner frame never painted before the main thread
 * blocked, and on fast machines it flashed by unseen. `beginWork()` flips
 * `busy` on and `await`s `nextPaint()` — a double-rAF-plus-timeout-fallback
 * — before the caller does any heavy work, so the spinner is guaranteed to
 * be on screen first. `endWork()` keeps it visible for at least
 * `MIN_SPINNER_MS` so a fast pass can't flash it away before it's
 * perceived. Both are ref-counted (`pendingRef`) rather than boolean, so
 * bolding and underlines can overlap without racing each other's
 * show/hide. Only bolding and underlines drive the spinner — POS is
 * synchronous and split isn't currently wrapped in it either, matching
 * prior behavior.
 */

import { useEffect, useRef, useState } from 'react'
import { useSettings } from './useSettings'
import { applySentenceSplit, removeSentenceSplit } from '../utils/sentenceSplitter'
import { applyPhraseBolding, removePhraseBolding } from '../utils/phraseBolder'
import { applyWordUnderlines, removeWordUnderlines } from '../utils/wordUnderlines'
import { applyPOSHighlight, removePOSHighlight } from '../utils/posHighlighter'
import { extractKeywords, getBodyParagraphs, getFreqMap } from '../utils/phraseExtractor'

/** Minimum time (ms) the spinner stays visible once shown. */
const MIN_SPINNER_MS = 400

/**
 * Resolves once the browser has had a chance to paint at least one frame.
 * Double `requestAnimationFrame` — the first callback runs before a paint
 * and schedules the second, which runs only after that paint has happened
 * — with a `setTimeout` fallback so it still resolves in background tabs
 * where rAF is throttled and would otherwise never fire.
 */
function nextPaint(): Promise<void> {
  return new Promise(resolve => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      resolve()
    }
    requestAnimationFrame(() => requestAnimationFrame(finish))
    setTimeout(finish, 100)
  })
}

export function useReadingTools(): boolean {
  const { settings } = useSettings()

  const [busy, setBusy] = useState(false)
  const [splitEpoch, setSplitEpoch] = useState(0)

  // Ref-counted so bolding + underlines can overlap without racing each
  // other's show/hide, and so the min-display timer only fires once the
  // last one finishes.
  const pendingRef = useRef(0)
  const shownAtRef = useRef(0)
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  /** Marks one async pass as starting; resolves after the spinner has painted. */
  async function beginWork(): Promise<void> {
    pendingRef.current += 1
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    }
    if (pendingRef.current === 1) {
      setBusy(true)
      await nextPaint()
      shownAtRef.current = performance.now()
    }
  }

  /** Marks one async pass as finished; hides the spinner once all are done and MIN_SPINNER_MS has elapsed. */
  function endWork(): void {
    pendingRef.current = Math.max(0, pendingRef.current - 1)
    if (pendingRef.current === 0) {
      const remaining = Math.max(0, MIN_SPINNER_MS - (performance.now() - shownAtRef.current))
      hideTimerRef.current = setTimeout(() => {
        if (pendingRef.current === 0) setBusy(false)
      }, remaining)
    }
  }

  const sentenceSplitting     = settings.sentenceSplitting
  const splitThresholdPercent = settings.splitThresholdPercent ?? 50

  const verbOn    = settings.posEnabled.verbs
  const nounOn    = settings.posEnabled.nouns
  const adjOn     = settings.posEnabled.adjectives
  const verbColor = settings.posColors.verbs
  const nounColor = settings.posColors.nouns
  const adjColor  = settings.posColors.adjectives

  const keywordBolding       = settings.keywordBolding
  const boldThresholdPercent = settings.boldThresholdPercent ?? 7

  const wordSimplification = settings.wordSimplification
  const wordComplexity     = settings.wordComplexity

  // ── Pass 1: sentence split ────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false

    const timerId = setTimeout(() => {
      if (cancelled) return

      if (sentenceSplitting) {
        applySentenceSplit({ thresholdPercent: splitThresholdPercent }).then(() => {
          if (!cancelled) setSplitEpoch(e => e + 1)
        })
      } else {
        removeSentenceSplit()
        setSplitEpoch(e => e + 1)
      }
    }, 0)

    return () => {
      cancelled = true
      clearTimeout(timerId)
      removeSentenceSplit()
    }
  }, [sentenceSplitting, splitThresholdPercent])

  // ── Pass 2: POS highlight ─────────────────────────────────────────────
  useEffect(() => {
    if (splitEpoch === 0) return

    let cancelled = false
    const timerId = setTimeout(() => {
      if (cancelled) return
      removePOSHighlight()
      if (verbOn || nounOn || adjOn) {
        applyPOSHighlight(
          { verbs: verbColor, nouns: nounColor, adjectives: adjColor },
          { verbs: verbOn, nouns: nounOn, adjectives: adjOn },
        )
      }
    }, 0)

    return () => {
      cancelled = true
      clearTimeout(timerId)
      removePOSHighlight()
    }
  }, [splitEpoch, verbOn, nounOn, adjOn, verbColor, nounColor, adjColor])

// ── Pass 3: phrase bolding ────────────────────────────────────────────
useEffect(() => {
  if (splitEpoch === 0) return

  let cancelled = false
  const timerId = setTimeout(() => {
    if (cancelled) return

    beginWork().then(() => {
      if (cancelled) { endWork(); return }

      removePhraseBolding()

      if (!keywordBolding) { endWork(); return }

      return extractKeywords(getBodyParagraphs())
        .then(scored => {
          if (cancelled) return
          return applyPhraseBolding(scored, boldThresholdPercent)
        })
        .finally(() => endWork())
    })
  }, 0)

  return () => {
    cancelled = true
    clearTimeout(timerId)
    removePhraseBolding()
  }
}, [splitEpoch, keywordBolding, boldThresholdPercent])

// ── Pass 4: word underlines ───────────────────────────────────────────
useEffect(() => {
  if (splitEpoch === 0) return

  let cancelled = false
  const timerId = setTimeout(() => {
    if (cancelled) return

    beginWork().then(() => {
      if (cancelled) { endWork(); return }

      removeWordUnderlines()

      if (!wordSimplification) { endWork(); return }

      return getFreqMap()
        .then(freq => {
          if (cancelled) return
          applyWordUnderlines(freq, wordComplexity)
        })
        .finally(() => endWork())
    })
  }, 0)

  return () => {
    cancelled = true
    clearTimeout(timerId)
    removeWordUnderlines()
  }
}, [splitEpoch, wordSimplification, wordComplexity])

  // Belt-and-suspenders: if the hook itself unmounts, clear any dangling
  // min-display timer so it can't call setState after unmount.
  useEffect(() => () => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
  }, [])

  return busy
}