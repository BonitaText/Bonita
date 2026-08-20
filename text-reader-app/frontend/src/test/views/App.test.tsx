import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react'
import App from '../../content/views/App'
import { useSettings } from '../../content/hooks/useSettings'

// ── Internal constants mirrored from App.tsx (not exported by the component) ──
// If these ever change in the source file, update them here too.
const TRIGGER_SIZE = 75
const DEFAULT_MARGIN = 40
const SESSION_KEY = 'bonita-site-enabled'
const POS_KEY = 'bonita-trigger-pos'
const DPR_BASELINE_KEY = 'bonita-dpr-baseline'

/**
 * Shape persisted to chrome.storage.local for the trigger's position (see
 * `StoredTriggerPos` in App.tsx). Position is stored as viewport FRACTIONS,
 * not raw px, so it reads back correctly regardless of window size or zoom.
 */
interface StoredTriggerPos {
  leftFrac: number
  topFrac: number
  tuckedSide: 'left' | 'right' | null
}

vi.mock('../../content/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}))

// Every tool view is mocked so these tests exercise only App's own wiring —
// dock open/close, drag handling, the site toggle, popup coordination, and
// tool gating — rather than each tool's internal behaviour, which is covered
// by its own test file.
//
// Each mock mirrors the real click-toggle-then-show/hide shape (first click
// calls onShow, a second click on the same mock calls onHide) so the
// popup-coordination tests below still exercise App's showPopup/hidePopup
// logic the same way real tool clicks would, without needing App itself to
// know or care that the mocks are simplified.
type ToolMockProps = { open: boolean; onShow: () => void; onHide: () => void }

function ToolMock({ testId, open, onShow, onHide }: ToolMockProps & { testId: string }) {
  const [on, setOn] = useState(false)
  return (
    <button
      data-testid={testId}
      data-open={String(open)}
      onClick={() => {
        const next = !on
        setOn(next)
        if (next) onShow()
        else onHide()
      }}
    />
  )
}

vi.mock('../../content/views/FontSelector', () => ({
  default: (props: ToolMockProps) => <ToolMock testId="font-selector" {...props} />,
}))
vi.mock('../../content/views/LineFocusToggle', () => ({
  default: (props: ToolMockProps) => <ToolMock testId="line-focus" {...props} />,
}))
vi.mock('../../content/views/PhraseBolding', () => ({
  default: (props: ToolMockProps) => <ToolMock testId="phrase-bolding" {...props} />,
}))
vi.mock('../../content/views/POSHighlight', () => ({
  default: (props: ToolMockProps) => <ToolMock testId="pos-highlight" {...props} />,
}))
vi.mock('../../content/views/WordSimplify', () => ({
  default: (props: ToolMockProps) => <ToolMock testId="word-simplify" {...props} />,
}))
vi.mock('../../content/views/SentenceSplitting', () => ({
  default: () => <div data-testid="sentence-splitting" />,
}))
vi.mock('../../content/views/TTSReader', () => ({
  default: () => <div data-testid="tts-reader" />,
}))
vi.mock('../../content/views/ReadingToolsController', () => ({
  default: () => <div data-testid="reading-tools-controller" />,
}))

const mockedUseSettings = vi.mocked(useSettings)

function stubUseSettings(overrides: {
  enabledTools?: Record<string, boolean>
  ready?: boolean
} = {}) {
  const updateSettings = vi.fn()
  mockedUseSettings.mockReturnValue({
    settings: { enabledTools: overrides.enabledTools },
    updateSettings,
    ready: overrides.ready ?? true,
  } as unknown as ReturnType<typeof useSettings>)
  return updateSettings
}

/** Clicks the master site toggle starting from its default "off" state. */
function enableSiteViaClick() {
  fireEvent.click(screen.getByRole('button', { name: 'Enable Bonita on this site' }))
}

/**
 * App.tsx applies `pos.left`/`pos.top` as inline styles on the
 * `.bonita-pos-anchor` div — the trigger button's *parent* — not on the
 * trigger `<button>` itself (the button only carries `--bonita-rotation`).
 * Every test that asserts on-screen position must read from this element,
 * not from `trigger` directly, or `style.left`/`style.top` will be `''`.
 */
function anchorOf(trigger: HTMLElement): HTMLElement {
  return trigger.parentElement as HTMLElement
}

/**
 * Builds a `chrome.storage.local`-shaped stored position from desired CSS
 * px, converting to the viewport-fraction format App.tsx persists (see
 * `toStoredPos`/`applySavedPos` in App.tsx). This is computed against the
 * CURRENT `window.innerWidth`/`innerHeight`, so call it after any
 * test-specific viewport resize and before the position is expected to be
 * read back.
 */
function storedPos(
  leftPx: number,
  topPx: number,
  tuckedSide: StoredTriggerPos['tuckedSide'] = null,
): StoredTriggerPos {
  return {
    leftFrac: leftPx / window.innerWidth,
    topFrac: topPx / window.innerHeight,
    tuckedSide,
  }
}

// ── window.matchMedia mock ──────────────────────────────────────────────────
//
// jsdom doesn't implement matchMedia at all. App.tsx's useZoomCorrection
// hook calls matchMedia() unconditionally on mount (and again on every zoom
// change) to listen for DPR changes, so every test that mounts <App /> needs
// a stub or the mount effect throws `TypeError: matchMedia is not a
// function`, which previously took down every test in this file regardless
// of what it was actually testing.
function createMatchMediaMock() {
  return vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(), // deprecated API, but kept in case anything still calls it
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
}

// ── chrome.storage mock ─────────────────────────────────────────────────────
//
// App.tsx persists trigger position/tuck state to chrome.storage.local (not
// sessionStorage) and listens for chrome.storage.onChanged to sync across
// "tabs". This fake backs both with a single in-memory store and fires
// registered onChanged listeners synchronously whenever `set` is called —
// including from the test itself, which is how the cross-tab sync tests
// simulate "another tab" writing a new position.
//
// `get`'s callback fires via a microtask (Promise.resolve().then), mirroring
// the fact that real chrome.storage callbacks are never synchronous. Tests
// that depend on the initial read resolving must await it — see `renderApp`.
function createChromeMock(initial: Record<string, unknown> = {}) {
  const store: Record<string, unknown> = { ...initial }
  type Listener = (changes: Record<string, { oldValue?: unknown; newValue?: unknown }>, area: string) => void
  const listeners: Listener[] = []

  return {
    storage: {
      local: {
        get: vi.fn((key: string, callback: (result: Record<string, unknown>) => void) => {
          Promise.resolve().then(() => callback({ [key]: store[key] }))
        }),
        set: vi.fn((obj: Record<string, unknown>) => {
          const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {}
          for (const key of Object.keys(obj)) {
            changes[key] = { oldValue: store[key], newValue: obj[key] }
            store[key] = obj[key]
          }
          listeners.forEach(l => l(changes, 'local'))
          return Promise.resolve()
        }),
      },
      onChanged: {
        addListener: vi.fn((l: Listener) => listeners.push(l)),
        removeListener: vi.fn((l: Listener) => {
          const i = listeners.indexOf(l)
          if (i >= 0) listeners.splice(i, 1)
        }),
      },
      // Unused by App.tsx directly (useSettings is mocked in this file), but
      // present so anything reaching for chrome.storage.sync doesn't throw.
      sync: {
        get: vi.fn(() => Promise.resolve({})),
        set: vi.fn(() => Promise.resolve()),
      },
    },
    runtime: {
      getURL: vi.fn((path: string) => path),
    },
  }
}

let chromeMock: ReturnType<typeof createChromeMock>

/**
 * Installs a chrome.storage mock, optionally seeded with a saved trigger
 * position (POS_KEY) and/or a shared DPR baseline (DPR_BASELINE_KEY).
 * Passing neither seeds an empty store, matching a fresh install.
 */
function stubChrome(posValue?: StoredTriggerPos, dprBaseline?: number) {
  const initial: Record<string, unknown> = {}
  if (posValue) initial[POS_KEY] = posValue
  if (dprBaseline !== undefined) initial[DPR_BASELINE_KEY] = dprBaseline
  chromeMock = createChromeMock(initial)
  vi.stubGlobal('chrome', chromeMock)
  return chromeMock
}

/**
 * Renders App and waits for the initial chrome.storage.local read to
 * resolve — App renders nothing but a <style> tag until then (`posReady`),
 * so every test needs to wait past this before querying the trigger, dock,
 * or tools.
 */
async function renderApp() {
  render(<App />)
  const trigger = await screen.findByTitle(/drag to move|Tap to bring back/)
  return trigger as HTMLElement
}

/**
 * `useZoomCorrection` seeds a SHARED DPR baseline into chrome.storage.local
 * on first mount whenever one doesn't already exist (see App.tsx), which
 * means `chrome.storage.local.set` gets one extra, unrelated call on every
 * mount that doesn't pre-seed `DPR_BASELINE_KEY` via `stubChrome`. Tests
 * that assert exact call counts/absence of calls on the POSITION key must
 * wait for that write and clear it first, or they'll flakily see (or miss)
 * it depending on microtask timing. Only call this when the baseline was
 * NOT pre-seeded — otherwise no such write happens and this will time out.
 */
async function settleDprBaselineWrite() {
  await waitFor(() => {
    expect(chromeMock.storage.local.set).toHaveBeenCalled()
  })
  chromeMock.storage.local.set.mockClear()
}

beforeEach(() => {
  mockedUseSettings.mockReset()
  sessionStorage.clear()
  stubChrome()
  vi.stubGlobal('matchMedia', createMatchMediaMock())
})

/**
 * Cleanup ordering matters here and is NOT incidental.
 *
 * App mounts a `chrome.storage.onChanged` listener on mount and removes it
 * on unmount (see App.tsx). `chrome` itself is a per-test global installed
 * via `vi.stubGlobal('chrome', ...)` in `stubChrome()` above, and torn down
 * by `vi.unstubAllGlobals()`.
 *
 * This suite does not call `cleanup()` explicitly in every test — most rely
 * on the next test's `beforeEach`/render cycle, or on React Testing
 * Library's own implicit cleanup, to unmount the previous test's tree.
 * Whether that implicit cleanup is registered at all — and, if so, whether
 * it runs *before or after* this file's own `afterEach` hooks in the same
 * phase — is a function of the Vitest config (specifically `test.globals`)
 * and RTL's environment auto-detection, not something this file controls
 * directly. If `chrome` is unstubbed before every mounted `<App>` has
 * actually unmounted, `App`'s onChanged-listener cleanup effect throws
 * `ReferenceError: chrome is not defined` — and because that throw happens
 * inside a React passive-effect flush, it corrupts the *next* test's
 * act()/render cycle too, producing a cascade of unrelated-looking
 * failures ("not wrapped in act(...)", spurious `chrome is not defined`
 * traces, etc.) far past the test that actually caused it.
 *
 * Calling `cleanup()` explicitly and FIRST — before `vi.unstubAllGlobals()`
 * — makes teardown deterministic instead of depending on implicit/ambient
 * ordering: every component mounted during the test is unmounted (running
 * `chrome.storage.onChanged.removeListener` while `chrome` is still a valid
 * stubbed global) before that global is ever removed.
 */
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('App — trigger click vs. drag', () => {
  const originalWidth = window.innerWidth
  const originalHeight = window.innerHeight

  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: originalWidth })
    Object.defineProperty(window, 'innerHeight', { writable: true, configurable: true, value: originalHeight })
  })

  it('renders the trigger button, closed by default', async () => {
    stubUseSettings()
    const trigger = await renderApp()
    expect(trigger).not.toHaveClass('open')
  })

  it('opens the dock on a plain click (mousedown + mouseup with no movement)', async () => {
    stubUseSettings()
    const trigger = await renderApp()

    fireEvent.mouseDown(trigger, { clientX: 100, clientY: 100 })
    fireEvent.mouseUp(document)

    expect(trigger).toHaveClass('open')
  })

  it('closes the dock on a second click', async () => {
    stubUseSettings()
    const trigger = await renderApp()

    fireEvent.mouseDown(trigger, { clientX: 100, clientY: 100 })
    fireEvent.mouseUp(document)
    expect(trigger).toHaveClass('open')

    fireEvent.mouseDown(trigger, { clientX: 100, clientY: 100 })
    fireEvent.mouseUp(document)
    expect(trigger).not.toHaveClass('open')
  })

  it('does not open the dock when the pointer moves past the drag threshold', async () => {
    stubUseSettings()
    const trigger = await renderApp()

    fireEvent.mouseDown(trigger, { clientX: 100, clientY: 100 })
    fireEvent.mouseMove(document, { clientX: 160, clientY: 100 }) // dx=60 > DRAG_THRESHOLD
    fireEvent.mouseUp(document)

    expect(trigger).not.toHaveClass('open')
  })

  it('repositions the trigger while dragging', async () => {
    stubChrome(storedPos(200, 200))
    stubUseSettings()
    const trigger = await renderApp()
    const startLeft = parseFloat(anchorOf(trigger).style.left)

    fireEvent.mouseDown(trigger, { clientX: 100, clientY: 100 })
    fireEvent.mouseMove(document, { clientX: 150, clientY: 100 })
    fireEvent.mouseUp(document)

    // toBeCloseTo, not toBe: the stored position round-trips through a
    // viewport-fraction conversion (see storedPos), which can introduce
    // negligible floating-point drift depending on window dimensions.
    expect(parseFloat(anchorOf(trigger).style.left)).toBeCloseTo(startLeft + 50, 5)
  })

  it('closes the dock when clicking outside both the trigger and the dock', async () => {
    stubUseSettings()
    const trigger = await renderApp()

    fireEvent.mouseDown(trigger, { clientX: 100, clientY: 100 })
    fireEvent.mouseUp(document)
    expect(trigger).toHaveClass('open')

    fireEvent.mouseDown(document.body, { clientX: 5, clientY: 5 })
    expect(trigger).not.toHaveClass('open')
  })

  it('closes the dock when a drag ends by tucking the trigger against an edge', async () => {
    stubChrome(storedPos(200, 200))
    stubUseSettings()
    const trigger = await renderApp()

    // Open the dock first with a plain click.
    fireEvent.mouseDown(trigger, { clientX: 100, clientY: 100 })
    fireEvent.mouseUp(document)
    expect(trigger).toHaveClass('open')

    // Drag far enough left to land within EDGE_SNAP_THRESHOLD of the edge.
    fireEvent.mouseDown(trigger, { clientX: 300, clientY: 300 })
    fireEvent.mouseMove(document, { clientX: 300 - (200 + TRIGGER_SIZE), clientY: 300 })
    fireEvent.mouseUp(document)

    expect(trigger).toHaveClass('tucked-left')
    expect(trigger).not.toHaveClass('open')
  })
})

