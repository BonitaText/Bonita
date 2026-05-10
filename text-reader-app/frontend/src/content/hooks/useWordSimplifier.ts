import { useEffect } from 'react'
import { useSettings } from './useSettings'
import { applyWordSimplification, removeWordSimplification } from '../utils/wordSimplifier'

export function useWordSimplifier() {
  const { settings } = useSettings()

  useEffect(() => {
    if (settings.wordSimplification) {
      applyWordSimplification()
    } else {
      removeWordSimplification()
    }
  }, [settings.wordSimplification])
}
