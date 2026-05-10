import { Bold } from 'lucide-react'
import IconToggle from './IconToggle'
import { useSettings } from '../hooks/useSettings'

export default function PhraseBolding() {
  const { settings, updateSetting } = useSettings()

  return (
    <IconToggle
      label="Phrase Bolding"
      icon={Bold}
      enabled={settings.keywordBolding}
      onChange={(v) => updateSetting('keywordBolding', v)}
    />
  )
}
