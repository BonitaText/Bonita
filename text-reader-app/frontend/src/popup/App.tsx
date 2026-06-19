/**
 * @file popup/App.tsx
 *
 * Extension popup UI.
 *
 * Controls which tool icons appear in the on-page toolbar dock (rendered by
 * the content script's {@link views/App.tsx}) via
 * {@link BonitaSettings.enabledTools}, plus the active reading font.
 *
 * ## Visibility vs. active state
 * Each feature card here toggles whether a tool's icon is **shown in the
 * dock at all** — it does not turn the tool on or off while active on a
 * page. That distinction matters because:
 * - `enabledTools[id]` (this file) — controls dock icon visibility.
 * - `settings[id]` (e.g. `sentenceSplitting`, `lineFocus`) — controls
 *   whether a *visible* tool is currently applying its effect on the page,
 *   managed by the toolbar dock itself.
 *
 * Unchecking a card here hides its icon from the dock entirely; it does not
 * merely grey it out, so a hidden tool cannot be activated until its card is
 * re-checked.
 */
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
import {
  BonitaSettings,
  defaultSettings,
  getSettings,
  saveSettings,
  ToolId,
} from '@/shared/settings'

/**
 * Describes one feature card in the popup grid.
 *
 * `key` is a {@link ToolId} — it indexes directly into
 * `settings.enabledTools`, so adding a new toggleable tool only requires
 * adding a new entry here plus a matching {@link ToolId} union member.
 */
const featureToggles: Array<{
  key: ToolId
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
    key: 'pos',
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

/**
 * Root popup component.
 *
 * Loads {@link BonitaSettings} on mount, then lets the user toggle dock-icon
 * visibility per tool, apply a one-click "calm reading" preset, and pick the
 * active reading font.
 */
function App() {
  const [settings, setSettings] = useState<BonitaSettings>(defaultSettings)

  useEffect(() => {
    getSettings().then(setSettings)
  }, [])

  /**
   * Count of tools currently visible in the toolbar dock, shown in the
   * summary header as "N tools active".
   */
  const activeCount = useMemo(
    () => featureToggles.filter((feature) => settings.enabledTools[feature.key]).length,
    [settings],
  )

  /**
   * Updates a single top-level {@link BonitaSettings} key, optimistically
   * applying it to local state and persisting it via {@link saveSettings}.
   *
   * @param key   - The settings key to update.
   * @param value - The new value for that key.
   */
  const updateSetting = <K extends keyof BonitaSettings>(
    key: K,
    value: BonitaSettings[K],
  ) => {
    const next = { ...settings, [key]: value }
    setSettings(next)
    void saveSettings(next)
  }

  /**
   * Toggles a single tool's dock-icon visibility on or off.
   *
   * @param id      - The {@link ToolId} to toggle.
   * @param visible - `true` to show the tool's icon in the dock, `false`
   *   to hide it entirely.
   */
  const setToolVisible = (id: ToolId, visible: boolean): void => {
    updateSetting('enabledTools', { ...settings.enabledTools, [id]: visible })
  }

  /**
   * Shows every tool in the dock at once — the "calm reading" preset.
   *
   * This only affects dock *visibility*; it does not change whether any
   * individual tool is currently active on the page.
   */
  const enableReadingPreset = (): void => {
    updateSetting('enabledTools', {
      sentenceSplitting: true,
      keywordBolding: true,
      wordSimplification: true,
      pos: true,
      lineFocus: true,
      tts: true,
    })
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
          <small>Show every tool in the toolbar</small>
        </span>
      </button>

      <section className="popup-grid" aria-label="Bonita feature toggles">
        {featureToggles.map((feature) => {
          const Icon = feature.icon
          const visible = settings.enabledTools[feature.key]
          return (
            <label className={`feature-card ${visible ? 'active' : ''}`} key={feature.key}>
              <span className="feature-icon">
                <Icon size={18} strokeWidth={2} />
              </span>
              <span>
                <strong>{feature.title}</strong>
                <small>{feature.detail}</small>
              </span>
              <input
                type="checkbox"
                checked={visible}
                onChange={(event) => setToolVisible(feature.key, event.currentTarget.checked)}
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