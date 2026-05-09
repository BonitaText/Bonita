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

const storageKey = 'bonitaSettings'

const hasChromeStorage = () =>
  typeof chrome !== 'undefined' && Boolean(chrome.storage?.sync)

const mergeSettings = (settings: unknown): BonitaSettings => {
  if (!settings || typeof settings !== 'object') {
    return defaultSettings
  }

  return { ...defaultSettings, ...(settings as Partial<BonitaSettings>) }
}

// helpers so every piece of the extension reads/writes the same way.
// The localStorage fallback keeps Vite preview usable outside Chrome.
export const getSettings = async (): Promise<BonitaSettings> => {
  if (hasChromeStorage()) {
    const res = await chrome.storage.sync.get(storageKey)
    return mergeSettings(res[storageKey])
  }

  const cached = localStorage.getItem(storageKey)
  return cached ? mergeSettings(JSON.parse(cached)) : defaultSettings
}

export const saveSettings = async (settings: BonitaSettings): Promise<void> => {
  if (hasChromeStorage()) {
    await chrome.storage.sync.set({ [storageKey]: settings })
    return
  }

  localStorage.setItem(storageKey, JSON.stringify(settings))
}
