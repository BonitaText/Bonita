import { useEffect, useMemo, useState } from 'react'
import { BonitaSettings, defaultSettings, getSettings, saveSettings } from '@/shared/settings'
import './App.css'

type ToolKey = keyof Pick<
  BonitaSettings,
  | 'keywordBolding'
  | 'sentenceSplitting'
  | 'bulletPoints'
  | 'posHighlighting'
  | 'lineFocus'
  | 'wordSimplification'
  | 'tts'
>

const tools: Array<{
  key: ToolKey
  title: string
  description: string
  tag: string
}> = [
  {
    key: 'keywordBolding',
    title: 'Text highlight',
    description: 'Bold key phrases so skim paths are easier to follow.',
    tag: 'Visual',
  },
  {
    key: 'sentenceSplitting',
    title: 'Sentence splitter',
    description: 'Break long paragraphs into smaller reading chunks.',
    tag: 'Structure',
  },
  {
    key: 'bulletPoints',
    title: 'Bullet restructure',
    description: 'Turn dense blocks into scannable points when possible.',
    tag: 'Structure',
  },
  {
    key: 'posHighlighting',
    title: 'Part-of-speech color',
    description: 'Reserve color cues for nouns, verbs, and adjectives.',
    tag: 'Novelty',
  },
  {
    key: 'lineFocus',
    title: 'Line focus',
    description: 'Guide attention one line at a time without harsh contrast.',
    tag: 'Focus',
  },
  {
    key: 'wordSimplification',
    title: 'Word simplifier',
    description: 'Offer clearer wording and synonym support for complex terms.',
    tag: 'Language',
  },
  {
    key: 'tts',
    title: 'Text to speech',
    description: 'Prepare spoken playback controls for users who read by ear.',
    tag: 'Audio',
  },
]

const cogaCards = [
  {
    title: 'Reduce overload',
    body: 'W3C COGA recommends simplified views with less text, fewer nonessential features, and clear access back to the full version.',
  },
  {
    title: 'Support preferred formats',
    body: 'Users may need control over font style, line height, margins, contrast, symbols, and layout familiarity.',
  },
  {
    title: 'Let assistive tools work',
    body: 'The guidance names extensions, text-to-speech with highlighting, content simplification, extra white space, and pictures as useful supports.',
  },
]

export default function App() {
  const [settings, setSettings] = useState<BonitaSettings>(defaultSettings)
  const [suggestionOpen, setSuggestionOpen] = useState(false)
  const [suggestion, setSuggestion] = useState('')

  useEffect(() => {
    getSettings().then(setSettings)
  }, [])

  const enabledCount = useMemo(
    () => tools.filter((tool) => settings[tool.key]).length,
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

  return (
    <div className="bonita-shell">
      <aside className="tool-sidebar" aria-label="Bonita tools">
        <div className="brand-block">
          <img src="/public/logo.png" alt="Bonita" />
          <div>
            <p>Bonita</p>
            <span>AccessTech reader</span>
          </div>
        </div>

        <div className="status-card">
          <div>
            <span className="eyebrow">Tools active</span>
            <strong>{enabledCount}/{tools.length}</strong>
          </div>
          <button
            className={`master-toggle ${settings.enabled ? 'on' : ''}`}
            type="button"
            onClick={() => updateSetting('enabled', !settings.enabled)}
            aria-pressed={settings.enabled}
          >
            {settings.enabled ? 'On' : 'Off'}
          </button>
        </div>

        <div className="tool-list">
          {tools.map((tool) => (
            <label className="tool-row" key={tool.key}>
              <span>
                <small>{tool.tag}</small>
                <strong>{tool.title}</strong>
                <em>{tool.description}</em>
              </span>
              <input
                type="checkbox"
                checked={settings[tool.key]}
                onChange={(event) => updateSetting(tool.key, event.currentTarget.checked)}
              />
            </label>
          ))}
        </div>

        <section className={`suggestion-box ${suggestionOpen ? 'open' : ''}`}>
          <button type="button" onClick={() => setSuggestionOpen(!suggestionOpen)}>
            <span>Suggestion box</span>
            <strong>{suggestionOpen ? 'Close' : 'Open'}</strong>
          </button>
          {suggestionOpen && (
            <div className="suggestion-body">
              <textarea
                value={suggestion}
                maxLength={280}
                onChange={(event) => setSuggestion(event.currentTarget.value)}
                placeholder="Tell us what feature would make reading easier..."
              />
              <span>{suggestion.length}/280</span>
            </div>
          )}
        </section>
      </aside>

      <main className="workspace">
        <section className="hero">
          <div className="hero-copy">
            <span className="eyebrow">Cognitive accessibility dashboard</span>
            <h1>Turn dense web text into a calmer reading surface.</h1>
            <p>
              Bonita is being shaped as a browser extension for ADHD, dyslexia,
              and autistic reading needs. This page is the front-end control
              room while processing features are still being connected.
            </p>
            <div className="hero-actions">
              <button type="button" onClick={() => updateSetting('enabled', true)}>
                Enable preview
              </button>
              <a href="https://www.w3.org/TR/coga-usable/" target="_blank" rel="noreferrer">
                W3C COGA notes
              </a>
            </div>
          </div>

          <div className="reader-visual" aria-label="Reading preview illustration">
            <div className="floating-badge">Live page overlay</div>
            <div className="mock-window">
              <span />
              <span />
              <span />
            </div>
            <div className="mock-lines">
              <b />
              <i />
              <i />
              <b />
              <i />
            </div>
            <div className="focus-line" />
          </div>
        </section>

        <section className="content-grid" aria-label="Research-backed design notes">
          {cogaCards.map((card) => (
            <article className="coga-card" key={card.title}>
              <span />
              <h2>{card.title}</h2>
              <p>{card.body}</p>
            </article>
          ))}
        </section>

        <section className="blank-canvas">
          <div>
            <span className="eyebrow">Processing area</span>
            <h2>Page content will appear here later.</h2>
            <p>
              For now, this surface intentionally stays light. The sidebar models the
              controls; future work can pipe extracted webpage, PDF, or document text
              into this reading canvas.
            </p>
          </div>
          <div className="readability-panel">
            <span>Readability gate</span>
            <strong>NLP first</strong>
            <p>Use local formatting tools before calling an LLM for dense text.</p>
          </div>
        </section>
      </main>
    </div>
  )
}