describe('App — trigger position persistence (chrome.storage.local)', () => {
  const originalWidth = window.innerWidth
  const originalHeight = window.innerHeight

  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: originalWidth })
    Object.defineProperty(window, 'innerHeight', { writable: true, configurable: true, value: originalHeight })
  })

  it('falls back to the default bottom-right corner when no position is saved', async () => {
    stubUseSettings()
    const trigger = await renderApp()

    expect(anchorOf(trigger).style.left).toBe(`${window.innerWidth - TRIGGER_SIZE - DEFAULT_MARGIN}px`)
    expect(anchorOf(trigger).style.top).toBe(`${window.innerHeight - TRIGGER_SIZE - DEFAULT_MARGIN}px`)
  })

  it('restores a previously saved position from chrome.storage.local', async () => {
    stubChrome(storedPos(123, 456))
    stubUseSettings()
    const trigger = await renderApp()

    expect(parseFloat(anchorOf(trigger).style.left)).toBeCloseTo(123, 5)
    expect(parseFloat(anchorOf(trigger).style.top)).toBeCloseTo(456, 5)
  })

  it('ignores a stored value that is missing leftFrac/topFrac (e.g. a stale raw-px entry)', async () => {
    // Defensive fallback in applySavedPos: a malformed/legacy stored value
    // must not produce NaN positions or crash — it should just be skipped,
    // leaving the trigger at its default corner.
    stubChrome({ left: 123, top: 456 } as unknown as StoredTriggerPos)
    stubUseSettings()
    const trigger = await renderApp()

    expect(anchorOf(trigger).style.left).toBe(`${window.innerWidth - TRIGGER_SIZE - DEFAULT_MARGIN}px`)
    expect(anchorOf(trigger).style.top).toBe(`${window.innerHeight - TRIGGER_SIZE - DEFAULT_MARGIN}px`)
  })

  it('persists the new position to chrome.storage.local, as viewport fractions, after a drag', async () => {
    stubChrome(storedPos(200, 200))
    stubUseSettings()
    const trigger = await renderApp()
    const startLeft = parseFloat(anchorOf(trigger).style.left)

    fireEvent.mouseDown(trigger, { clientX: 100, clientY: 100 })
    fireEvent.mouseMove(document, { clientX: 150, clientY: 100 })
    fireEvent.mouseUp(document)

    const expectedLeftFrac = (startLeft + 50) / window.innerWidth
    expect(chromeMock.storage.local.set).toHaveBeenCalledWith({
      [POS_KEY]: expect.objectContaining({
        leftFrac: expect.closeTo(expectedLeftFrac, 5),
      }),
    })
  })

  it('does not write to chrome.storage.local on every drag frame, only on release', async () => {
    stubChrome(storedPos(200, 200))
    stubUseSettings()
    const trigger = await renderApp()
    await settleDprBaselineWrite()

    fireEvent.mouseDown(trigger, { clientX: 100, clientY: 100 })
    fireEvent.mouseMove(document, { clientX: 110, clientY: 100 })
    fireEvent.mouseMove(document, { clientX: 130, clientY: 100 })
    fireEvent.mouseMove(document, { clientX: 150, clientY: 100 })

    expect(chromeMock.storage.local.set).not.toHaveBeenCalled()

    fireEvent.mouseUp(document)
    expect(chromeMock.storage.local.set).toHaveBeenCalledTimes(1)
  })
})

