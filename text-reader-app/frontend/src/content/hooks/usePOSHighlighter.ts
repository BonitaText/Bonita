import { useEffect } from 'react'
import { useSettings } from './useSettings'
import { applyPOSHighlight, removePOSHighlight } from '../utils/posHighlighter'

export function usePOSHighlighter() {
  const { settings } = useSettings()

  // FIX: Extract primitive values from the posEnabled/posColors objects.
  // Depending on the objects directly means a new reference every render
  // (because useSettings returns a new object each time) which causes an
  // infinite re-apply loop: apply → DOM change → re-render → apply → ...
  const verbOn  = settings.posEnabled.verbs
  const nounOn  = settings.posEnabled.nouns
  const adjOn   = settings.posEnabled.adjectives
  const verbColor = settings.posColors.verbs
  const nounColor = settings.posColors.nouns
  const adjColor  = settings.posColors.adjectives

  useEffect(() => {
    if (verbOn || nounOn || adjOn) {
      applyPOSHighlight(
        { verbs: verbColor, nouns: nounColor, adjectives: adjColor },
        { verbs: verbOn,    nouns: nounOn,    adjectives: adjOn    },
      )
    } else {
      removePOSHighlight()
    }
  }, [verbOn, nounOn, adjOn, verbColor, nounColor, adjColor])
}