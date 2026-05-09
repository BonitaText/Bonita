import { useEffect } from 'react'
import { useSettings } from './useSettings'
import { applyPhraseBolding, removePhraseBolding } from '../utils/phraseBolder'

export function usePhraseBolder() {
  const { settings } = useSettings()

  useEffect(() => {
    if (settings.keywordBolding) {
      applyPhraseBolding()
    } else {
      removePhraseBolding()
    }
  }, [
    settings.keywordBolding,
    settings.sentenceSplitting,
    settings.wordSimplification,
    settings.posEnabled.verbs,
    settings.posEnabled.nouns,
    settings.posEnabled.adjectives,
  ])
}