describe('App — cross-tab position sync (chrome.storage.onChanged)', () => {
  const originalWidth = window.innerWidth
  const originalHeight = window.innerHeight

  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: originalWidth })
    Object.defineProperty(window, 'innerHeight', { writable: true, configurable: true, value: originalHeight })
  })

  it('updates the trigger position live when another tab writes a new position', async () => {
    stubChrome(storedPos(100, 100))
    stubUseSettings()
    const trigger = await renderApp()
    expect(parseFloat(anchorOf(trigger).style.left)).toBeCloseTo(100, 5)

    // Simulate a write from another tab by calling the mocked storage
    // directly — the mock fires onChanged listeners synchronously, exactly
    // like every open tab would receive it in real Chrome. Wrapped in act()
    // since it synchronously triggers a React state update outside of an
    // event handler / RTL fire* helper.
    await act(async () => {
      await chromeMock.storage.local.set({ [POS_KEY]: storedPos(300, 250) })
    })

    await waitFor(() => {
      expect(parseFloat(anchorOf(trigger).style.left)).toBeCloseTo(300, 5)
      expect(parseFloat(anchorOf(trigger).style.top)).toBeCloseTo(250, 5)
    })
  })

  it('mirrors a tuck from another tab, including closing this tab’s dock', async () => {
    stubChrome(storedPos(200, 200))
    stubUseSettings()
    const trigger = await renderApp()

    fireEvent.mouseDown(trigger, { clientX: 100, clientY: 100 })
    fireEvent.mouseUp(document)
    expect(trigger).toHaveClass('open')

    await act(async () => {
      await chromeMock.storage.local.set({ [POS_KEY]: storedPos(0, 200, 'left') })
    })

    await waitFor(() => {
      expect(trigger).toHaveClass('tucked-left')
    })
  })

  it('ignores an incoming cross-tab update while a drag is in progress locally', async () => {
    stubChrome(storedPos(100, 100))
    stubUseSettings()
    const trigger = await renderApp()

    fireEvent.mouseDown(trigger, { clientX: 100, clientY: 100 })
    fireEvent.mouseMove(document, { clientX: 150, clientY: 100 }) // local drag now at left=150

    // Another tab reports an unrelated position mid-drag.
    await act(async () => {
      await chromeMock.storage.local.set({ [POS_KEY]: storedPos(999, 999) })
    })

    // The in-progress local drag must not be clobbered by the incoming sync.
    expect(parseFloat(anchorOf(trigger).style.left)).toBeCloseTo(150, 5)

    fireEvent.mouseUp(document)
  })

  it('removes the onChanged listener on unmount', async () => {
    stubUseSettings()
    const { unmount } = render(<App />)
    await screen.findByTitle(/drag to move|Tap to bring back/)

    expect(chromeMock.storage.onChanged.removeListener).not.toHaveBeenCalled()
    unmount()
    expect(chromeMock.storage.onChanged.removeListener).toHaveBeenCalled()
  })
})

