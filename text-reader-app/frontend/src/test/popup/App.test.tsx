import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import App from '../../popup/App'
import { defaultSettings, getSettings, saveSettings, type BonitaSettings } from '@/shared/settings'

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

  it('loads settings on mount and reflects each tool checkbox state', async () => {
    mockedGetSettings.mockResolvedValue(
      settingsWith({
        enabledTools: {
          sentenceSplitting: true,
          keywordBolding: false,
          wordSimplification: false,
          pos: true,
          lineFocus: false,
          tts: false,
          font: false,
        },
      }),
    )
    render(<App />)

    expect(await screen.findByRole('checkbox', { name: /Chunk text/i })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /Guide skimming/i })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: /Grammar color/i })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /Font picker/i })).not.toBeChecked()
  })
})

describe('popup App — structure-first preset', () => {
  it('enables exactly lineFocus, keywordBolding, sentenceSplitting, and font — disabling every other tool', async () => {
    mockedGetSettings.mockResolvedValue(
      settingsWith({
        enabledTools: {
          sentenceSplitting: false,
          keywordBolding: false,
          wordSimplification: true,
          pos: true,
          lineFocus: false,
          tts: true,
          font: false,
        },
      }),
    )
    render(<App />)
    await waitFor(() => expect(mockedGetSettings).toHaveBeenCalled())

    fireEvent.click(screen.getByRole('button', { name: /Enable the structure-first toolset/ }))

    expect(mockedSaveSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        enabledTools: {
          sentenceSplitting: true,
          keywordBolding: true,
          wordSimplification: false,
          pos: false,
          lineFocus: true,
          tts: false,
          font: true,
        },
      }),
    )

    expect(await screen.findByRole('checkbox', { name: /Chunk text/i })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /Line focus/i })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /Font picker/i })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /Grammar color/i })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: /Read aloud/i })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: /Word help/i })).not.toBeChecked()
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
          font: true,
        },
      }),
    )
    render(<App />)

    const grammarCheckbox = await screen.findByRole('checkbox', { name: /Grammar color/i })
    expect(grammarCheckbox).not.toBeChecked()
    expect(grammarCheckbox.closest('label')).not.toHaveClass('active')
  })

  it('toggling a card off hides only that tool and persists the change', async () => {
    render(<App />) // defaultSettings → every tool on
    await waitFor(() => expect(mockedGetSettings).toHaveBeenCalled())

    const ttsCheckbox = screen.getByRole('checkbox', { name: /Read aloud/i })
    fireEvent.click(ttsCheckbox)

    expect(ttsCheckbox).not.toBeChecked()
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
    const lineFocusCheckbox = await screen.findByRole('checkbox', { name: /Line focus/i })
    expect(lineFocusCheckbox).not.toBeChecked()

    fireEvent.click(lineFocusCheckbox)

    expect(lineFocusCheckbox).toBeChecked()
    expect(mockedSaveSettings).toHaveBeenCalledWith(
      expect.objectContaining({ enabledTools: expect.objectContaining({ lineFocus: true }) }),
    )
  })
})