/**
 * @file hooks/useLineFocusApplier.test.ts
 *
 * Unit tests for {@link useLineFocusApplier} and its exported helpers
 * {@link buildStyleHTML} and {@link ROOT_ID}.
 *
 * ## Testing strategy
 * - **`buildStyleHTML`** is a pure function, so its output is asserted directly.
 * - **`useLineFocusApplier`** is a DOM side-effect hook.  Tests use
 *   `@testing-library/react`'s `renderHook` to mount it inside a real
 *   (jsdom) document and then inspect `document.body` / `window` to verify
 *   the overlay is created, repositioned, and torn down correctly.
 * - `useSettings` is mocked so tests control `lineFocus` and `lineFocusHeight`
 *   without touching `chrome.storage` or `localStorage`.
 */

import { vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useLineFocusApplier, buildStyleHTML, ROOT_ID } from '../../content/hooks/useLineFocusApplier'
import { LINE_FOCUS_DEFAULT_PX } from '../../content/views/LineFocusToggle'

// ─── Mock useSettings ─────────────────────────────────────────────────────────

/** Mutable settings bag controlled by individual tests. */
const mockSettings = {
  lineFocus: false,
  lineFocusHeight: 48,
}

vi.mock('../../content/hooks/useSettings', () => ({
  useSettings: () => ({ settings: mockSettings }),
}))

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns the overlay root element if it exists in the document. */
const getRoot = (): HTMLElement | null => document.getElementById(ROOT_ID)

/** Fires a synthetic mousemove at the given clientY. */
const fireMouseMove = (clientY: number): void => {
  act(() => {
    window.dispatchEvent(new MouseEvent('mousemove', { clientY }))
  })
}

// ─── buildStyleHTML ───────────────────────────────────────────────────────────

describe('buildStyleHTML', () => {
  it('embeds the provided height into the focus-band rule', () => {
    const html = buildStyleHTML(ROOT_ID, 80)
    expect(html).toContain('height: 80px')
  })

  it('scopes all selectors to the provided rootId', () => {
    const html = buildStyleHTML('my-root', 48)
    expect(html).toContain('#my-root .bonita-focus-layer')
    expect(html).toContain('#my-root .bonita-focus-band')
  })

  it('does not contain any other hard-coded pixel heights', () => {
    // Ensures we removed the old hard-coded 54px value.
    const html = buildStyleHTML(ROOT_ID, 100)
    expect(html).not.toContain('54px')
  })
})

// ─── useLineFocusApplier ──────────────────────────────────────────────────────