describe('App — viewport resize', () => {
  const originalWidth = window.innerWidth
  const originalHeight = window.innerHeight

  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: originalWidth })
    Object.defineProperty(window, 'innerHeight', { writable: true, configurable: true, value: originalHeight })
  })

  it('re-clamps the trigger position when the viewport shrinks', async () => {
    stubChrome(storedPos(900, 700))
    stubUseSettings()
    const trigger = await renderApp()
    expect(parseFloat(anchorOf(trigger).style.left)).toBeCloseTo(900, 5)

    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 400 })
    Object.defineProperty(window, 'innerHeight', { writable: true, configurable: true, value: 300 })
    fireEvent(window, new Event('resize'))

    expect(parseFloat(anchorOf(trigger).style.left)).toBeLessThanOrEqual(400 - TRIGGER_SIZE)
    expect(parseFloat(anchorOf(trigger).style.top)).toBeLessThanOrEqual(300 - TRIGGER_SIZE)
  })

  it('does not write the resize-clamped position to chrome.storage.local', async () => {
    stubChrome(storedPos(900, 700))
    stubUseSettings()
    await renderApp()
    await settleDprBaselineWrite()

    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 400 })
    fireEvent(window, new Event('resize'))

    expect(chromeMock.storage.local.set).not.toHaveBeenCalled()
  })
})

