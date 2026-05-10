import { useEffect, useRef } from 'react'
import { useSettings } from './useSettings'
import { applyPhraseBolding, removePhraseBolding } from '../utils/phraseBolder'
import { applyWordUnderlines, removeWordUnderlines } from '../utils/wordScanner'
import { applySentenceSplit, removeSentenceSplit } from '../utils/sentenceSplitter'
import { applyPOSHighlight, removePOSHighlight } from '../utils/posHighlighter'

const BACKEND_URL = 'http://localhost:8000'

interface ParagraphScore {
  text: string
  action: 'none' | 'split' | 'llm'
}

interface AnalysisResult {
  bold_targets: string[]
  complex_words: string[]
  sentences: string[]
  paragraph_scores: ParagraphScore[]
}

function getParagraphs(): string[] {
  const selectors = ['main', 'article', '[role="main"]', '#content', '.content']
  let root: Element | null = null
  for (const sel of selectors) {
    root = document.querySelector(sel)
    if (root) break
  }
  root = root ?? document.body

  const candidates = Array.from(root.querySelectorAll('p, li'))
  const paragraphs = candidates
    .map(el => (el.textContent ?? '').trim())
    .filter(text => text.split(/\s+/).length >= 18)

  return paragraphs.length >= 3 ? paragraphs : []
}

function getHash(paragraphs: string[]): string {
  return paragraphs.map(p => p.slice(0, 50)).join('|')
}

export function usePageAnalysis() {
  const { settings } = useSettings()

  const cache = useRef<AnalysisResult | null>(null)
  const fetchedForHash = useRef<string>('')
  const isFetching = useRef(false)

  // Extract primitives to avoid stale closure / object ref issues
  const keywordBolding = settings.keywordBolding
  const wordSimplification = settings.wordSimplification
  const sentenceSplitting = settings.sentenceSplitting
  const verbOn = settings.posEnabled.verbs
  const nounOn = settings.posEnabled.nouns
  const adjOn = settings.posEnabled.adjectives
  const verbColor = settings.posColors.verbs
  const nounColor = settings.posColors.nouns
  const adjColor = settings.posColors.adjectives

  const anyFeatureOn = keywordBolding || wordSimplification || sentenceSplitting
  const anyPOSOn = verbOn || nounOn || adjOn

  // Always apply in this order: split → POS → bold → underlines
  // This ensures each layer operates on the DOM state left by the previous one,
  // and toggling any one feature re-applies the others so nothing gets wiped.
  function applyAll(data: AnalysisResult | null) {
    // 1. Sentence split (restructures DOM into <ul><li> — must be first)
    if (sentenceSplitting && data) {
      applySentenceSplit(Array.isArray(data.paragraph_scores) ? data.paragraph_scores : [])
    } else {
      removeSentenceSplit()
    }

    // 2. POS highlight (walks text nodes left by split)
    if (anyPOSOn) {
      applyPOSHighlight(
        { verbs: verbColor, nouns: nounColor, adjectives: adjColor },
        { verbs: verbOn, nouns: nounOn, adjectives: adjOn },
      )
    } else {
      removePOSHighlight()
    }

    // 3. Phrase bolding (walks text nodes, wraps matched words in spans)
    if (keywordBolding && data) {
      applyPhraseBolding(data.bold_targets)
    } else {
      removePhraseBolding()
    }

    // 4. Word underlines
    if (wordSimplification && data) {
      applyWordUnderlines(data.complex_words)
    } else {
      removeWordUnderlines()
    }
  }

  // Prefetch on mount
  useEffect(() => {
    if (cache.current) return
    const paragraphs = getParagraphs()
    if (paragraphs.length === 0) return
    const hash = getHash(paragraphs)
    if (fetchedForHash.current === hash) return

    isFetching.current = true
    fetch(`${BACKEND_URL}/process/webpage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paragraphs, max_bold_terms: 20 }),
    })
      .then(res => { if (!res.ok) throw new Error(`${res.status}`); return res.json() })
      .then((data: AnalysisResult) => { cache.current = data; fetchedForHash.current = hash })
      .catch(err => console.warn('[PageAnalysis] prefetch failed:', err))
      .finally(() => { isFetching.current = false })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Main effect — re-runs when any feature toggle or POS setting changes
  useEffect(() => {
    if (!anyFeatureOn && !anyPOSOn) {
      removeSentenceSplit()
      removePOSHighlight()
      removePhraseBolding()
      removeWordUnderlines()
      return
    }

    // POS doesn't need backend data — apply immediately if we have cache or not
    if (!anyFeatureOn && anyPOSOn) {
      removeSentenceSplit()
      applyPOSHighlight(
        { verbs: verbColor, nouns: nounColor, adjectives: adjColor },
        { verbs: verbOn, nouns: nounOn, adjectives: adjOn },
      )
      removePhraseBolding()
      removeWordUnderlines()
      return
    }

    const paragraphs = getParagraphs()
    if (paragraphs.length === 0) {
      // No paragraphs but POS may still work
      applyAll(null)
      return
    }

    const hash = getHash(paragraphs)

    if (cache.current && fetchedForHash.current === hash) {
      applyAll(cache.current)
      return
    }

    if (isFetching.current) return
    isFetching.current = true

    fetch(`${BACKEND_URL}/process/webpage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paragraphs, max_bold_terms: 20 }),
    })
      .then(res => { if (!res.ok) throw new Error(`${res.status}`); return res.json() })
      .then((data: AnalysisResult) => {
        cache.current = data
        fetchedForHash.current = hash
        applyAll(data)
      })
      .catch(err => console.warn('[PageAnalysis] fetch failed:', err))
      .finally(() => { isFetching.current = false })

  }, [
    keywordBolding, wordSimplification, sentenceSplitting,
    verbOn, nounOn, adjOn,
    verbColor, nounColor, adjColor,
  ])
}