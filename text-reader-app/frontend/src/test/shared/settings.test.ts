import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  getSettings,
  saveSettings,
  onSettingsChanged,
  defaultSettings,
  type BonitaSettings,
} from '../../shared/settings'

const STORAGE_KEY = 'bonitaSettings'

describe('shared/settings — browser (localStorage) context', () => {
  beforeEach(() => {
    vi.unstubAllGlobals() // ensure no `chrome` global leaks in from another test
    localStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('getSettings', () => {
    it('returns defaultSettings when nothing is stored', async () => {
      expect(await getSettings()).toEqual(defaultSettings)
    })

    it('merges a partial stored object with defaultSettings', async () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ font: 'arial' }))
      const settings = await getSettings()

      expect(settings.font).toBe('arial')
      expect(settings.enabledTools).toEqual(defaultSettings.enabledTools)
      expect(settings.tts).toBe(defaultSettings.tts)
    })

    it('deep-merges enabledTools so unspecified tool flags fall back to default', async () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ enabledTools: { pos: false } }))
      const settings = await getSettings()

      expect(settings.enabledTools.pos).toBe(false)
      expect(settings.enabledTools.tts).toBe(true)
      expect(settings.enabledTools.sentenceSplitting).toBe(true)
    })

    it('deep-merges posEnabled and posColors independently of each other', async () => {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          posEnabled: { verbs: true },
          posColors: { nouns: '#ff0000' },
        }),
      )
      const settings = await getSettings()

      expect(settings.posEnabled).toEqual({ verbs: true, nouns: false, adjectives: false })
      expect(settings.posColors).toEqual({
        verbs: defaultSettings.posColors.verbs,
        nouns: '#ff0000',
        adjectives: defaultSettings.posColors.adjectives,
      })
    })

    it('falls back to defaultSettings if the stored value is not valid JSON-object shaped', async () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(null))
      expect(await getSettings()).toEqual(defaultSettings)
    })
  })

  describe('saveSettings', () => {
    it('writes the full settings object to localStorage under "bonitaSettings"', async () => {
      const next: BonitaSettings = { ...defaultSettings, font: 'verdana' }
      await saveSettings(next)

      expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '')).toEqual(next)
    })

    it('dispatches a CustomEvent carrying the new settings as detail', async () => {
      const handler = vi.fn()
      window.addEventListener(STORAGE_KEY, handler)

      const next: BonitaSettings = { ...defaultSettings, font: 'opendyslexic' }
      await saveSettings(next)

      expect(handler).toHaveBeenCalledTimes(1)
      const event = handler.mock.calls[0][0] as CustomEvent<BonitaSettings>
      expect(event.detail).toEqual(next)

      window.removeEventListener(STORAGE_KEY, handler)
    })
  })

  describe('onSettingsChanged', () => {
    it('invokes the handler with merged settings when the CustomEvent fires', async () => {
      const handler = vi.fn()
      onSettingsChanged(handler)

      await saveSettings({ ...defaultSettings, font: 'arial' })

      expect(handler).toHaveBeenCalledTimes(1)
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ font: 'arial' }))
    })

    it('the returned cleanup function removes the listener', async () => {
      const handler = vi.fn()
      const cleanup = onSettingsChanged(handler)
      cleanup()

      await saveSettings({ ...defaultSettings, font: 'arial' })
      expect(handler).not.toHaveBeenCalled()
    })
  })
})

describe('shared/settings — extension (chrome.storage.sync) context', () => {
  const getMock = vi.fn()
  const setMock = vi.fn()
  const addListenerMock = vi.fn()
  const removeListenerMock = vi.fn()

  beforeEach(() => {
    getMock.mockReset()
    setMock.mockReset()
    addListenerMock.mockReset()
    removeListenerMock.mockReset()
    localStorage.clear()

    vi.stubGlobal('chrome', {
      storage: {
        sync: { get: getMock, set: setMock },
        onChanged: { addListener: addListenerMock, removeListener: removeListenerMock },
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('getSettings', () => {
    it('reads from chrome.storage.sync and merges with defaults', async () => {
      getMock.mockResolvedValue({ [STORAGE_KEY]: { font: 'verdana' } })

      const settings = await getSettings()

      expect(getMock).toHaveBeenCalledWith(STORAGE_KEY)
      expect(settings.font).toBe('verdana')
      expect(settings.enabledTools).toEqual(defaultSettings.enabledTools)
    })

    it('falls back to defaultSettings when nothing is stored yet', async () => {
      getMock.mockResolvedValue({})
      expect(await getSettings()).toEqual(defaultSettings)
    })
  })

  describe('saveSettings', () => {
    it('writes via chrome.storage.sync.set and does not touch localStorage', async () => {
      const next: BonitaSettings = { ...defaultSettings, font: 'opendyslexic' }

      await saveSettings(next)

      expect(setMock).toHaveBeenCalledWith({ [STORAGE_KEY]: next })
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
    })
  })

  describe('onSettingsChanged', () => {
    it('registers a chrome.storage.onChanged listener', () => {
      onSettingsChanged(vi.fn())
      expect(addListenerMock).toHaveBeenCalledTimes(1)
    })

    it('calls the handler with merged settings when bonitaSettings changes', () => {
      const handler = vi.fn()
      onSettingsChanged(handler)
      const listener = addListenerMock.mock.calls[0][0]

      listener({ [STORAGE_KEY]: { newValue: { font: 'arial' }, oldValue: defaultSettings } })

      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ font: 'arial' }))
    })

    it('ignores storage changes unrelated to bonitaSettings', () => {
      const handler = vi.fn()
      onSettingsChanged(handler)
      const listener = addListenerMock.mock.calls[0][0]

      listener({ someOtherKey: { newValue: 'x', oldValue: 'y' } })

      expect(handler).not.toHaveBeenCalled()
    })

    it('the returned cleanup function removes the same listener reference', () => {
      const handler = vi.fn()
      const cleanup = onSettingsChanged(handler)
      const listener = addListenerMock.mock.calls[0][0]

      cleanup()

      expect(removeListenerMock).toHaveBeenCalledWith(listener)
    })
  })
})