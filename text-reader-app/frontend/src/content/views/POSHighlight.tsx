import { Palette } from 'lucide-react'
import IconToggle from './IconToggle'
import { useSettings } from '../hooks/useSettings'

export default function POSHighlight() {
  const { settings, updateSetting } = useSettings()

  return (
    <IconToggle
      label="POS Highlighting"
      icon={Palette}
      enabled={settings.posHighlighting}
      onChange={(v) => updateSetting('posHighlighting', v)}
    />
  )
}
