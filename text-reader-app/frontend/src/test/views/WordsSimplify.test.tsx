import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import WordSimplify from '../../content/views/WordSimplify'
import { useSettings } from '../../content/hooks/useSettings'

vi.mock('../../content/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}))

const mockedUseSettings = vi.mocked(useSettings)

type Complexity = 'low' | 'medium' | 'high'

function stubSettings(overrides: {
  wordSimplification?: boolean
  wordComplexity?: Complexity
} = {}) {
  const updateSetting = vi.fn()
  mockedUseSettings.mockReturnValue({
    settings: {
      wordSimplification: false,
      wordComplexity: 'medium' as Complexity,
      ...overrides,
    },
    updateSetting,
  } as unknown as ReturnType<typeof useSettings>)
  return updateSetting
}

/** Returns the `.bonita-font-wrapper` div — the hover target for the whole tool. */
function getWrapper(): HTMLElement {
  return document.querySelector('.bonita-font-wrapper') as HTMLElement
}

describe('WordSimplify', () => {
  beforeEach(() => {
    mockedUseSettings.mockReset()
  })

  // Clicking the button now toggles wordSimplification directly, in one
  // click — there's no longer a two-step "first click enables, second click
  // opens the popup" flow.

  it('enables word simplification on click when off, and calls onShow directly', async () => {
    const updateSetting = stubSettings({ wordSimplification: false })
    const onShow = vi.fn()
    const onHide = vi.fn()
    const user = userEvent.setup()
    render(<WordSimplify open={false} onShow={onShow} onHide={onHide} />)

    await user.click(screen.getByRole('button', { name: 'Word Simplification' }))

    expect(updateSetting).toHaveBeenCalledWith('wordSimplification', true)
    expect(onShow).toHaveBeenCalledTimes(1)
    expect(onHide).not.toHaveBeenCalled()
  })

  it('disables word simplification on click when on, and calls onHide directly', () => {
    const updateSetting = stubSettings({ wordSimplification: true })
    const onShow = vi.fn()
    const onHide = vi.fn()
    render(<WordSimplify open={true} onShow={onShow} onHide={onHide} />)

    // fireEvent.click skips userEvent's implicit hover simulation, isolating
    // the click handler's own onHide call from the separate hover-triggered
    // onShow already covered by the dedicated hover tests below.
    fireEvent.click(screen.getByRole('button', { name: 'Word Simplification' }))

    expect(updateSetting).toHaveBeenCalledWith('wordSimplification', false)
    expect(onHide).toHaveBeenCalledTimes(1)
    expect(onShow).not.toHaveBeenCalled()
  })

  it('shows the "active" class on the dock button only when simplification is on', () => {
    stubSettings({ wordSimplification: true })
    render(<WordSimplify open={false} onShow={vi.fn()} onHide={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Word Simplification' })).toHaveClass('active')
  })

  it('does not render the popup when closed, even if enabled', () => {
    stubSettings({ wordSimplification: true })
    render(<WordSimplify open={false} onShow={vi.fn()} onHide={vi.fn()} />)
    expect(screen.queryByText('Simplify')).not.toBeInTheDocument()
  })

  it('does not render the popup when open but simplification is off', () => {
    stubSettings({ wordSimplification: false })
    render(<WordSimplify open={true} onShow={vi.fn()} onHide={vi.fn()} />)
    expect(screen.queryByText('Simplify')).not.toBeInTheDocument()
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
      stubSettings({ wordSimplification: true })
      const onShow = vi.fn()
      render(<WordSimplify open={false} onShow={onShow} onHide={vi.fn()} />)

      fireEvent.mouseEnter(getWrapper())
      expect(onShow).toHaveBeenCalledTimes(1)
    })

    it('does not call onShow on hover-in when disabled', () => {
      stubSettings({ wordSimplification: false })
      const onShow = vi.fn()
      render(<WordSimplify open={false} onShow={onShow} onHide={vi.fn()} />)

      fireEvent.mouseEnter(getWrapper())
      expect(onShow).not.toHaveBeenCalled()
    })

    it('calls onHide after a delay on hover-out', () => {
      stubSettings({ wordSimplification: true })
      const onHide = vi.fn()
      render(<WordSimplify open={true} onShow={vi.fn()} onHide={onHide} />)

      fireEvent.mouseLeave(getWrapper())
      expect(onHide).not.toHaveBeenCalled()
      vi.advanceTimersByTime(150)
      expect(onHide).toHaveBeenCalledTimes(1)
    })

    it('cancels the pending hide when the mouse re-enters the popup', () => {
      stubSettings({ wordSimplification: true })
      const onHide = vi.fn()
      render(<WordSimplify open={true} onShow={vi.fn()} onHide={onHide} />)

      fireEvent.mouseLeave(getWrapper())
      vi.advanceTimersByTime(50)
      const popup = screen.getByText('Simplify').closest('.bonita-font-popup') as HTMLElement
      fireEvent.mouseEnter(popup)
      vi.advanceTimersByTime(150)
      expect(onHide).not.toHaveBeenCalled()
    })
  })

  describe('popup — 3-point slider', () => {
    it('renders a single slider with min 0 and max 2', () => {
      stubSettings({ wordSimplification: true })
      render(<WordSimplify open={true} onShow={vi.fn()} onHide={vi.fn()} />)

      const slider = screen.getByRole('slider')
      expect(slider).toHaveAttribute('min', '0')
      expect(slider).toHaveAttribute('max', '2')
      expect(slider).toHaveAttribute('step', '1')
    })

    it('slider value reflects the current level: low → 0', () => {
      stubSettings({ wordSimplification: true, wordComplexity: 'low' })
      render(<WordSimplify open={true} onShow={vi.fn()} onHide={vi.fn()} />)
      expect(screen.getByRole('slider')).toHaveValue('0')
    })

    it('slider value reflects the current level: medium → 1', () => {
      stubSettings({ wordSimplification: true, wordComplexity: 'medium' })
      render(<WordSimplify open={true} onShow={vi.fn()} onHide={vi.fn()} />)
      expect(screen.getByRole('slider')).toHaveValue('1')
    })

    it('slider value reflects the current level: high → 2', () => {
      stubSettings({ wordSimplification: true, wordComplexity: 'high' })
      render(<WordSimplify open={true} onShow={vi.fn()} onHide={vi.fn()} />)
      expect(screen.getByRole('slider')).toHaveValue('2')
    })

    it('shows the live label for the current level in the header', () => {
      stubSettings({ wordSimplification: true, wordComplexity: 'high' })
      render(<WordSimplify open={true} onShow={vi.fn()} onHide={vi.fn()} />)
      // The header row (next to "Simplify") holds the live level readout;
      // the slider's static "Low"/"High" edge labels live in a separate row
      // below and also render the text "High" when the level is high, so
      // scope the query to the header row specifically to avoid ambiguity.
      const header = screen.getByText('Simplify').parentElement as HTMLElement
      expect(within(header).getByText('High')).toBeInTheDocument()
    })

    it('shows the description text for the current level', () => {
      stubSettings({ wordSimplification: true, wordComplexity: 'low' })
      render(<WordSimplify open={true} onShow={vi.fn()} onHide={vi.fn()} />)
      expect(screen.getByText('More words')).toBeInTheDocument()
    })

    it('shows "Low" and "High" edge labels', () => {
      stubSettings({ wordSimplification: true })
      render(<WordSimplify open={true} onShow={vi.fn()} onHide={vi.fn()} />)
      // Edge labels are static text on the slider track, separate from the
      // live level readout — both "Low"s should exist since wordComplexity
      // defaults to medium here.
      expect(screen.getAllByText('Low').length).toBeGreaterThan(0)
      expect(screen.getByText('High')).toBeInTheDocument()
    })

    it('updates wordComplexity to "low" when the slider moves to 0', () => {
      const updateSetting = stubSettings({ wordSimplification: true, wordComplexity: 'medium' })
      render(<WordSimplify open={true} onShow={vi.fn()} onHide={vi.fn()} />)

      fireEvent.change(screen.getByRole('slider'), { target: { value: '0' } })
      expect(updateSetting).toHaveBeenCalledWith('wordComplexity', 'low')
    })

    it('updates wordComplexity to "high" when the slider moves to 2', () => {
      const updateSetting = stubSettings({ wordSimplification: true, wordComplexity: 'medium' })
      render(<WordSimplify open={true} onShow={vi.fn()} onHide={vi.fn()} />)

      fireEvent.change(screen.getByRole('slider'), { target: { value: '2' } })
      expect(updateSetting).toHaveBeenCalledWith('wordComplexity', 'high')
    })

    it('defaults the slider to medium (1) when wordComplexity is undefined', () => {
      stubSettings({ wordSimplification: true, wordComplexity: undefined })
      render(<WordSimplify open={true} onShow={vi.fn()} onHide={vi.fn()} />)
      expect(screen.getByRole('slider')).toHaveValue('1')
    })
  })

  it('has no "Turn off" row anywhere in the popup', () => {
    stubSettings({ wordSimplification: true })
    render(<WordSimplify open={true} onShow={vi.fn()} onHide={vi.fn()} />)
    expect(screen.queryByText('Turn off')).not.toBeInTheDocument()
  })

  it('has no discrete Low/Medium/High row buttons — only the slider', () => {
    // The old row-based UI rendered each level as its own clickable button
    // with an "on" class; the new UI has exactly one slider control.
    stubSettings({ wordSimplification: true })
    render(<WordSimplify open={true} onShow={vi.fn()} onHide={vi.fn()} />)
    expect(screen.getAllByRole('slider')).toHaveLength(1)
    expect(screen.queryAllByRole('button', { name: /low|medium|high/i })).toHaveLength(0)
  })
})