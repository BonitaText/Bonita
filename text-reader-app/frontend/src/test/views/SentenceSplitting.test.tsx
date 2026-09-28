import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import SentenceSplitting from '../../content/views/SentenceSplitting'
import { useSettings } from '../../content/hooks/useSettings'

vi.mock('../../content/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}))

const mockedUseSettings = vi.mocked(useSettings)

/** Matches the hide grace period hard-coded in SentenceSplitting.tsx. */
const HIDE_DELAY_MS = 150

function stubSettings(sentenceSplitting: boolean, splitThresholdPercent?: number) {
  const updateSetting = vi.fn()
  mockedUseSettings.mockReturnValue({
    settings: { sentenceSplitting, splitThresholdPercent },
    updateSetting,
  } as unknown as ReturnType<typeof useSettings>)
  return updateSetting
}

const onShow = vi.fn()
const onHide = vi.fn()

/**
 * Renders SentenceSplitting with the props App.tsx supplies. `open` is
 * controlled by the parent in the real app, so tests set it directly.
 */
function renderSplitting(open = false) {
  return render(<SentenceSplitting open={open} onShow={onShow} onHide={onHide} />)
}

const getButton = () => screen.getByRole('button', { name: 'Sentence Splitting' })
/** The hover wrapper (`.bonita-font-wrapper`) is the button's parent. */
const getWrapper = () => getButton().parentElement as HTMLElement
const getPopup = () => document.querySelector('.bonita-font-popup') as HTMLElement | null

describe('SentenceSplitting', () => {
  beforeEach(() => {
    mockedUseSettings.mockReset()
    onShow.mockClear()
    onHide.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ── Toggle button ──────────────────────────────────────────────────────────

  describe('toggle button', () => {
    it('renders a button labelled "Sentence Splitting"', () => {
      stubSettings(false)
      renderSplitting()
      expect(getButton()).toBeInTheDocument()
    })

    it('reflects settings.sentenceSplitting=false as inactive', () => {
      stubSettings(false)
      renderSplitting()
      expect(getButton()).not.toHaveClass('active')
    })

    it('reflects settings.sentenceSplitting=true as active', () => {
      stubSettings(true)
      renderSplitting()
      expect(getButton()).toHaveClass('active')
    })

    it('calls updateSetting("sentenceSplitting", true) when toggled on', () => {
      const updateSetting = stubSettings(false)
      renderSplitting()

      fireEvent.click(getButton())

      expect(updateSetting).toHaveBeenCalledWith('sentenceSplitting', true)
    })

    it('calls updateSetting("sentenceSplitting", false) when toggled off', () => {
      const updateSetting = stubSettings(true)
      renderSplitting()

      fireEvent.click(getButton())

      expect(updateSetting).toHaveBeenCalledWith('sentenceSplitting', false)
    })
  })

  // ── onShow / onHide wiring ─────────────────────────────────────────────────

  describe('popup requests (onShow / onHide)', () => {
    it('calls onShow (and not onHide) when clicked to turn the tool on', () => {
      stubSettings(false)
      renderSplitting()

      fireEvent.click(getButton())

      expect(onShow).toHaveBeenCalledTimes(1)
      expect(onHide).not.toHaveBeenCalled()
    })

    it('calls onHide (and not onShow) when clicked to turn the tool off', () => {
      stubSettings(true)
      renderSplitting()

      fireEvent.click(getButton())

      expect(onHide).toHaveBeenCalledTimes(1)
      expect(onShow).not.toHaveBeenCalled()
    })

    it('does not call onShow on hover while the tool is disabled', () => {
      stubSettings(false)
      renderSplitting()

      fireEvent.mouseEnter(getWrapper())

      expect(onShow).not.toHaveBeenCalled()
    })

    it('calls onShow on hover while the tool is enabled', () => {
      stubSettings(true)
      renderSplitting()

      fireEvent.mouseEnter(getWrapper())

      expect(onShow).toHaveBeenCalledTimes(1)
    })

    it('calls onHide only after the grace period once the mouse leaves', () => {
      vi.useFakeTimers()
      stubSettings(true)
      renderSplitting()

      fireEvent.mouseLeave(getWrapper())
      vi.advanceTimersByTime(HIDE_DELAY_MS - 1)
      expect(onHide).not.toHaveBeenCalled()

      vi.advanceTimersByTime(1)
      expect(onHide).toHaveBeenCalledTimes(1)
    })

    it('cancels a pending hide if the mouse re-enters before the grace period ends', () => {
      vi.useFakeTimers()
      stubSettings(true)
      renderSplitting()

      fireEvent.mouseLeave(getWrapper())
      vi.advanceTimersByTime(HIDE_DELAY_MS - 50)
      fireEvent.mouseEnter(getWrapper())
      vi.advanceTimersByTime(HIDE_DELAY_MS)

      expect(onHide).not.toHaveBeenCalled()
    })

    it('cancels a pending hide when the button is clicked', () => {
      vi.useFakeTimers()
      stubSettings(false)
      renderSplitting()

      fireEvent.mouseLeave(getWrapper())
      fireEvent.click(getButton()) // turns on → onShow, cancels the pending hide
      vi.advanceTimersByTime(HIDE_DELAY_MS * 2)

      expect(onShow).toHaveBeenCalledTimes(1)
      expect(onHide).not.toHaveBeenCalled()
    })
  })

  // ── Popup ──────────────────────────────────────────────────────────────────

  describe('sensitivity popup', () => {
    it('does not render the popup when open is false', () => {
      stubSettings(true)
      renderSplitting(false)
      expect(getPopup()).toBeNull()
      expect(screen.queryByRole('slider')).not.toBeInTheDocument()
    })

    it('renders the popup with a sensitivity slider when open is true', () => {
      stubSettings(true)
      renderSplitting(true)
      expect(getPopup()).not.toBeNull()
      expect(screen.getByText('Sensitivity')).toBeInTheDocument()
      expect(screen.getByRole('slider')).toBeInTheDocument()
    })

    it('defaults the threshold to 50 when splitThresholdPercent is not set', () => {
      stubSettings(true, undefined)
      renderSplitting(true)

      expect(screen.getByRole('slider')).toHaveValue('50')
      expect(screen.getByText('50%')).toBeInTheDocument()
    })

    it('shows the stored splitThresholdPercent', () => {
      stubSettings(true, 80)
      renderSplitting(true)

      expect(screen.getByRole('slider')).toHaveValue('80')
      expect(screen.getByText('80%')).toBeInTheDocument()
    })

    it('constrains the slider to 1–100 in steps of 1', () => {
      stubSettings(true)
      renderSplitting(true)

      const slider = screen.getByRole('slider')
      expect(slider).toHaveAttribute('min', '1')
      expect(slider).toHaveAttribute('max', '100')
      expect(slider).toHaveAttribute('step', '1')
    })

    it('calls updateSetting("splitThresholdPercent", n) with a number when the slider moves', () => {
      const updateSetting = stubSettings(true, 50)
      renderSplitting(true)

      fireEvent.change(screen.getByRole('slider'), { target: { value: '75' } })

      expect(updateSetting).toHaveBeenCalledWith('splitThresholdPercent', 75)
    })

    it('labels both ends of the slider', () => {
      stubSettings(true)
      renderSplitting(true)

      expect(screen.getByText('Fewer splits')).toBeInTheDocument()
      expect(screen.getByText('More splits')).toBeInTheDocument()
    })

    it('keeps the popup open when the mouse moves from the wrapper into it', () => {
      vi.useFakeTimers()
      stubSettings(true)
      renderSplitting(true)

      fireEvent.mouseLeave(getWrapper()) // leaving the button schedules a hide...
      fireEvent.mouseEnter(getPopup()!)  // ...entering the popup cancels it
      vi.advanceTimersByTime(HIDE_DELAY_MS * 2)

      expect(onHide).not.toHaveBeenCalled()
    })

    it('schedules a hide when the mouse leaves the popup', () => {
      vi.useFakeTimers()
      stubSettings(true)
      renderSplitting(true)

      fireEvent.mouseLeave(getPopup()!)
      vi.advanceTimersByTime(HIDE_DELAY_MS)

      expect(onHide).toHaveBeenCalledTimes(1)
    })
  })
})