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
  boldThresholdPercent?: number
  boldColor?: string
} = {}) {
  const updateSetting = vi.fn()
  mockedUseSettings.mockReturnValue({
    settings: {
      keywordBolding: overrides.keywordBolding ?? false,
      boldThresholdPercent: overrides.boldThresholdPercent,
      boldColor: overrides.boldColor,
    },
    updateSetting,
  } as unknown as ReturnType<typeof useSettings>)
  return updateSetting
}

/** Returns the `.bonita-font-wrapper` div — the hover target for the whole tool. */
function getWrapper(): HTMLElement {
  return document.querySelector('.bonita-font-wrapper') as HTMLElement
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
    render(<PhraseBolding open={false} onShow={vi.fn()} onHide={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Phrase Bolding' })).toHaveClass('active')
  })

  it('toggles keywordBolding on click', async () => {
    const updateSetting = stubSettings({ keywordBolding: false })
    const user = userEvent.setup()
    render(<PhraseBolding open={false} onShow={vi.fn()} onHide={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Phrase Bolding' }))
    expect(updateSetting).toHaveBeenCalledWith('keywordBolding', true)
  })

  // The click handler calls onShow/onHide directly (not just via hover),
  // since the mouse is already over the button at the moment of the click
  // and onMouseEnter won't fire again on its own.
  it('calls onShow directly when enabling via click', async () => {
    const onShow = vi.fn()
    const onHide = vi.fn()
    stubSettings({ keywordBolding: false })
    const user = userEvent.setup()
    render(<PhraseBolding open={false} onShow={onShow} onHide={onHide} />)

    await user.click(screen.getByRole('button', { name: 'Phrase Bolding' }))
    expect(onShow).toHaveBeenCalledTimes(1)
    expect(onHide).not.toHaveBeenCalled()
  })

  it('calls onHide directly when disabling via click', () => {
    const onShow = vi.fn()
    const onHide = vi.fn()
    stubSettings({ keywordBolding: true })
    render(<PhraseBolding open={true} onShow={onShow} onHide={onHide} />)

    // fireEvent.click skips userEvent's implicit hover simulation, isolating
    // the click handler's own onHide call from the separate hover-triggered
    // onShow already covered by the dedicated hover tests below.
    fireEvent.click(screen.getByRole('button', { name: 'Phrase Bolding' }))
    expect(onHide).toHaveBeenCalledTimes(1)
    expect(onShow).not.toHaveBeenCalled()
  })

  describe('hover behaviour', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.runOnlyPendingTimers()
      vi.useRealTimers()
    })

    it('calls onShow on hover-in when enabled', () => {
      const onShow = vi.fn()
      stubSettings({ keywordBolding: true })
      render(<PhraseBolding open={false} onShow={onShow} onHide={vi.fn()} />)

      fireEvent.mouseEnter(getWrapper())
      expect(onShow).toHaveBeenCalledTimes(1)
    })

    it('does not call onShow on hover-in when disabled', () => {
      const onShow = vi.fn()
      stubSettings({ keywordBolding: false })
      render(<PhraseBolding open={false} onShow={onShow} onHide={vi.fn()} />)

      fireEvent.mouseEnter(getWrapper())
      expect(onShow).not.toHaveBeenCalled()
    })

    it('calls onHide after a delay on hover-out', () => {
      const onHide = vi.fn()
      stubSettings({ keywordBolding: true })
      render(<PhraseBolding open={true} onShow={vi.fn()} onHide={onHide} />)

      fireEvent.mouseLeave(getWrapper())
      expect(onHide).not.toHaveBeenCalled()
      vi.advanceTimersByTime(150)
      expect(onHide).toHaveBeenCalledTimes(1)
    })

    it('cancels the pending hide when the mouse re-enters the popup', () => {
      const onHide = vi.fn()
      stubSettings({ keywordBolding: true })
      render(<PhraseBolding open={true} onShow={vi.fn()} onHide={onHide} />)

      fireEvent.mouseLeave(getWrapper())
      vi.advanceTimersByTime(50)
      const popup = screen.getByText('Keywords').closest('.bonita-font-popup') as HTMLElement
      fireEvent.mouseEnter(popup)
      vi.advanceTimersByTime(150)
      expect(onHide).not.toHaveBeenCalled()
    })
  })

  it('does not render the popup when closed', () => {
    stubSettings()
    render(<PhraseBolding open={false} onShow={vi.fn()} onHide={vi.fn()} />)
    expect(screen.queryByText('Keywords')).not.toBeInTheDocument()
  })

  it('defaults the keyword count to 7 and the colour to deep purple', () => {
    stubSettings()
    render(<PhraseBolding open={true} onShow={vi.fn()} onHide={vi.fn()} />)

    expect(screen.getByText('7%')).toBeInTheDocument()
    const colorInput = document.querySelector('input[type="color"]') as HTMLInputElement
    expect(colorInput.value).toBe('#3e236b')
  })

  it('caps the slider max at 100 when the document has no <p> elements', () => {
    stubSettings()
    render(<PhraseBolding open={true} onShow={vi.fn()} onHide={vi.fn()} />)
    const slider = document.querySelector('input[type="range"]') as HTMLInputElement
    expect(slider.max).toBe('100')
  })

  it('scales the slider max with the number of <p> elements in the document', () => {
    const paragraphs = Array.from({ length: 20 }, () => document.createElement('p'))
    paragraphs.forEach(p => document.body.appendChild(p))

    try {
      stubSettings()
      render(<PhraseBolding open={true} onShow={vi.fn()} onHide={vi.fn()} />)
      const slider = document.querySelector('input[type="range"]') as HTMLInputElement
      expect(slider.max).toBe('100')
    } finally {
      paragraphs.forEach(p => p.remove())
    }
  })

  it('updates boldThresholdPercent when the slider changes', () => {
    const updateSetting = stubSettings()
    render(<PhraseBolding open={true} onShow={vi.fn()} onHide={vi.fn()} />)
    const slider = document.querySelector('input[type="range"]') as HTMLInputElement

    fireEvent.change(slider, { target: { value: '5' } })
    expect(updateSetting).toHaveBeenCalledWith('boldThresholdPercent', 5)
  })

  it('updates boldColor when the colour picker changes', () => {
    const updateSetting = stubSettings()
    render(<PhraseBolding open={true} onShow={vi.fn()} onHide={vi.fn()} />)
    const colorInput = document.querySelector('input[type="color"]') as HTMLInputElement

    fireEvent.change(colorInput, { target: { value: '#112233' } })
    expect(updateSetting).toHaveBeenCalledWith('boldColor', '#112233')
  })

  it('mirrors the bold colour onto the --bonita-bold-color CSS variable', () => {
    stubSettings({ boldColor: '#112233' })
    render(<PhraseBolding open={false} onShow={vi.fn()} onHide={vi.fn()} />)
    expect(document.documentElement.style.getPropertyValue('--bonita-bold-color')).toBe('#112233')
  })
})