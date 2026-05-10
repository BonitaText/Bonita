import { Volume2 } from 'lucide-react'
import { useEffect } from 'react'
import IconToggle from './IconToggle'
import { useSettings } from '../hooks/useSettings'

const getReadableText = () => {
  const source = document.querySelector('article, main, [role="main"]') ?? document.body
  return (source.textContent ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1800)
}

export default function TTSReader() {
  const { settings, updateSetting } = useSettings()

  useEffect(() => {
    if (!settings.tts) {
      window.speechSynthesis?.cancel()
      return
    }

    const text = getReadableText()
    if (!text) return

    const utterance = new SpeechSynthesisUtterance(text)
    utterance.rate = 0.92
    utterance.pitch = 1
    utterance.onend = () => updateSetting('tts', false)
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(utterance)

    return () => window.speechSynthesis.cancel()
  }, [settings.tts])

  return (
    <IconToggle
      label={settings.tts ? 'Stop Speech' : 'Text to Speech'}
      icon={Volume2}
      enabled={settings.tts}
      onChange={(v) => updateSetting('tts', v)}
    />
  )
}
