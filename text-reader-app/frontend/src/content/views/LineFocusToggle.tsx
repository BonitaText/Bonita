import { ScanLine } from 'lucide-react'
import IconToggle from './IconToggle'
import { useSettings } from '../hooks/useSettings'

export default function LineFocusToggle() {
  const { settings, updateSetting } = useSettings()

  return (
    <IconToggle
      label="Line Focus"
      icon={ScanLine}
      enabled={settings.lineFocus}
      onChange={(v) => updateSetting('lineFocus', v)}
    />
  )
}
