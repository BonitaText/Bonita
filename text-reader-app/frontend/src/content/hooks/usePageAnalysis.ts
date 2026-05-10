import { useEffect } from 'react'
import { useSettings } from './useSettings'
import { applyPhraseBolding, removePhraseBolding } from '../utils/phraseBolder'
import { applyWordUnderlines, removeWordUnderlines } from '../utils/wordScanner'
import { applySentenceSplit, removeSentenceSplit } from '../utils/sentenceSplitter'

const BACKEND_URL = 'http://localhost:8000'
const MIN_PARAGRAPH_WORDS = 18

export function usePageAnalysis() {
  const { settings } = useSettings()

  const anyNlpFeatureOn =
    settings.keywordBolding ||
    settings.wordSimplification ||
    settings.sentenceSplitting

  useEffect(() => {
    // If all NLP features are off, clean up and bail
    if (!anyNlpFeatureOn) {
      removePhraseBolding()
      removeWordUnderlines()
      removeSentenceSplit()
      return
    }

    const paragraphs = Array.from(document.querySelectorAll('p, li, blockquote'))
      .map((el) => el.textContent?.trim() ?? '')
      .filter((text) => text.split(/\s+/).length >= MIN_PARAGRAPH_WORDS)

    if (paragraphs.length === 0) return

    fetch(`${BACKEND_URL}/process/webpage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paragraphs, max_bold_terms: 20 }),
    })
      .then((res) => {
        if (!res.ok) throw new Error(`Backend error: ${res.status}`)
        return res.json()
      })
      .then((data) => {
        if (settings.keywordBolding) {
          applyPhraseBolding(data.bold_targets)
        } else {
          removePhraseBolding()
        }

        if (settings.wordSimplification) {
          applyWordUnderlines(data.complex_words)
        } else {
          removeWordUnderlines()
        }

        if (settings.sentenceSplitting) {
          applySentenceSplit(data.sentences)
        } else {
          removeSentenceSplit()
        }
      })
      .catch((err) => console.warn('[PageAnalysis] fetch failed:', err))

  }, [
    settings.keywordBolding,
    settings.wordSimplification,
    settings.sentenceSplitting,
    settings.posEnabled.verbs,
    settings.posEnabled.nouns,
    settings.posEnabled.adjectives,
  ])
}