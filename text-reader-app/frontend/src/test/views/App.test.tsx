import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import App from '../../content/views/App'
import { useSettings } from '../../content/hooks/useSettings'

// ── Internal constants mirrored from App.tsx (not exported by the component) ──
// If these ever change in the source file, update them here too.
const TRIGGER_SIZE = 58
const DEFAULT_MARGIN = 40
const SESSION_KEY = 'bonita-site-enabled'
const POS_KEY = 'bonita-trigger-pos'

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

beforeEach(() => {
  mockedUseSettings.mockReset()
  sessionStorage.clear()
})

describe('App — trigger click vs. drag', () => {
  const originalWidth = window.innerWidth
  const originalHeight = window.innerHeight

  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: originalWidth })
    Object.defineProperty(window, 'innerHeight', { writable: true, configurable: true, value: originalHeight })
  })
  it('renders the trigger button, closed by default', () => {
    stubUseSettings()
    render(<App />)
    expect(screen.getByTitle('drag to move')).not.toHaveClass('open')
  })

  it('opens the dock on a plain click (mousedown + mouseup with no movement)', () => {
    stubUseSettings()
    render(<App />)
    const trigger = screen.getByTitle('drag to move')

    fireEvent.mouseDown(trigger, { clientX: 100, clientY: 100 })
    fireEvent.mouseUp(document)

    expect(trigger).toHaveClass('open')
  })

  it('closes the dock on a second click', () => {
    stubUseSettings()
    render(<App />)
    const trigger = screen.getByTitle('drag to move')

    fireEvent.mouseDown(trigger, { clientX: 100, clientY: 100 })
    fireEvent.mouseUp(document)
    expect(trigger).toHaveClass('open')

    fireEvent.mouseDown(trigger, { clientX: 100, clientY: 100 })
    fireEvent.mouseUp(document)
    expect(trigger).not.toHaveClass('open')
  })

  it('does not open the dock when the pointer moves past the drag threshold', () => {
    stubUseSettings()
    render(<App />)
    const trigger = screen.getByTitle('drag to move')

    fireEvent.mouseDown(trigger, { clientX: 100, clientY: 100 })
    fireEvent.mouseMove(document, { clientX: 160, clientY: 100 }) // dx=60 > DRAG_THRESHOLD
    fireEvent.mouseUp(document)

    expect(trigger).not.toHaveClass('open')
  })

  it('repositions the trigger while dragging', () => {
    sessionStorage.setItem(POS_KEY, JSON.stringify({ left: 200, top: 200 }))
    stubUseSettings()
    render(<App />)
    const trigger = screen.getByTitle('drag to move') as HTMLElement
    const startLeft = parseFloat(trigger.style.left)

    fireEvent.mouseDown(trigger, { clientX: 100, clientY: 100 })
    fireEvent.mouseMove(document, { clientX: 150, clientY: 100 })
    fireEvent.mouseUp(document)

    expect(parseFloat(trigger.style.left)).toBe(startLeft + 50)
  })


  it('closes the dock when clicking outside both the trigger and the dock', () => {
    stubUseSettings()
    render(<App />)
    const trigger = screen.getByTitle('drag to move')

    fireEvent.mouseDown(trigger, { clientX: 100, clientY: 100 })
    fireEvent.mouseUp(document)
    expect(trigger).toHaveClass('open')

    fireEvent.mouseDown(document.body, { clientX: 5, clientY: 5 })
    expect(trigger).not.toHaveClass('open')
  })
})

describe('App — trigger position persistence', () => {
  const originalWidth = window.innerWidth
  const originalHeight = window.innerHeight

  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: originalWidth })
    Object.defineProperty(window, 'innerHeight', { writable: true, configurable: true, value: originalHeight })
  })

  it('falls back to the default bottom-right corner when no position is saved', () => {
    stubUseSettings()
    render(<App />)
    const trigger = screen.getByTitle('drag to move') as HTMLElement

    expect(trigger.style.left).toBe(`${window.innerWidth - TRIGGER_SIZE - DEFAULT_MARGIN}px`)
    expect(trigger.style.top).toBe(`${window.innerHeight - TRIGGER_SIZE - DEFAULT_MARGIN}px`)
  })

  it('restores a previously saved position from sessionStorage', () => {
    sessionStorage.setItem(POS_KEY, JSON.stringify({ left: 123, top: 456 }))
    stubUseSettings()
    render(<App />)
    const trigger = screen.getByTitle('drag to move') as HTMLElement

    expect(trigger.style.left).toBe('123px')
    expect(trigger.style.top).toBe('456px')
  })

  it('persists the new position to sessionStorage after a drag', () => {
    sessionStorage.setItem(POS_KEY, JSON.stringify({ left: 200, top: 200 }))
    stubUseSettings()
    render(<App />)
    const trigger = screen.getByTitle('drag to move') as HTMLElement
    const startLeft = parseFloat(trigger.style.left)

    fireEvent.mouseDown(trigger, { clientX: 100, clientY: 100 })
    fireEvent.mouseMove(document, { clientX: 150, clientY: 100 })
    fireEvent.mouseUp(document)

    const saved = JSON.parse(sessionStorage.getItem(POS_KEY) ?? '{}')
    expect(saved.left).toBe(startLeft + 50)
  })
})

