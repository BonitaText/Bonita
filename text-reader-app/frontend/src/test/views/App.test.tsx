import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import App from '../../content/views/App'
import { useSettings } from '../../content/hooks/useSettings'

// ── Internal constants mirrored from App.tsx (not exported by the component) ──
// If these ever change in the source file, update them here too.
const TRIGGER_SIZE = 58
const DEFAULT_MARGIN = 40
const SESSION_KEY = 'bonita-site-enabled'
const POS_KEY = 'bonita-trigger-pos'

interface TriggerPos {
  left: number
  top: number
  tuckedSide: 'left' | 'right' | null
}

vi.mock('../../content/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}))

// Every tool view is mocked so these tests exercise only App's own wiring —
// dock open/close, drag handling, the site toggle, popup coordination, and
// tool gating — rather than each tool's internal behaviour, which is covered
// by its own test file.
vi.mock('../../content/views/FontSelector', () => ({
  default: (props: { open: boolean; onOpen: () => void }) => (
    <button data-testid="font-selector" data-open={String(props.open)} onClick={props.onOpen} />
  ),
}))
vi.mock('../../content/views/LineFocusToggle', () => ({
  default: (props: { open: boolean; onOpen: () => void }) => (
    <button data-testid="line-focus" data-open={String(props.open)} onClick={props.onOpen} />
  ),
}))
vi.mock('../../content/views/PhraseBolding', () => ({
  default: (props: { open: boolean; onOpen: () => void }) => (
    <button data-testid="phrase-bolding" data-open={String(props.open)} onClick={props.onOpen} />
  ),
}))
vi.mock('../../content/views/POSHighlight', () => ({
  default: (props: { open: boolean; onOpen: () => void }) => (
    <button data-testid="pos-highlight" data-open={String(props.open)} onClick={props.onOpen} />
  ),
}))
vi.mock('../../content/views/WordSimplify', () => ({
  default: (props: { open: boolean; onOpen: () => void }) => (
    <button data-testid="word-simplify" data-open={String(props.open)} onClick={props.onOpen} />
  ),
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
  }
}

let chromeMock: ReturnType<typeof createChromeMock>

/** Installs a chrome.storage mock seeded with the given POS_KEY value. */
function stubChrome(posValue?: TriggerPos) {
  chromeMock = createChromeMock(posValue ? { [POS_KEY]: posValue } : {})
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

beforeEach(() => {
  mockedUseSettings.mockReset()
  sessionStorage.clear()
  stubChrome()
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
    stubChrome({ left: 200, top: 200, tuckedSide: null })
    stubUseSettings()
    const trigger = await renderApp()
    const startLeft = parseFloat(trigger.style.left)

    fireEvent.mouseDown(trigger, { clientX: 100, clientY: 100 })
    fireEvent.mouseMove(document, { clientX: 150, clientY: 100 })
    fireEvent.mouseUp(document)

    expect(parseFloat(trigger.style.left)).toBe(startLeft + 50)
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
    stubChrome({ left: 200, top: 200, tuckedSide: null })
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

    expect(trigger.style.left).toBe(`${window.innerWidth - TRIGGER_SIZE - DEFAULT_MARGIN}px`)
    expect(trigger.style.top).toBe(`${window.innerHeight - TRIGGER_SIZE - DEFAULT_MARGIN}px`)
  })

  it('restores a previously saved position from chrome.storage.local', async () => {
    stubChrome({ left: 123, top: 456, tuckedSide: null })
    stubUseSettings()
    const trigger = await renderApp()

    expect(trigger.style.left).toBe('123px')
    expect(trigger.style.top).toBe('456px')
  })

  it('persists the new position to chrome.storage.local after a drag', async () => {
    stubChrome({ left: 200, top: 200, tuckedSide: null })
    stubUseSettings()
    const trigger = await renderApp()
    const startLeft = parseFloat(trigger.style.left)

    fireEvent.mouseDown(trigger, { clientX: 100, clientY: 100 })
    fireEvent.mouseMove(document, { clientX: 150, clientY: 100 })
    fireEvent.mouseUp(document)

    expect(chromeMock.storage.local.set).toHaveBeenCalledWith({
      [POS_KEY]: expect.objectContaining({ left: startLeft + 50 }),
    })
  })

  it('does not write to chrome.storage.local on every drag frame, only on release', async () => {
    stubChrome({ left: 200, top: 200, tuckedSide: null })
    stubUseSettings()
    const trigger = await renderApp()

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
    stubChrome({ left: 100, top: 100, tuckedSide: null })
    stubUseSettings()
    const trigger = await renderApp()
    expect(trigger.style.left).toBe('100px')

    // Simulate a write from another tab by calling the mocked storage
    // directly — the mock fires onChanged listeners synchronously, exactly
    // like every open tab would receive it in real Chrome.
    await chromeMock.storage.local.set({ [POS_KEY]: { left: 300, top: 250, tuckedSide: null } })

    await waitFor(() => {
      expect(trigger.style.left).toBe('300px')
      expect(trigger.style.top).toBe('250px')
    })
  })

  it('mirrors a tuck from another tab, including closing this tab’s dock', async () => {
    stubChrome({ left: 200, top: 200, tuckedSide: null })
    stubUseSettings()
    const trigger = await renderApp()

    fireEvent.mouseDown(trigger, { clientX: 100, clientY: 100 })
    fireEvent.mouseUp(document)
    expect(trigger).toHaveClass('open')

    await chromeMock.storage.local.set({ [POS_KEY]: { left: 0, top: 200, tuckedSide: 'left' } })

    await waitFor(() => {
      expect(trigger).toHaveClass('tucked-left')
    })
  })

  it('ignores an incoming cross-tab update while a drag is in progress locally', async () => {
    stubChrome({ left: 100, top: 100, tuckedSide: null })
    stubUseSettings()
    const trigger = await renderApp()

    fireEvent.mouseDown(trigger, { clientX: 100, clientY: 100 })
    fireEvent.mouseMove(document, { clientX: 150, clientY: 100 }) // local drag now at left=150

    // Another tab reports an unrelated position mid-drag.
    await chromeMock.storage.local.set({ [POS_KEY]: { left: 999, top: 999, tuckedSide: null } })

    // The in-progress local drag must not be clobbered by the incoming sync.
    expect(trigger.style.left).toBe('150px')

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
    stubChrome({ left: 900, top: 700, tuckedSide: null })
    stubUseSettings()
    const trigger = await renderApp()
    expect(trigger.style.left).toBe('900px')

    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 400 })
    Object.defineProperty(window, 'innerHeight', { writable: true, configurable: true, value: 300 })
    fireEvent(window, new Event('resize'))

    expect(parseFloat(trigger.style.left)).toBeLessThanOrEqual(400 - TRIGGER_SIZE)
    expect(parseFloat(trigger.style.top)).toBeLessThanOrEqual(300 - TRIGGER_SIZE)
  })

  it('does not write the resize-clamped position to chrome.storage.local', async () => {
    stubChrome({ left: 900, top: 700, tuckedSide: null })
    stubUseSettings()
    await renderApp()
    chromeMock.storage.local.set.mockClear()

    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 400 })
    fireEvent(window, new Event('resize'))

    expect(chromeMock.storage.local.set).not.toHaveBeenCalled()
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

  it('opens a tool popup when that tool reports a click', () => {
    fireEvent.click(screen.getByTestId('pos-highlight'))
    expect(screen.getByTestId('pos-highlight')).toHaveAttribute('data-open', 'true')
  })

  it('closes the open popup when the same tool is clicked again', () => {
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