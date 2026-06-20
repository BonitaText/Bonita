import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PhraseBolding from '../../content/views/PhraseBolding'
import { useSettings } from '../../content/hooks/useSettings'

vi.mock('../../content/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}))

const mockedUseSettings = vi.mocked(useSettings)

function stubSettings(overrides: {
  keywordBolding?: boolean
  boldTargetCount?: number
  boldColor?: string
} = {}) {
  const updateSetting = vi.fn()
  mockedUseSettings.mockReturnValue({
    settings: {
      keywordBolding: overrides.keywordBolding ?? false,
      boldTargetCount: overrides.boldTargetCount,
      boldColor: overrides.boldColor,
    },
    updateSetting,
  } as unknown as ReturnType<typeof useSettings>)
  return updateSetting
}

describe('PhraseBolding', () => {
  beforeEach(() => {
    mockedUseSettings.mockReset()
  })

  afterEach(() => {
    document.documentElement.style.removeProperty('--bonita-bold-color')
  })

  it('reflects keywordBolding as the "active" class on the dock button', () => {
    stubSettings({ keywordBolding: true })
    render(<PhraseBolding open={false} onOpen={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Phrase Bolding' })).toHaveClass('active')
  })

  it('toggles keywordBolding on click', async () => {
    const updateSetting = stubSettings({ keywordBolding: false })
    const user = userEvent.setup()
    render(<PhraseBolding open={false} onOpen={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Phrase Bolding' }))
    expect(updateSetting).toHaveBeenCalledWith('keywordBolding', true)
  })

  // onClick only calls onOpen when the *new* enabled value differs from the
  // current `open` prop — i.e. exactly when enabled and open started in sync.
  it('calls onOpen when enabled/open started in sync (both false)', async () => {
    const onOpen = vi.fn()
    stubSettings({ keywordBolding: false })
    const user = userEvent.setup()
    render(<PhraseBolding open={false} onOpen={onOpen} />)

    await user.click(screen.getByRole('button', { name: 'Phrase Bolding' }))
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('calls onOpen when enabled/open started in sync (both true)', async () => {
    const onOpen = vi.fn()
    stubSettings({ keywordBolding: true })
    const user = userEvent.setup()
    render(<PhraseBolding open={true} onOpen={onOpen} />)

    await user.click(screen.getByRole('button', { name: 'Phrase Bolding' }))
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('does not call onOpen when enabled/open started out of sync', async () => {
    const onOpen = vi.fn()
    stubSettings({ keywordBolding: false })
    const user = userEvent.setup()
    render(<PhraseBolding open={true} onOpen={onOpen} />)

    await user.click(screen.getByRole('button', { name: 'Phrase Bolding' }))
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('does not render the popup when closed', () => {
    stubSettings()
    render(<PhraseBolding open={false} onOpen={vi.fn()} />)
    expect(screen.queryByText('Keywords')).not.toBeInTheDocument()
  })

  it('defaults the keyword count to 7 and the colour to deep purple', () => {
    stubSettings()
    render(<PhraseBolding open={true} onOpen={vi.fn()} />)

    expect(screen.getByText('7')).toBeInTheDocument()
    const colorInput = document.querySelector('input[type="color"]') as HTMLInputElement
    expect(colorInput.value).toBe('#3e236b')
  })

  it('caps the slider max at 10 when the document has no <p> elements', () => {
    stubSettings()
    render(<PhraseBolding open={true} onOpen={vi.fn()} />)
    const slider = document.querySelector('input[type="range"]') as HTMLInputElement
    expect(slider.max).toBe('10')
  })

  it('scales the slider max with the number of <p> elements in the document', () => {
    const paragraphs = Array.from({ length: 20 }, () => document.createElement('p'))
    paragraphs.forEach(p => document.body.appendChild(p))

    try {
      stubSettings()
      render(<PhraseBolding open={true} onOpen={vi.fn()} />)
      const slider = document.querySelector('input[type="range"]') as HTMLInputElement
      expect(slider.max).toBe(String(10 + 20 * 2)) // 50
    } finally {
      paragraphs.forEach(p => p.remove())
    }
  })

  it('clamps the slider max at 200 regardless of how many <p> elements exist', () => {
    const paragraphs = Array.from({ length: 200 }, () => document.createElement('p'))
    paragraphs.forEach(p => document.body.appendChild(p))

    try {
      stubSettings()
      render(<PhraseBolding open={true} onOpen={vi.fn()} />)
      const slider = document.querySelector('input[type="range"]') as HTMLInputElement
      expect(slider.max).toBe('200')
    } finally {
      paragraphs.forEach(p => p.remove())
    }
  })

  it('clamps the slider value to the effective max without clamping the displayed count', () => {
    stubSettings({ boldTargetCount: 50 }) // effectiveMax defaults to 10 with no <p>s
    render(<PhraseBolding open={true} onOpen={vi.fn()} />)

    const slider = document.querySelector('input[type="range"]') as HTMLInputElement
    expect(slider.value).toBe('10')
    expect(screen.getByText('50')).toBeInTheDocument() // readout shows the raw, uncapped count
  })

  it('updates boldTargetCount when the slider changes', () => {
    const updateSetting = stubSettings()
    render(<PhraseBolding open={true} onOpen={vi.fn()} />)
    const slider = document.querySelector('input[type="range"]') as HTMLInputElement

    fireEvent.change(slider, { target: { value: '5' } })
    expect(updateSetting).toHaveBeenCalledWith('boldTargetCount', 5)
  })

  it('updates boldColor when the colour picker changes', () => {
    const updateSetting = stubSettings()
    render(<PhraseBolding open={true} onOpen={vi.fn()} />)
    const colorInput = document.querySelector('input[type="color"]') as HTMLInputElement

    fireEvent.change(colorInput, { target: { value: '#112233' } })
    expect(updateSetting).toHaveBeenCalledWith('boldColor', '#112233')
  })

  it('mirrors the bold colour onto the --bonita-bold-color CSS variable', () => {
    stubSettings({ boldColor: '#112233' })
    render(<PhraseBolding open={false} onOpen={vi.fn()} />)
    expect(document.documentElement.style.getPropertyValue('--bonita-bold-color')).toBe('#112233')
  })
})