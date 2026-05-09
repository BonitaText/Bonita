export interface BonitaSettings {
  enabled: boolean
  font: 'default' | 'opendyslexic' | 'arial' | 'verdana'
  sentenceSplitting: boolean
  bulletPoints: boolean
  keywordBolding: boolean
  posHighlighting: boolean
  posColors: {
    verbs: string
    nouns: string
    adjectives: string
  }
  lineFocus: boolean
  wordSimplification: boolean
  tts: boolean
  imageHandling: 'keep' | 'strip' | 'bottom'
}

export const defaultSettings: BonitaSettings = {
  enabled: false,
  font: 'default',
  sentenceSplitting: true,
  bulletPoints: true,
  keywordBolding: true,
  posHighlighting: false,
  posColors: {
    verbs: '#4A90D9',
    nouns: '#27AE60',
    adjectives: '#E67E22',
  },
  lineFocus: false,
  wordSimplification: true,
  tts: false,
  imageHandling: 'keep',
}

// helpers so every piece of the extension reads/writes the same way
export const getSettings = (): Promise<BonitaSettings> =>
  chrome.storage.sync.get('bonitaSettings').then(
    (res) => res.bonitaSettings ?? defaultSettings
  )

export const saveSettings = (settings: BonitaSettings): Promise<void> =>
  chrome.storage.sync.set({ bonitaSettings: settings })