describe('App — shared DPR baseline (zoom size correction)', () => {
  it('seeds the shared DPR baseline in chrome.storage.local when none exists yet', async () => {
    stubUseSettings()
    await renderApp()

    await waitFor(() => {
      expect(chromeMock.storage.local.set).toHaveBeenCalledWith({
        [DPR_BASELINE_KEY]: window.devicePixelRatio,
      })
    })
  })

  it('uses an existing shared baseline instead of this tab’s own load-time DPR, and does not overwrite it', async () => {
    // Simulates a baseline seeded earlier by a different tab at 2x zoom;
    // this tab "loads" at the default devicePixelRatio, so it should scale
    // itself up to match rather than treating its own DPR as normal.
    stubChrome(undefined, 2)
    stubUseSettings()
    const trigger = await renderApp()
    const anchor = trigger.parentElement as HTMLElement

    await waitFor(() => {
      expect(anchor.style.getPropertyValue('--bonita-zoom')).toBe(String(2 / window.devicePixelRatio))
    })

    expect(chromeMock.storage.local.set).not.toHaveBeenCalledWith(
      expect.objectContaining({ [DPR_BASELINE_KEY]: expect.anything() }),
    )
  })
})

describe('App — master site toggle', () => {
  it('defaults to disabled for a hostname with no saved state', async () => {
    stubUseSettings()
    await renderApp()
    expect(screen.getByRole('button', { name: 'Enable Bonita on this site' })).toHaveClass('off')
  })

  it('enables the site on click and persists it to sessionStorage', async () => {
    stubUseSettings()
    await renderApp()
    enableSiteViaClick()

    expect(screen.getByRole('button', { name: 'Disable Bonita on this site' })).toHaveClass('on')
    const saved = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? '{}')
    expect(saved[location.hostname]).toBe(true)
  })

  it('disables the site on a second click and persists it', async () => {
    stubUseSettings()
    await renderApp()
    enableSiteViaClick()
    fireEvent.click(screen.getByRole('button', { name: 'Disable Bonita on this site' }))

    expect(screen.getByRole('button', { name: 'Enable Bonita on this site' })).toHaveClass('off')
    const saved = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? '{}')
    expect(saved[location.hostname]).toBe(false)
  })

  it('defers the settings reset on disable until after the deferred timeout', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const updateSettings = stubUseSettings()
    await renderApp()

    enableSiteViaClick()
    fireEvent.click(screen.getByRole('button', { name: 'Disable Bonita on this site' }))

    // Not called synchronously — only scheduled via setTimeout(fn, 0).
    expect(updateSettings).not.toHaveBeenCalled()

    vi.runAllTimers()
    expect(updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({ font: 'default', wordSimplification: false, wordComplexity: 'medium' })
    )
    vi.useRealTimers()
  })
})

