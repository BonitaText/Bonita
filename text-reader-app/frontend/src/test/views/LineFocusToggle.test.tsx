/**
 * @file views/LineFocusToggle.test.tsx
 *
 * Unit tests for {@link LineFocusToggle}.
 *
 * ## What is tested
 * - Rendering: button presence, correct aria attributes, no popup by default.
 * - Toggle behaviour: clicking enables/disables `lineFocus` and calls
 *   `onShow`/`onHide` directly (since hover-enter won't fire again on click).
 * - Hover behaviour: `onShow` only fires on hover-in while enabled; `onHide`
 *   fires after a delay on hover-out, and is cancelled if the mouse re-enters
 *   the button or popup before the delay elapses.
 * - Popup: renders when `open` is `true`; absent when `open` is `false`.
 * - Slider: displays clamped height, fires `updateSetting` on change, shows live readout.
 * - CSS variable: `--bonita-line-focus-height` is written to `:root` on render.
 * - Constants: min/max/default values are within sensible bounds.
 * - Clamping: out-of-range stored values are clamped before display and CSS write.
 *
 * ## What is NOT tested
 * - `useLineFocusApplier` internals — that hook has its own test suite.
 * - `useSettings` storage layer — mocked at the module boundary.
 */

import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import LineFocusToggle, {
  LINE_FOCUS_MIN_PX,
  LINE_FOCUS_MAX_PX,
  LINE_FOCUS_DEFAULT_PX,
} from '../../content/views/LineFocusToggle'

// ─── Mocks ────────────────────────────────────────────────────────────────────

/** Shared mutable settings object — tests mutate this to simulate stored state. */
const mockSettings = {
  lineFocus: false,
  lineFocusHeight: LINE_FOCUS_DEFAULT_PX,
}

const mockUpdateSetting = vi.fn()

vi.mock('../../content/hooks/useSettings', () => ({
  useSettings: () => ({
    settings: mockSettings,
    updateSetting: mockUpdateSetting,
  }),
}))

// useLineFocusApplier has its own tests; stub it out here
vi.mock('../../content/hooks/useLineFocusApplier', () => ({
  useLineFocusApplier: vi.fn(),
}))

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Renders the component with sane defaults that can be overridden per test.
 *
 * @param overrides - Partial props to merge with the defaults.
 */
function renderToggle(
  overrides: Partial<{ open: boolean; onShow: () => void; onHide: () => void }> = {},
) {
  const onShow = overrides.onShow ?? vi.fn()
  const onHide = overrides.onHide ?? vi.fn()
  const open = overrides.open ?? false
  render(<LineFocusToggle open={open} onShow={onShow} onHide={onHide} />)
  return { onShow, onHide }
}

