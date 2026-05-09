import {
  BookOpen,
  Brain,
  Check,
  ChevronDown,
  Highlighter,
  List,
  MessageSquareText,
  Palette,
  ScanLine,
  Sparkles,
  Type,
  Volume2,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { BonitaSettings, defaultSettings, getSettings, saveSettings } from '@/shared/settings'
import './App.css'

type ToggleKey = keyof Pick<
  BonitaSettings,
  | 'sentenceSplitting'
  | 'keywordBolding'
  | 'wordSimplification'
  | 'lineFocus'
  | 'tts'
> | 'posEnabled'

const tools: Array<{
  key: ToggleKey
  icon: typeof List
  title: string
  description: string
  category: string
}> = [
  {
    key: 'sentenceSplitting',
    icon: List,
    title: 'Sentence chunking',
    description: 'Break walls of text into line-by-line reading chunks.',
    category: 'Structure',
  },
  {
    key: 'keywordBolding',
    icon: Highlighter,
    title: 'Key phrase guidance',
    description: 'Bold early anchor words so scanning has a visible path.',
    category: 'Skim',
  },
  {
    key: 'wordSimplification',
    icon: BookOpen,
    title: 'Simple word hints',
    description: 'Show simpler alternatives for common dense words on hover.',
    category: 'Language',
  },
  {
    key: 'posEnabled',
    icon: Palette,
    title: 'Grammar color cues',
    description: 'Lightly mark nouns, verbs, and adjectives for pattern recognition.',
    category: 'Visual',
  },
  {
    key: 'lineFocus',
    icon: ScanLine,
    title: 'Line focus',
    description: 'Add a soft cursor-following focus band for sustained attention.',
    category: 'Focus',
  },
  {
    key: 'tts',
    icon: Volume2,
    title: 'Text to speech',
    description: 'Read the current page aloud using the browser speech engine.',
    category: 'Audio',
  },
]

const fonts: Array<{ value: BonitaSettings['font']; label: string }> = [
  { value: 'default', label: 'Default' },
  { value: 'opendyslexic', label: 'OpenDyslexic' },
  { value: 'arial', label: 'Arial' },
  { value: 'verdana', label: 'Verdana' },
]

const notes = [
  'Use rule-based tools first so pages stay fast and cheap.',
  'Keep the original page intact; Bonita changes only what is rendered.',
  'Let users combine supports instead of forcing one reading mode.',
]

function App() {
  const [settings, setSettings] = useState<BonitaSettings>(defaultSettings)
  const [suggestionsOpen, setSuggestionsOpen] = useState(false)
  const [suggestion, setSuggestion] = useState('')

  useEffect(() => {
    getSettings().then(setSettings)
  }, [])

  const activeCount = useMemo(
    () => tools.filter((tool) => (tool.key === 'posEnabled' ? Object.values(settings.posEnabled).some(Boolean) : settings[tool.key])).length,
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

  const applyPreset = () => {
    const next: BonitaSettings = {
      ...settings,
      enabled: true,
      sentenceSplitting: true,
      keywordBolding: true,
      wordSimplification: true,
      lineFocus: true,
    }
    setSettings(next)
    void saveSettings(next)
  }

  return (
    <div className="bonita-page">
      <aside className="sidebar">
        <div className="brand">
          <span>
            <Sparkles size={22} />
          </span>
          <div>
            <strong>Bonita</strong>
            <small>AccessTech reader</small>
          </div>
        </div>

        <nav aria-label="Bonita sections">
          <a href="#tools">Tools</a>
          <a href="#preview">Preview</a>
          <a href="#feedback">Feedback</a>
        </nav>

        <div className="meter">
          <span>Active tools</span>
          <strong>{activeCount}/{tools.length}</strong>
        </div>
      </aside>

      <main className="page-main">
        <section className="hero" id="top">
          <div className="hero-copy">
            <span className="eyebrow">Browser overlay for cognitive accessibility</span>
            <h1>A calmer way to read dense webpages.</h1>
            <p>
              Bonita keeps the original page available while adding structure,
              visual hierarchy, font control, line focus, and audio support for
              ADHD, dyslexia, and autistic reading preferences.
            </p>
            <div className="hero-actions">
              <button type="button" onClick={applyPreset}>
                <Brain size={18} />
                Apply calm preset
              </button>
              <a href="#tools">Tune tools</a>
            </div>
          </div>

          <div className="preview-card" aria-label="Bonita page preview">
            <div className="window-bar">
              <span />
              <span />
              <span />
            </div>
            <div className="preview-lines">
              <b />
              <i />
              <i />
              <b />
              <i />
            </div>
            <div className="floating-tool">
              <Highlighter size={17} />
              <span>skim cues on</span>
            </div>
          </div>
        </section>

        <section className="tool-section" id="tools">
          <div className="section-heading">
            <span className="eyebrow">Choose what helps</span>
            <h2>Reading tools</h2>
          </div>

          <div className="tool-grid">
            {tools.map((tool) => {
              const Icon = tool.icon
              return (
                <label className={`tool-card ${(tool.key === 'posEnabled' ? Object.values(settings.posEnabled).some(Boolean) : settings[tool.key]) ? 'active' : ''}`} key={tool.key}>
                  <span className="tool-icon">
                    <Icon size={22} />
                  </span>
                  <span className="tool-content">
                    <small>{tool.category}</small>
                    <strong>{tool.title}</strong>
                    <em>{tool.description}</em>
                  </span>
                  <input
                    type="checkbox"
                    checked={(tool.key === 'posEnabled' ? Object.values(settings.posEnabled).some(Boolean) : settings[tool.key])}
                    onChange={(event) => tool.key === 'posEnabled'
                      ? updateSetting('posEnabled', { verbs: event.currentTarget.checked, nouns: event.currentTarget.checked, adjectives: event.currentTarget.checked })
                      : updateSetting(tool.key, event.currentTarget.checked)}
                  />
                </label>
              )
            })}
          </div>
        </section>

        <section className="preview-section" id="preview">
          <div>
            <span className="eyebrow">Page output</span>
            <h2>The webpage stays mostly blank until text is processed.</h2>
            <p>
              Current frontend tools run locally in the content script. True LLM
              restructuring can plug into the same settings later without changing
              the user-facing controls.
            </p>
            <div className="font-panel">
              <Type size={18} />
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
          </div>

          <div className="notes-panel">
            {notes.map((note) => (
              <div key={note}>
                <Check size={17} />
                <span>{note}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="feedback" id="feedback">
          <button
            className="feedback-trigger"
            type="button"
            onClick={() => setSuggestionsOpen(!suggestionsOpen)}
          >
            <MessageSquareText size={19} />
            Suggest a feature
            <ChevronDown className={suggestionsOpen ? 'open' : ''} size={18} />
          </button>
          {suggestionsOpen && (
            <div className="feedback-body">
              <textarea
                maxLength={320}
                value={suggestion}
                onChange={(event) => setSuggestion(event.currentTarget.value)}
                placeholder="Example: I want a preset for research papers that shows the conclusion first."
              />
              <span>{suggestion.length}/320</span>
            </div>
          )}
        </section>
      </main>
    </div>
  )
}

export default App