describe('App — tool mounting gated by siteEnabled && ready', () => {
  it('does not render any tool when the site is disabled', async () => {
    stubUseSettings({ ready: true })
    await renderApp()
    expect(screen.queryByTestId('font-selector')).not.toBeInTheDocument()
    expect(screen.queryByTestId('pos-highlight')).not.toBeInTheDocument()
  })

  it('does not render any tool while settings are not yet ready, even if the site is enabled', async () => {
    stubUseSettings({ ready: false })
    await renderApp()
    enableSiteViaClick()
    expect(screen.queryByTestId('font-selector')).not.toBeInTheDocument()
  })

  it('renders the tools once the site is enabled and settings are ready', async () => {
    stubUseSettings({ ready: true })
    await renderApp()
    enableSiteViaClick()

    expect(screen.getByTestId('font-selector')).toBeInTheDocument()
    expect(screen.getByTestId('reading-tools-controller')).toBeInTheDocument()
  })
})

describe('App — per-tool visibility via settings.enabledTools', () => {
  it('shows every tool by default when enabledTools is absent', async () => {
    stubUseSettings({ ready: true })
    await renderApp()
    enableSiteViaClick()

    expect(screen.getByTestId('sentence-splitting')).toBeInTheDocument()
    expect(screen.getByTestId('phrase-bolding')).toBeInTheDocument()
    expect(screen.getByTestId('word-simplify')).toBeInTheDocument()
    expect(screen.getByTestId('pos-highlight')).toBeInTheDocument()
    expect(screen.getByTestId('line-focus')).toBeInTheDocument()
    expect(screen.getByTestId('tts-reader')).toBeInTheDocument()
    expect(screen.getByTestId('font-selector')).toBeInTheDocument() // never gated by enabledTools
  })

  it('hides an individual tool whose enabledTools flag is false, without affecting the others', async () => {
    stubUseSettings({
      ready: true,
      enabledTools: {
        sentenceSplitting: true,
        keywordBolding: true,
        wordSimplification: true,
        pos: false,
        lineFocus: true,
        tts: true,
        font: true,
      },
    })
    await renderApp()
    enableSiteViaClick()

    expect(screen.queryByTestId('pos-highlight')).not.toBeInTheDocument()
    expect(screen.getByTestId('sentence-splitting')).toBeInTheDocument()
    expect(screen.getByTestId('font-selector')).toBeInTheDocument()
  })
})

