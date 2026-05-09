import { BookOpen } from 'lucide-react'
import IconToggle from './IconToggle'
import { useSettings } from '../hooks/useSettings'

export default function WordSimplify() {
  const { settings, updateSetting } = useSettings()

  return (
    <IconToggle
      label="Word Simplification"
      icon={BookOpen}
      enabled={settings.wordSimplification}
      onChange={(v) => updateSetting('wordSimplification', v)}
    />
  )
}
