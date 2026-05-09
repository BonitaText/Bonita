import { useEffect } from 'react'
import { useSettings } from './useSettings'
import { applySentenceSplit, removeSentenceSplit } from '../utils/sentenceSplitter'

export function useSentenceSplitter() {
  const { settings } = useSettings()

  useEffect(() => {
    if (settings.sentenceSplitting) {
      applySentenceSplit()
    } else {
      removeSentenceSplit()
    }
  }, [settings.sentenceSplitting])
}
