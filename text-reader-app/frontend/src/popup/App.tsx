import {
  BookOpen,
  Brain,
  Check,
  FileText,
  Highlighter,
  List,
  Palette,
  ScanLine,
  Sparkles,
  Type,
  Volume2,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { BonitaSettings, defaultSettings, getSettings, saveSettings } from '@/shared/settings'

type ToggleKey = keyof Pick<
  BonitaSettings,
  | 'sentenceSplitting'
  | 'keywordBolding'
  | 'wordSimplification'
  | 'lineFocus'
  | 'tts'
> | 'posEnabled'

const featureToggles: Array<{
  key: ToggleKey
  icon: typeof List
  title: string
  detail: string
}> = [
  {
    key: 'sentenceSplitting',
    icon: List,
    title: 'Chunk text',
    detail: 'Break long blocks into sentence-sized lines.',
  },
  {
    key: 'keywordBolding',
    icon: Highlighter,
    title: 'Guide skimming',
    detail: 'Bold early key words for easier scanning.',
  },
  {
    key: 'wordSimplification',
    icon: BookOpen,
    title: 'Word help',
    detail: 'Underline complex words with simpler hover hints.',
  },
  {
    key: 'posEnabled',
    icon: Palette,
    title: 'Grammar color',
    detail: 'Add lightweight noun, verb, and adjective cues.',
  },
  {
    key: 'lineFocus',
    icon: ScanLine,
    title: 'Line focus',
    detail: 'Follow the cursor with a calm focus band.',
  },
  {
    key: 'tts',
    icon: Volume2,
    title: 'Read aloud',
    detail: 'Use browser text-to-speech for the page.',
  },
]

const fonts: Array<{ value: BonitaSettings['font']; label: string }> = [
  { value: 'default', label: 'Default' },
  { value: 'opendyslexic', label: 'OpenDyslexic' },
  { value: 'arial', label: 'Arial' },
  { value: 'verdana', label: 'Verdana' },
]

function App() {
  const [settings, setSettings] = useState<BonitaSettings>(defaultSettings)

  useEffect(() => {
    getSettings().then(setSettings)
  }, [])

  const activeCount = useMemo(
    () => featureToggles.filter((feature) => (feature.key === 'posEnabled' ? Object.values(settings.posEnabled).some(Boolean) : settings[feature.key])).length,
    [settings],
  )

  const updateSetting = <K extends keyof BonitaSettings>(
    key: K,
    value: BonitaSettings[K],
  ) => {
    const next = { ...settings, [key]: value }
    setSettings(next)
    void saveSettings(next)
  }

  const enableReadingPreset = () => {
    const next: BonitaSettings = {
      ...settings,
      sentenceSplitting: true,
      keywordBolding: true,
      wordSimplification: true,
      lineFocus: true,
    }
    setSettings(next)
    void saveSettings(next)
  }

  return (
    <main className="popup-shell">
      <section className="popup-hero">
        <div className="brand-mark">
          <Sparkles size={21} strokeWidth={2} />
        </div>
        <div>
          <p>Bonita</p>
          <span>Readable web overlay</span>
        </div>
      </section>

      <section className="popup-summary">
        <div>
          <span>Current page</span>
          <strong>{activeCount} tools active</strong>
        </div>
        <button
          className={settings.enabled ? 'is-on' : ''}
          type="button"
          onClick={() => updateSetting('enabled', !settings.enabled)}
        >
          {settings.enabled ? <Check size={16} /> : <Brain size={16} />}
          {settings.enabled ? 'Ready' : 'Preview'}
        </button>
      </section>

      <button className="preset-button" type="button" onClick={enableReadingPreset}>
        <FileText size={18} />
        <span>
          <strong>Apply calm reading preset</strong>
          <small>Chunk text, bold cues, word help, and line focus</small>
        </span>
      </button>

      <section className="popup-grid" aria-label="Bonita feature toggles">
        {featureToggles.map((feature) => {
          const Icon = feature.icon
          return (
            <label className={`feature-card ${(feature.key === 'posEnabled' ? Object.values(settings.posEnabled).some(Boolean) : settings[feature.key]) ? 'active' : ''}`} key={feature.key}>
              <span className="feature-icon">
                <Icon size={18} strokeWidth={2} />
              </span>
              <span>
                <strong>{feature.title}</strong>
                <small>{feature.detail}</small>
              </span>
              <input
                type="checkbox"
                checked={(feature.key === 'posEnabled' ? Object.values(settings.posEnabled).some(Boolean) : settings[feature.key])}
                onChange={(event) => feature.key === 'posEnabled'
                    ? updateSetting('posEnabled', { verbs: event.currentTarget.checked, nouns: event.currentTarget.checked, adjectives: event.currentTarget.checked })
                    : updateSetting(feature.key, event.currentTarget.checked)}
              />
            </label>
          )
        })}
      </section>

      <section className="font-strip" aria-label="Font options">
        <div>
          <Type size={17} />
          <span>Font</span>
        </div>
        <div className="font-options">
          {fonts.map((font) => (
            <button
              className={settings.font === font.value ? 'selected' : ''}
              key={font.value}
              type="button"
              onClick={() => updateSetting('font', font.value)}
            >
              {font.label}
            </button>
          ))}
        </div>
      </section>
    </main>
  )
}

export default App