describe('App — viewport resize', () => {
  const originalWidth = window.innerWidth
  const originalHeight = window.innerHeight

  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: originalWidth })
    Object.defineProperty(window, 'innerHeight', { writable: true, configurable: true, value: originalHeight })
  })

  it('re-clamps the trigger position when the viewport shrinks', () => {
    sessionStorage.setItem(POS_KEY, JSON.stringify({ left: 900, top: 700 }))
    stubUseSettings()
    render(<App />)
    const trigger = screen.getByTitle('drag to move') as HTMLElement
    expect(trigger.style.left).toBe('900px')

    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 400 })
    Object.defineProperty(window, 'innerHeight', { writable: true, configurable: true, value: 300 })
    fireEvent(window, new Event('resize'))

    expect(parseFloat(trigger.style.left)).toBeLessThanOrEqual(400 - TRIGGER_SIZE)
    expect(parseFloat(trigger.style.top)).toBeLessThanOrEqual(300 - TRIGGER_SIZE)
  })
})

describe('App — master site toggle', () => {
  it('defaults to disabled for a hostname with no saved state', () => {
    stubUseSettings()
    render(<App />)
    expect(screen.getByRole('button', { name: 'Enable Bonita on this site' })).toHaveClass('off')
  })

  it('enables the site on click and persists it to sessionStorage', () => {
    stubUseSettings()
    render(<App />)
    enableSiteViaClick()

    expect(screen.getByRole('button', { name: 'Disable Bonita on this site' })).toHaveClass('on')
    const saved = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? '{}')
    expect(saved[location.hostname]).toBe(true)
  })

  it('disables the site on a second click and persists it', () => {
    stubUseSettings()
    render(<App />)
    enableSiteViaClick()
    fireEvent.click(screen.getByRole('button', { name: 'Disable Bonita on this site' }))

    expect(screen.getByRole('button', { name: 'Enable Bonita on this site' })).toHaveClass('off')
    const saved = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? '{}')
    expect(saved[location.hostname]).toBe(false)
  })

  it('defers the settings reset on disable until after the deferred timeout', () => {
    vi.useFakeTimers()
    const updateSettings = stubUseSettings()
    render(<App />)

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
  it('does not render any tool when the site is disabled', () => {
    stubUseSettings({ ready: true })
    render(<App />)
    expect(screen.queryByTestId('font-selector')).not.toBeInTheDocument()
    expect(screen.queryByTestId('pos-highlight')).not.toBeInTheDocument()
  })

  it('does not render any tool while settings are not yet ready, even if the site is enabled', () => {
    stubUseSettings({ ready: false })
    render(<App />)
    enableSiteViaClick()
    expect(screen.queryByTestId('font-selector')).not.toBeInTheDocument()
  })

  it('renders the tools once the site is enabled and settings are ready', () => {
    stubUseSettings({ ready: true })
    render(<App />)
    enableSiteViaClick()

    expect(screen.getByTestId('font-selector')).toBeInTheDocument()
    expect(screen.getByTestId('reading-tools-controller')).toBeInTheDocument()
  })
})

describe('App — per-tool visibility via settings.enabledTools', () => {
  it('shows every tool by default when enabledTools is absent', () => {
    stubUseSettings({ ready: true })
    render(<App />)
    enableSiteViaClick()

    expect(screen.getByTestId('sentence-splitting')).toBeInTheDocument()
    expect(screen.getByTestId('phrase-bolding')).toBeInTheDocument()
    expect(screen.getByTestId('word-simplify')).toBeInTheDocument()
    expect(screen.getByTestId('pos-highlight')).toBeInTheDocument()
    expect(screen.getByTestId('line-focus')).toBeInTheDocument()
    expect(screen.getByTestId('tts-reader')).toBeInTheDocument()
    expect(screen.getByTestId('font-selector')).toBeInTheDocument() // never gated by enabledTools
  })

  it('hides an individual tool whose enabledTools flag is false, without affecting the others', () => {
    stubUseSettings({
      ready: true,
      enabledTools: {
        sentenceSplitting: true,
        keywordBolding: true,
        wordSimplification: true,
        pos: false,
        lineFocus: true,
        tts: true,
      },
    })
    render(<App />)
    enableSiteViaClick()

    expect(screen.queryByTestId('pos-highlight')).not.toBeInTheDocument()
    expect(screen.getByTestId('sentence-splitting')).toBeInTheDocument()
    expect(screen.getByTestId('font-selector')).toBeInTheDocument()
  })
})

describe('App — popup coordination across tools', () => {
  beforeEach(() => {
    stubUseSettings({ ready: true })
    render(<App />)
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