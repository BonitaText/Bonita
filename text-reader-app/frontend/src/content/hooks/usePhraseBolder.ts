import { useEffect, useRef } from 'react'
import { useSettings } from './useSettings'
import { applyPhraseBolding, removePhraseBolding } from '../utils/phraseBolder'
import { applyWordUnderlines, removeWordUnderlines } from '../utils/wordScanner'
import { applySentenceSplit, removeSentenceSplit } from '../utils/sentenceSplitter'

const BACKEND_URL = 'http://localhost:8000'
const MIN_PARAGRAPH_WORDS = 18

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

export function usePageAnalysis() {
  const { settings } = useSettings()
  const cache = useRef<AnalysisResult | null>(null)
  const fetchedForHash = useRef<string>('')

  const anyNlpFeatureOn =
    settings.keywordBolding ||
    settings.wordSimplification ||
    settings.sentenceSplitting

  function applyFromCache(data: AnalysisResult) {
    if (settings.sentenceSplitting) applySentenceSplit(Array.isArray(data.paragraph_scores) ? data.paragraph_scores : [])
    else removeSentenceSplit()

    if (settings.keywordBolding) applyPhraseBolding(data.bold_targets)
    else removePhraseBolding()

    if (settings.wordSimplification) applyWordUnderlines(data.complex_words)
    else removeWordUnderlines()
  }

  function getParagraphs(): string[] {
    return Array.from(document.querySelectorAll('p, li, blockquote'))
      .map((el) => el.textContent?.trim() ?? '')
      .filter((text) => text.split(/\s+/).length >= MIN_PARAGRAPH_WORDS)
  }

  function getHash(paragraphs: string[]): string {
    return paragraphs.map(p => p.slice(0, 50)).join('|')
  }

  useEffect(() => {
    if (cache.current) return

    const paragraphs = getParagraphs()
    if (paragraphs.length === 0) return

    const hash = getHash(paragraphs)

    fetch(`${BACKEND_URL}/process/webpage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paragraphs, max_bold_terms: 20 }),
    })
      .then(res => res.json())
      .then((data: AnalysisResult) => {
        cache.current = data
        fetchedForHash.current = hash
      })
      .catch(err => console.warn('[PageAnalysis] prefetch failed:', err))
  }, [])

  useEffect(() => {
    if (!anyNlpFeatureOn) {
      removePhraseBolding()
      removeWordUnderlines()
      removeSentenceSplit()
      return
    }

    const paragraphs = getParagraphs()
    if (paragraphs.length === 0) return

    const hash = getHash(paragraphs)

    if (cache.current && fetchedForHash.current === hash) {
      applyFromCache(cache.current)
      return
    }

    fetch(`${BACKEND_URL}/process/webpage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paragraphs, max_bold_terms: 20 }),
    })
      .then((res) => {
        if (!res.ok) throw new Error(`Backend error: ${res.status}`)
        return res.json()
      })
      .then((data: AnalysisResult) => {
        cache.current = data
        fetchedForHash.current = hash
        applyFromCache(data)
      })
      .catch((err) => console.warn('[PageAnalysis] fetch failed:', err))

  }, [
    settings.keywordBolding,
    settings.wordSimplification,
    settings.sentenceSplitting,
    settings.posEnabled?.verbs,
    settings.posEnabled?.nouns,
    settings.posEnabled?.adjectives,
  ])
}