describe('useLineFocusApplier', () => {
  beforeEach(() => {
    // Reset settings and DOM state between tests.
    mockSettings.lineFocus = false
    mockSettings.lineFocusHeight = 48
    document.getElementById(ROOT_ID)?.remove()
  })

  // ── Mount / unmount ────────────────────────────────────────────────────────

  it('does not inject an overlay when lineFocus is false', () => {
    mockSettings.lineFocus = false
    renderHook(() => useLineFocusApplier())
    expect(getRoot()).toBeNull()
  })

  it('injects the overlay wrapper when lineFocus is true', () => {
    mockSettings.lineFocus = true
    renderHook(() => useLineFocusApplier())
    expect(getRoot()).not.toBeNull()
  })

  it('sets data-bonita-root on the wrapper', () => {
    mockSettings.lineFocus = true
    renderHook(() => useLineFocusApplier())
    expect(getRoot()?.getAttribute('data-bonita-root')).toBe('true')
  })

  it('removes the overlay when the hook unmounts', () => {
    mockSettings.lineFocus = true
    const { unmount } = renderHook(() => useLineFocusApplier())
    expect(getRoot()).not.toBeNull()
    unmount()
    expect(getRoot()).toBeNull()
  })

  it('removes the overlay when lineFocus switches to false', () => {
    mockSettings.lineFocus = true
    const { rerender } = renderHook(() => useLineFocusApplier())
    expect(getRoot()).not.toBeNull()

    act(() => { mockSettings.lineFocus = false })
    rerender()
    expect(getRoot()).toBeNull()
  })

  it('does not leave duplicate overlays on re-render', () => {
    mockSettings.lineFocus = true
    const { rerender } = renderHook(() => useLineFocusApplier())
    rerender()
    rerender()
    expect(document.querySelectorAll(`#${ROOT_ID}`)).toHaveLength(1)
  })

  // ── Layer structure ────────────────────────────────────────────────────────

  it('renders exactly two focus-layer divs and one focus-band div', () => {
    mockSettings.lineFocus = true
    renderHook(() => useLineFocusApplier())
    const root = getRoot()!
    expect(root.querySelectorAll('.bonita-focus-layer')).toHaveLength(2)
    expect(root.querySelectorAll('.bonita-focus-band')).toHaveLength(1)
  })

  // ── Height ─────────────────────────────────────────────────────────────────

  it('uses LINE_FOCUS_DEFAULT_PX when lineFocusHeight is undefined', () => {
    mockSettings.lineFocus = true
    // @ts-expect-error — intentionally testing the undefined fallback path
    mockSettings.lineFocusHeight = undefined
    renderHook(() => useLineFocusApplier())
    const style = getRoot()!.innerHTML
    expect(style).toContain(`height: ${LINE_FOCUS_DEFAULT_PX}px`)
  })

  it('bakes the configured lineFocusHeight into the style tag', () => {
    mockSettings.lineFocus = true
    mockSettings.lineFocusHeight = 96
    renderHook(() => useLineFocusApplier())
    expect(getRoot()!.innerHTML).toContain('height: 96px')
  })

  it('rebuilds the overlay when lineFocusHeight changes', () => {
    mockSettings.lineFocus = true
    mockSettings.lineFocusHeight = 48
    const { rerender } = renderHook(() => useLineFocusApplier())

    act(() => { mockSettings.lineFocusHeight = 120 })
    rerender()

    expect(getRoot()!.innerHTML).toContain('height: 120px')
    expect(getRoot()!.innerHTML).not.toContain('height: 48px')
  })

  // ── Mouse tracking ─────────────────────────────────────────────────────────

  it('sets the initial band position to the vertical centre of the viewport', () => {
    // jsdom defaults window.innerHeight to 768.
    mockSettings.lineFocus = true
    mockSettings.lineFocusHeight = 48
    renderHook(() => useLineFocusApplier())

    const band = getRoot()!.querySelector('.bonita-focus-band') as HTMLElement
    // Centre = 768/2 = 384; bandTop = 384 - 48/2 = 360
    expect(band.style.top).toBe('360px')
  })

  it('moves the band to track mousemove clientY', () => {
    mockSettings.lineFocus = true
    mockSettings.lineFocusHeight = 48
    renderHook(() => useLineFocusApplier())

    fireMouseMove(200)

    const band = getRoot()!.querySelector('.bonita-focus-band') as HTMLElement
    // bandTop = 200 - 48/2 = 176
    expect(band.style.top).toBe('176px')
  })

  it('clamps bandTop to 0 when cursor is near the top of the viewport', () => {
    mockSettings.lineFocus = true
    mockSettings.lineFocusHeight = 48
    renderHook(() => useLineFocusApplier())

    fireMouseMove(10) // 10 - 24 = -14 → should clamp to 0

    const top = getRoot()!.querySelectorAll('.bonita-focus-layer')[0] as HTMLElement
    expect(top.style.height).toBe('0px')
  })

  it('positions the bottom layer immediately below the band', () => {
    mockSettings.lineFocus = true
    mockSettings.lineFocusHeight = 60
    renderHook(() => useLineFocusApplier())

    fireMouseMove(300)

    // bandTop = 300 - 30 = 270; bottom.top = 270 + 60 = 330
    const bottom = getRoot()!.querySelectorAll('.bonita-focus-layer')[1] as HTMLElement
    expect(bottom.style.top).toBe('330px')
  })

  it('removes the mousemove listener when the hook unmounts', () => {
    mockSettings.lineFocus = true
    const removeListener = vi.spyOn(window, 'removeEventListener')
    const { unmount } = renderHook(() => useLineFocusApplier())

    unmount()

    expect(removeListener).toHaveBeenCalledWith('mousemove', expect.any(Function))
    removeListener.mockRestore()
  })
})