import { List } from 'lucide-react'
import IconToggle from './IconToggle'
import { useSettings } from '../hooks/useSettings'

export default function SentenceSplitting() {
  const { settings, updateSetting } = useSettings()

  return (
    <IconToggle
      label="Sentence Splitting"
      icon={List}
      enabled={settings.sentenceSplitting}
      onChange={(v) => updateSetting('sentenceSplitting', v)}
    />
  )
}
