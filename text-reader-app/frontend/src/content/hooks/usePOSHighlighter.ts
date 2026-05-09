import { useEffect } from 'react'
import { useSettings } from './useSettings'
import { applyPOSHighlight, removePOSHighlight } from '../utils/posHighlighter'

export function usePOSHighlighter() {
  const { settings } = useSettings()

  useEffect(() => {
    const { verbs, nouns, adjectives } = settings.posEnabled
    if (verbs || nouns || adjectives) {
      applyPOSHighlight(settings.posColors, settings.posEnabled)
    } else {
      removePOSHighlight()
    }
  }, [
    settings.posEnabled.verbs,
    settings.posEnabled.nouns,
    settings.posEnabled.adjectives,
    settings.posColors,
  ])
}
