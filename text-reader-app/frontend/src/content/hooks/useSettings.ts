import { useEffect, useState } from 'react'
import {
  BonitaSettings,
  defaultSettings,
  getSettings,
  onSettingsChanged,
  saveSettings,
} from '../../shared/settings'

export function useSettings() {
  const [settings, setSettings] = useState<BonitaSettings>(defaultSettings)

  useEffect(() => {
    getSettings().then(setSettings)
    return onSettingsChanged(setSettings)
  }, [])

  const updateSetting = <K extends keyof BonitaSettings>(
    key: K,
    value: BonitaSettings[K]
  ) => {
    const next = { ...settings, [key]: value }
    setSettings(next)
    void saveSettings(next)
  }

  return { settings, updateSetting }
}