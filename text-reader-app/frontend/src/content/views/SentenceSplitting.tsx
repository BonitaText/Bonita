import { List } from 'lucide-react'
import IconToggle from './IconToggle'
import { useSettings } from '../hooks/useSettings'

/**
 * SentenceSplitting
 *
 * Thin wrapper that wires the `sentenceSplitting` setting up to an
 * {@link IconToggle}. Holds no state of its own — reads the current value
 * from `useSettings` and writes the negated value back on toggle.
 */
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