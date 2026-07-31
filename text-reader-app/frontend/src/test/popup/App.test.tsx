import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import App from '../../popup/App'
import { defaultSettings, getSettings, saveSettings, type BonitaSettings } from '@/shared/settings'

// Keep defaultSettings (and any other real exports) intact; only swap out the
// storage I/O functions for mocks so tests control what "loads" on mount.
vi.mock('@/shared/settings', async () => {
  const actual = await vi.importActual<typeof import('@/shared/settings')>('@/shared/settings')
  return {
    ...actual,
    getSettings: vi.fn(),
    saveSettings: vi.fn(),
  }
})

const mockedGetSettings = vi.mocked(getSettings)
const mockedSaveSettings = vi.mocked(saveSettings)

function settingsWith(overrides: Partial<BonitaSettings>): BonitaSettings {
  return {
    ...defaultSettings,
    ...overrides,
    enabledTools: { ...defaultSettings.enabledTools, ...overrides.enabledTools },
  }
}

beforeEach(() => {
  mockedGetSettings.mockReset()
  mockedSaveSettings.mockReset()
  mockedSaveSettings.mockResolvedValue(undefined)
  mockedGetSettings.mockResolvedValue(defaultSettings)
})

describe('popup App — initial render', () => {
  it('renders the brand header', async () => {
    render(<App />)
    expect(screen.getByText('Bonita')).toBeInTheDocument()
    expect(screen.getByText('Readable web overlay')).toBeInTheDocument()
    await waitFor(() => expect(mockedGetSettings).toHaveBeenCalled())
  })

  it('loads settings on mount and reflects the active tool count', async () => {
    mockedGetSettings.mockResolvedValue(
      settingsWith({
        enabledTools: {
          sentenceSplitting: true,
          keywordBolding: false,
          wordSimplification: false,
          pos: true,
          lineFocus: false,
          tts: false,
        },
      }),
    )
    render(<App />)

    expect(await screen.findByText('2 tools active')).toBeInTheDocument()
  })

  it('shows "Preview" (disabled state) by default', async () => {
    render(<App />)
    await waitFor(() => expect(mockedGetSettings).toHaveBeenCalled())
    expect(screen.getByRole('button', { name: /Preview/ })).not.toHaveClass('is-on')
  })
})

describe('popup App — enabled / preview toggle', () => {
  it('toggles to "Ready" on click and persists the change', async () => {
    render(<App />)
    await waitFor(() => expect(mockedGetSettings).toHaveBeenCalled())

    fireEvent.click(screen.getByRole('button', { name: /Preview/ }))

    expect(screen.getByRole('button', { name: /Ready/ })).toHaveClass('is-on')
    expect(mockedSaveSettings).toHaveBeenCalledWith(expect.objectContaining({ enabled: true }))
  })

  it('toggles back to "Preview" on a second click', async () => {
    render(<App />)
    await waitFor(() => expect(mockedGetSettings).toHaveBeenCalled())

    fireEvent.click(screen.getByRole('button', { name: /Preview/ }))
    fireEvent.click(screen.getByRole('button', { name: /Ready/ }))

    expect(screen.getByRole('button', { name: /Preview/ })).not.toHaveClass('is-on')
    expect(mockedSaveSettings).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: false }))
  })
})

describe('popup App — calm reading preset', () => {
  it('enables every tool and persists enabledTools with all flags true', async () => {
    mockedGetSettings.mockResolvedValue(
      settingsWith({
        enabledTools: {
          sentenceSplitting: false,
          keywordBolding: false,
          wordSimplification: false,
          pos: false,
          lineFocus: false,
          tts: false,
        },
      }),
    )
    render(<App />)
    expect(await screen.findByText('0 tools active')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Apply calm reading preset/ }))

    expect(await screen.findByText('6 tools active')).toBeInTheDocument()
    expect(mockedSaveSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        enabledTools: {
          sentenceSplitting: true,
          keywordBolding: true,
          wordSimplification: true,
          pos: true,
          lineFocus: true,
          tts: true,
        },
      }),
    )
  })
})

describe('popup App — per-tool feature cards', () => {
  it('renders each checkbox reflecting its current visibility', async () => {
    mockedGetSettings.mockResolvedValue(
      settingsWith({
        enabledTools: {
          sentenceSplitting: true,
          keywordBolding: true,
          wordSimplification: true,
          pos: false,
          lineFocus: true,
          tts: true,
        },
      }),
    )
    render(<App />)
    await screen.findByText('5 tools active')

    const grammarCheckbox = screen.getByRole('checkbox', { name: /Grammar color/i })
    expect(grammarCheckbox).not.toBeChecked()
    expect(grammarCheckbox.closest('label')).not.toHaveClass('active')
  })

  it('toggling a card off hides only that tool and persists the change', async () => {
    render(<App />) // defaultSettings → every tool on
    await waitFor(() => expect(mockedGetSettings).toHaveBeenCalled())

    const ttsCheckbox = screen.getByRole('checkbox', { name: /Read aloud/i })
    fireEvent.click(ttsCheckbox)

    expect(ttsCheckbox).not.toBeChecked()
    expect(await screen.findByText('5 tools active')).toBeInTheDocument()
    expect(mockedSaveSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        enabledTools: expect.objectContaining({ tts: false, pos: true }),
      }),
    )
  })

  it('toggling a card back on restores it without affecting others', async () => {
    mockedGetSettings.mockResolvedValue(
      settingsWith({ enabledTools: { ...defaultSettings.enabledTools, lineFocus: false } }),
    )
    render(<App />)
    await screen.findByText('5 tools active')

    fireEvent.click(screen.getByRole('checkbox', { name: /Line focus/i }))

    expect(await screen.findByText('6 tools active')).toBeInTheDocument()
    expect(mockedSaveSettings).toHaveBeenCalledWith(
      expect.objectContaining({ enabledTools: expect.objectContaining({ lineFocus: true }) }),
    )
  })
})

describe('popup App — font selection', () => {
  it('marks "Default" as selected initially', async () => {
    render(<App />)
    await waitFor(() => expect(mockedGetSettings).toHaveBeenCalled())
    expect(screen.getByRole('button', { name: 'Default' })).toHaveClass('selected')
  })

  it('selecting a different font updates the selected button and persists it', async () => {
    render(<App />)
    await waitFor(() => expect(mockedGetSettings).toHaveBeenCalled())

    fireEvent.click(screen.getByRole('button', { name: 'OpenDyslexic' }))

    expect(screen.getByRole('button', { name: 'OpenDyslexic' })).toHaveClass('selected')
    expect(screen.getByRole('button', { name: 'Default' })).not.toHaveClass('selected')
    expect(mockedSaveSettings).toHaveBeenCalledWith(expect.objectContaining({ font: 'opendyslexic' }))
  })
})