describe('App — popup coordination across tools', () => {
  beforeEach(async () => {
    stubUseSettings({ ready: true })
    await renderApp()
    enableSiteViaClick()
  })

  it('opens a tool popup when that tool reports a show (first click, mirroring turning the tool on)', () => {
    fireEvent.click(screen.getByTestId('pos-highlight'))
    expect(screen.getByTestId('pos-highlight')).toHaveAttribute('data-open', 'true')
  })

  it('closes the open popup when the same tool reports a hide (second click, mirroring turning the tool off)', () => {
    fireEvent.click(screen.getByTestId('pos-highlight'))
    fireEvent.click(screen.getByTestId('pos-highlight'))
    expect(screen.getByTestId('pos-highlight')).toHaveAttribute('data-open', 'false')
  })

  it('switches to a different popup, closing the previous one', () => {
    fireEvent.click(screen.getByTestId('pos-highlight'))
    fireEvent.click(screen.getByTestId('font-selector'))

    expect(screen.getByTestId('pos-highlight')).toHaveAttribute('data-open', 'false')
    expect(screen.getByTestId('font-selector')).toHaveAttribute('data-open', 'true')
  })

  it('clicking sentence-splitting or tts (no popup) closes any currently open popup', () => {
    fireEvent.click(screen.getByTestId('pos-highlight'))
    expect(screen.getByTestId('pos-highlight')).toHaveAttribute('data-open', 'true')

    fireEvent.click(screen.getByTestId('sentence-splitting'))
    expect(screen.getByTestId('pos-highlight')).toHaveAttribute('data-open', 'false')
  })
})