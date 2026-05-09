import { useEffect, useState } from 'react'
import { BonitaSettings, defaultSettings, getSettings, saveSettings } from '@/shared/settings'

const quickKeys: Array<keyof Pick<
  BonitaSettings,
  'keywordBolding' | 'lineFocus' | 'wordSimplification' | 'tts'
>> = ['keywordBolding', 'lineFocus', 'wordSimplification', 'tts']

const quickLabels: Record<(typeof quickKeys)[number], string> = {
  keywordBolding: 'Highlight',
  lineFocus: 'Line focus',
  wordSimplification: 'Simplify',
  tts: 'TTS',
}

const dashboardUrl = () => {
  if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
    return chrome.runtime.getURL('src/sidepanel/index.html')
  }

  return '/src/sidepanel/index.html'
}

function App() {
  const [settings, setSettings] = useState<BonitaSettings>(defaultSettings)

  useEffect(() => {
    getSettings().then(setSettings)
  }, [])

  const updateSetting = <K extends keyof BonitaSettings>(
    key: K,
    value: BonitaSettings[K],
  ) => {
    const next = { ...settings, [key]: value }
    setSettings(next)
    void saveSettings(next)
  }

  return (
    <div className="popup-shell">
      <div className="popup-top">
        <div className="popup-logo" tabIndex={0}>
          <img src="/public/logo.png" alt="Bonita" />
          <div className="hover-card">
            <strong>Quick toggles</strong>
            <p>Choose the tools you want before opening the full page.</p>
            <div className="mini-toggles">
              {quickKeys.map((key) => (
                <label key={key}>
                  <span>{quickLabels[key]}</span>
                  <input
                    type="checkbox"
                    checked={settings[key]}
                    onChange={(event) => updateSetting(key, event.currentTarget.checked)}
                  />
                </label>
              ))}
            </div>
          </div>
        </div>
        <div>
          <p>Bonita</p>
          <span>Readable web tools</span>
        </div>
      </div>

      <h1>Structure the page before you read.</h1>
      <p className="popup-copy">
        Fast controls for highlighting, focus support, simplification, and speech.
      </p>

      <div className="quick-grid">
        {quickKeys.map((key) => (
          <label className="quick-tile" key={key}>
            <span>{quickLabels[key]}</span>
            <input
              type="checkbox"
              checked={settings[key]}
              onChange={(event) => updateSetting(key, event.currentTarget.checked)}
            />
          </label>
        ))}
      </div>

      <a className="dashboard-link" href={dashboardUrl()} target="_blank" rel="noreferrer">
        Open Bonita page
      </a>
    </div>
  )
}

export default App