/** Returns the `.bonita-font-wrapper` div — the hover target for the whole tool. */
function getWrapper(): HTMLElement {
  return document.querySelector('.bonita-font-wrapper') as HTMLElement
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('LineFocusToggle', () => {
  beforeEach(() => {
    mockSettings.lineFocus = false
    mockSettings.lineFocusHeight = LINE_FOCUS_DEFAULT_PX
    mockUpdateSetting.mockClear()
    document.documentElement.style.removeProperty('--bonita-line-focus-height')
  })

  // ── Constants ──────────────────────────────────────────────────────────────

  describe('constants', () => {
    it('LINE_FOCUS_MIN_PX is greater than 0', () => {
      expect(LINE_FOCUS_MIN_PX).toBeGreaterThan(0)
    })

    it('LINE_FOCUS_MAX_PX is greater than LINE_FOCUS_MIN_PX', () => {
      expect(LINE_FOCUS_MAX_PX).toBeGreaterThan(LINE_FOCUS_MIN_PX)
    })

    it('LINE_FOCUS_DEFAULT_PX is within [MIN, MAX]', () => {
      expect(LINE_FOCUS_DEFAULT_PX).toBeGreaterThanOrEqual(LINE_FOCUS_MIN_PX)
      expect(LINE_FOCUS_DEFAULT_PX).toBeLessThanOrEqual(LINE_FOCUS_MAX_PX)
    })
  })

  // ── Rendering ──────────────────────────────────────────────────────────────

  describe('rendering', () => {
    it('renders the toggle button', () => {
      renderToggle()
      expect(screen.getByRole('button', { name: /line focus/i })).toBeInTheDocument()
    })

    it('button has aria-label "Line Focus"', () => {
      renderToggle()
      expect(screen.getByRole('button', { name: 'Line Focus' })).toBeInTheDocument()
    })

    it('button does not have active class when lineFocus is false', () => {
      renderToggle()
      expect(screen.getByRole('button', { name: 'Line Focus' })).not.toHaveClass('active')
    })

    it('button has active class when lineFocus is true', () => {
      mockSettings.lineFocus = true
      renderToggle()
      expect(screen.getByRole('button', { name: 'Line Focus' })).toHaveClass('active')
    })

    it('does not render popup when open is false', () => {
      renderToggle({ open: false })
      expect(screen.queryByText(/focus height/i)).not.toBeInTheDocument()
    })

    it('renders popup when open is true', () => {
      renderToggle({ open: true })
      expect(screen.getByText(/focus height/i)).toBeInTheDocument()
    })
  })

  // ── Toggle click behaviour ─────────────────────────────────────────────────

  describe('clicking the toggle button', () => {
    it('calls updateSetting with lineFocus true when currently disabled', () => {
      mockSettings.lineFocus = false
      renderToggle()
      fireEvent.click(screen.getByRole('button', { name: 'Line Focus' }))
      expect(mockUpdateSetting).toHaveBeenCalledWith('lineFocus', true)
    })

    it('calls updateSetting with lineFocus false when currently enabled', () => {
      mockSettings.lineFocus = true
      renderToggle()
      fireEvent.click(screen.getByRole('button', { name: 'Line Focus' }))
      expect(mockUpdateSetting).toHaveBeenCalledWith('lineFocus', false)
    })

    it('calls onShow directly when enabling, regardless of current open state', () => {
      // The click handler calls onShow/onHide directly (not just via hover),
      // since the mouse is already over the button and onMouseEnter won't
      // fire again on its own.
      mockSettings.lineFocus = false
      const { onShow, onHide } = renderToggle({ open: false })
      fireEvent.click(screen.getByRole('button', { name: 'Line Focus' }))
      expect(onShow).toHaveBeenCalledTimes(1)
      expect(onHide).not.toHaveBeenCalled()
    })

    it('calls onHide directly when disabling, regardless of current open state', () => {
      mockSettings.lineFocus = true
      const { onShow, onHide } = renderToggle({ open: true })
      fireEvent.click(screen.getByRole('button', { name: 'Line Focus' }))
      expect(onHide).toHaveBeenCalledTimes(1)
      expect(onShow).not.toHaveBeenCalled()
    })
  })

  // ── Hover behaviour ────────────────────────────────────────────────────────

  describe('hover behaviour', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.runOnlyPendingTimers()
      vi.useRealTimers()
    })

    it('calls onShow on hover-in when enabled', () => {
      mockSettings.lineFocus = true
      const { onShow } = renderToggle()
      fireEvent.mouseEnter(getWrapper())
      expect(onShow).toHaveBeenCalledTimes(1)
    })

    it('does not call onShow on hover-in when disabled', () => {
      mockSettings.lineFocus = false
      const { onShow } = renderToggle()
      fireEvent.mouseEnter(getWrapper())
      expect(onShow).not.toHaveBeenCalled()
    })

    it('calls onHide after a delay on hover-out', () => {
      mockSettings.lineFocus = true
      const { onHide } = renderToggle({ open: true })
      fireEvent.mouseLeave(getWrapper())
      expect(onHide).not.toHaveBeenCalled()
      vi.advanceTimersByTime(150)
      expect(onHide).toHaveBeenCalledTimes(1)
    })

    it('cancels the pending hide when the mouse re-enters before the delay elapses', () => {
      mockSettings.lineFocus = true
      const { onHide } = renderToggle({ open: true })
      fireEvent.mouseLeave(getWrapper())
      vi.advanceTimersByTime(50)
      fireEvent.mouseEnter(getWrapper())
      vi.advanceTimersByTime(150)
      expect(onHide).not.toHaveBeenCalled()
    })

    it('cancels the pending hide when the mouse enters the popup', () => {
      mockSettings.lineFocus = true
      const { onHide } = renderToggle({ open: true })
      fireEvent.mouseLeave(getWrapper())
      vi.advanceTimersByTime(50)
      const popup = screen.getByText(/focus height/i).closest('.bonita-font-popup') as HTMLElement
      fireEvent.mouseEnter(popup)
      vi.advanceTimersByTime(150)
      expect(onHide).not.toHaveBeenCalled()
    })
  })

  // ── Popup contents ─────────────────────────────────────────────────────────

  describe('popup', () => {
    it('slider has correct min attribute', () => {
      renderToggle({ open: true })
      const slider = screen.getByRole('slider')
      expect(slider).toHaveAttribute('min', String(LINE_FOCUS_MIN_PX))
    })

    it('slider has correct max attribute', () => {
      renderToggle({ open: true })
      const slider = screen.getByRole('slider')
      expect(slider).toHaveAttribute('max', String(LINE_FOCUS_MAX_PX))
    })

    it('slider value reflects the stored height', () => {
      mockSettings.lineFocusHeight = 80
      renderToggle({ open: true })
      expect(screen.getByRole('slider')).toHaveValue('80')
    })

    it('slider value defaults to LINE_FOCUS_DEFAULT_PX when setting is undefined', () => {
      // @ts-expect-error — intentionally testing undefined path
      mockSettings.lineFocusHeight = undefined
      renderToggle({ open: true })
      expect(screen.getByRole('slider')).toHaveValue(String(LINE_FOCUS_DEFAULT_PX))
    })

    it('live readout shows the current height', () => {
      mockSettings.lineFocusHeight = 96
      renderToggle({ open: true })
      expect(screen.getByText('96px')).toBeInTheDocument()
    })

    it('fires updateSetting with lineFocusHeight on slider change', () => {
      renderToggle({ open: true })
      fireEvent.change(screen.getByRole('slider'), { target: { value: '100' } })
      expect(mockUpdateSetting).toHaveBeenCalledWith('lineFocusHeight', 100)
    })

    it('shows "Narrow" and "Wide" labels', () => {
      renderToggle({ open: true })
      expect(screen.getByText('Narrow')).toBeInTheDocument()
      expect(screen.getByText('Wide')).toBeInTheDocument()
    })
  })

  // ── Value clamping ─────────────────────────────────────────────────────────

  describe('clamping', () => {
    it('clamps stored height above MAX down to MAX', () => {
      mockSettings.lineFocusHeight = LINE_FOCUS_MAX_PX + 100
      renderToggle({ open: true })
      expect(screen.getByRole('slider')).toHaveValue(String(LINE_FOCUS_MAX_PX))
      expect(screen.getByText(`${LINE_FOCUS_MAX_PX}px`)).toBeInTheDocument()
    })

    it('clamps stored height below MIN up to MIN', () => {
      mockSettings.lineFocusHeight = 0
      renderToggle({ open: true })
      expect(screen.getByRole('slider')).toHaveValue(String(LINE_FOCUS_MIN_PX))
      expect(screen.getByText(`${LINE_FOCUS_MIN_PX}px`)).toBeInTheDocument()
    })
  })

  // ── CSS variable ───────────────────────────────────────────────────────────

  describe('CSS custom property', () => {
    it('writes --bonita-line-focus-height to :root on render', () => {
      mockSettings.lineFocusHeight = 64
      renderToggle()
      expect(
        document.documentElement.style.getPropertyValue('--bonita-line-focus-height'),
      ).toBe('64px')
    })

    it('clamps the CSS variable value when height is out of range', () => {
      mockSettings.lineFocusHeight = 9999
      renderToggle()
      expect(
        document.documentElement.style.getPropertyValue('--bonita-line-focus-height'),
      ).toBe(`${LINE_FOCUS_MAX_PX}px`)
    })
  })
})