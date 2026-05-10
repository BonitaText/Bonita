import { useEffect } from 'react'
import { useSettings } from './useSettings'
import { applyPhraseBolding, removePhraseBolding } from '../utils/phraseBolder'

const BACKEND_URL = 'http://localhost:8000'
const MIN_PARAGRAPH_WORDS = 18

export function usePhraseBolder() {
  const { settings } = useSettings()

  useEffect(() => {
    if (!settings.keywordBolding) {
      removePhraseBolding()
      return
    }

    // Extract paragraphs from DOM — same text nodes phraseBolder will walk
    const paragraphs = Array.from(document.querySelectorAll('p, li, blockquote'))
      .map((el) => el.textContent?.trim() ?? '')
      .filter((text) => text.split(/\s+/).length >= MIN_PARAGRAPH_WORDS)

    if (paragraphs.length === 0) return

    fetch(`${BACKEND_URL}/process/webpage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paragraphs, max_terms: 3 }),
    })
      .then((res) => {
        if (!res.ok) throw new Error(`Backend error: ${res.status}`)
        return res.json()
      })
      .then((data) => {
        console.log('[PhraseBolder] response:', data)
        console.log('[PhraseBolder] paragraphs sent:', paragraphs.length)
        console.log('[PhraseBolder] targets received:', data.bold_targets)
        applyPhraseBolding(paragraphs, data.bold_targets)
      })
      .catch((err) => console.warn('[PhraseBolder] fetch failed:', err))

  }, [
    settings.keywordBolding,
    settings.sentenceSplitting,
    settings.wordSimplification,
    settings.posEnabled.verbs,
    settings.posEnabled.nouns,
    settings.posEnabled.adjectives,
  ])
}