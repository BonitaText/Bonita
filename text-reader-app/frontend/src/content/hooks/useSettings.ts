import { useEffect, useState } from 'react'
import { BonitaSettings, defaultSettings, getSettings, saveSettings } from '../../shared/settings'

export function useSettings() {
  const [settings, setSettings] = useState<BonitaSettings>(defaultSettings)

  useEffect(() => {
    getSettings().then(setSettings)

    const handler = (changes: { [key: string]: chrome.storage.StorageChange }) => {
      if (changes.bonitaSettings) {
        setSettings(changes.bonitaSettings.newValue as BonitaSettings)
      }
    }
    chrome.storage.onChanged.addListener(handler)
    return () => chrome.storage.onChanged.removeListener(handler)
  }, [])

  const updateSetting = <K extends keyof BonitaSettings>(
    key: K,
    value: BonitaSettings[K]
  ) => {
    const next = { ...settings, [key]: value }
    setSettings(next)
    saveSettings(next)
  }

  return { settings, updateSetting }
}
