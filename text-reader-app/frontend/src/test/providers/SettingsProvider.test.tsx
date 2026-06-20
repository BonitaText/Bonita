import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SettingsProvider } from '../../content/providers/SettingsProvider'
import { useSettings } from '../../content/hooks/useSettings'
import {
  defaultSettings,
  getSettings,
  saveSettings,
  onSettingsChanged,
  type BonitaSettings,
} from '../../shared/settings'

vi.mock('../../shared/settings', async () => {
  const actual = await vi.importActual<typeof import('../../shared/settings')>('../../shared/settings')
  return {
    ...actual,
    getSettings: vi.fn(),
    saveSettings: vi.fn(),
    onSettingsChanged: vi.fn(),
  }
})

const mockedGetSettings = vi.mocked(getSettings)
const mockedSaveSettings = vi.mocked(saveSettings)
const mockedOnSettingsChanged = vi.mocked(onSettingsChanged)

/** Renders settings/ready state and exposes buttons to exercise updateSetting/updateSettings. */
function TestConsumer() {
  const { settings, updateSetting, updateSettings, ready } = useSettings()
  return (
    <div>
      <span data-testid="ready">{String(ready)}</span>
      <span data-testid="font">{settings.font}</span>
      <span data-testid="tts">{String(settings.tts)}</span>
      <button onClick={() => updateSetting('font', 'arial')}>set-font</button>
      <button onClick={() => updateSettings({ font: 'verdana', tts: true })}>patch</button>
    </div>
  )
}

const cleanupListenerMock = vi.fn()

beforeEach(() => {
  mockedGetSettings.mockReset()
  mockedSaveSettings.mockReset()
  mockedOnSettingsChanged.mockReset()
  cleanupListenerMock.mockClear()

  mockedSaveSettings.mockResolvedValue(undefined)
  mockedOnSettingsChanged.mockReturnValue(cleanupListenerMock)
})

describe('SettingsProvider', () => {
  it('starts with defaultSettings and ready=false before getSettings resolves', async () => {
    let resolveGetSettings: (value: BonitaSettings) => void = () => {}
    mockedGetSettings.mockReturnValue(
      new Promise<BonitaSettings>((resolve) => {
        resolveGetSettings = resolve
      }),
    )

    render(
      <SettingsProvider>
        <TestConsumer />
      </SettingsProvider>,
    )

    expect(screen.getByTestId('ready')).toHaveTextContent('false')
    expect(screen.getByTestId('font')).toHaveTextContent(defaultSettings.font)

    // Resolve so the deferred promise doesn't dangle into the next test.
    resolveGetSettings(defaultSettings)
    await waitFor(() => expect(screen.getByTestId('ready')).toHaveTextContent('true'))
  })

  it('loads settings via getSettings on mount and flips ready to true', async () => {
    mockedGetSettings.mockResolvedValue({ ...defaultSettings, font: 'opendyslexic' })

    render(
      <SettingsProvider>
        <TestConsumer />
      </SettingsProvider>,
    )

    await waitFor(() => expect(screen.getByTestId('ready')).toHaveTextContent('true'))
    expect(screen.getByTestId('font')).toHaveTextContent('opendyslexic')
  })

  it('registers exactly one onSettingsChanged listener regardless of how many consumers mount', async () => {
    mockedGetSettings.mockResolvedValue(defaultSettings)

    render(
      <SettingsProvider>
        <TestConsumer />
        <TestConsumer />
      </SettingsProvider>,
    )

    await waitFor(() => expect(mockedGetSettings).toHaveBeenCalledTimes(1))
    expect(mockedOnSettingsChanged).toHaveBeenCalledTimes(1)
  })

  it('updates state when the storage-change listener fires (e.g. change from another tab)', async () => {
    mockedGetSettings.mockResolvedValue(defaultSettings)

    render(
      <SettingsProvider>
        <TestConsumer />
      </SettingsProvider>,
    )

    await waitFor(() => expect(mockedOnSettingsChanged).toHaveBeenCalledTimes(1))
    const handler = mockedOnSettingsChanged.mock.calls[0][0]

    handler({ ...defaultSettings, font: 'verdana' })

    await waitFor(() => expect(screen.getByTestId('font')).toHaveTextContent('verdana'))
  })

  it('removes the storage listener on unmount via the cleanup function', async () => {
    mockedGetSettings.mockResolvedValue(defaultSettings)

    const { unmount } = render(
      <SettingsProvider>
        <TestConsumer />
      </SettingsProvider>,
    )

    await waitFor(() => expect(mockedOnSettingsChanged).toHaveBeenCalledTimes(1))
    expect(cleanupListenerMock).not.toHaveBeenCalled()

    unmount()
    expect(cleanupListenerMock).toHaveBeenCalledTimes(1)
  })

  it('updateSetting optimistically updates a single key and persists the full merged object', async () => {
    mockedGetSettings.mockResolvedValue(defaultSettings)

    render(
      <SettingsProvider>
        <TestConsumer />
      </SettingsProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('ready')).toHaveTextContent('true'))

    fireEvent.click(screen.getByRole('button', { name: 'set-font' }))

    expect(screen.getByTestId('font')).toHaveTextContent('arial')
    expect(mockedSaveSettings).toHaveBeenCalledWith(
      expect.objectContaining({ ...defaultSettings, font: 'arial' }),
    )
  })

  it('updateSettings patches multiple keys in one optimistic update and a single save call', async () => {
    mockedGetSettings.mockResolvedValue(defaultSettings)

    render(
      <SettingsProvider>
        <TestConsumer />
      </SettingsProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('ready')).toHaveTextContent('true'))

    fireEvent.click(screen.getByRole('button', { name: 'patch' }))

    expect(screen.getByTestId('font')).toHaveTextContent('verdana')
    expect(screen.getByTestId('tts')).toHaveTextContent('true')
    expect(mockedSaveSettings).toHaveBeenCalledTimes(1)
    expect(mockedSaveSettings).toHaveBeenCalledWith(
      expect.objectContaining({ font: 'verdana', tts: true }),
    )
  })
})