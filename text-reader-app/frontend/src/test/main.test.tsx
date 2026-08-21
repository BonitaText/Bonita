import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { waitFor } from '@testing-library/react'
import { StrictMode } from 'react'

const renderMock = vi.fn()
const createRootMock = vi.fn(() => ({ render: renderMock }))

vi.mock('react-dom/client', () => ({
  createRoot: createRootMock,
}))

vi.mock('../content/views/App.tsx', () => ({
  default: () => null,
}))

vi.mock('../content/providers/SettingsProvider.tsx', () => ({
  SettingsProvider: ({ children }: { children: React.ReactNode }) => children,
}))

/**
 * main.tsx mounts #bonita-root INSIDE a shadow root attached to a separate
 * #bonita-shadow-host element (for CSS isolation from the host page) — not
 * directly into document.body. document.getElementById cannot see into
 * shadow roots at all (that's the encapsulation working as intended), so
 * every lookup here goes: find the host in the light DOM, then read
 * `.shadowRoot`, then query inside that.
 */
const getShadowHost = (): HTMLElement | null =>
  document.getElementById('bonita-shadow-host')

const getContainer = (): HTMLElement | null =>
  getShadowHost()?.shadowRoot?.getElementById('bonita-root') ?? null

const waitForMount = () =>
  waitFor(
    () => {
      expect(getContainer()).not.toBeNull()
    },
    { timeout: 5000, interval: 50 },
  )

const settle = () => new Promise((resolve) => setTimeout(resolve, 50))

// Defensive backup: even with the mock paths fixed above, stub matchMedia
// so any future real (unmocked) import of App.tsx in this file degrades
// gracefully instead of hanging on a TypeError inside a passive effect.
function createMatchMediaMock() {
  return vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
}

describe('content script entry point (main.tsx)', () => {
  const originalTop = window.top

  beforeAll(async () => {
    // Warm the transform cache for the real + mocked modules main.tsx
    // dynamically imports, so individual tests below aren't the first to
    // pay that cold-compile cost against their waitFor() timeout.
    // These paths match the vi.mock() paths above and the dynamic
    // `await import('../content/main.tsx')` calls in each test — one
    // level up from this file, not two.
    await import('react')
    await import('react-dom/client')
    await import('../content/views/App.tsx')
    await import('../content/providers/SettingsProvider.tsx')
  })

  beforeEach(() => {
    vi.resetModules()
    renderMock.mockClear()
    createRootMock.mockClear()
    document.body.innerHTML = ''
    vi.stubGlobal('matchMedia', createMatchMediaMock())
  })

  afterEach(() => {
    Object.defineProperty(window, 'top', { value: originalTop, configurable: true })
    vi.unstubAllGlobals()
  })

  it('does nothing when running inside an iframe (window !== window.top)', async () => {
    Object.defineProperty(window, 'top', { value: {}, configurable: true })
    await import('../content/main.tsx')
    await settle()
    expect(getShadowHost()).toBeNull()
    expect(createRootMock).not.toHaveBeenCalled()
  }, 10000) // ← second arg bumps this test's timeout to 10s

  it('creates a shadow-hosted #bonita-root container in the top frame', async () => {
    await import('../content/main.tsx')
    await waitForMount()

    const host = getShadowHost()
    expect(host).not.toBeNull()
    expect(host?.parentElement).toBe(document.body)
    expect(host?.shadowRoot?.mode).toBe('open')

    const container = getContainer()
    expect(container).toHaveAttribute('data-bonita-root', 'true')
    // The container's parent is the ShadowRoot itself, not an Element, so
    // `parentElement` is null here by spec — `parentNode` is the right
    // check for "is this actually attached inside the shadow root".
    expect(container?.parentNode).toBe(host?.shadowRoot)
  })

  it('applies full-viewport, top-layer, pointer-events-none inline styles', async () => {
    await import('../content/main.tsx')
    await waitForMount()

    const container = getContainer() as HTMLElement
    expect(container.style.position).toBe('fixed')
    expect(container.style.top).toBe('0px')
    expect(container.style.left).toBe('0px')
    expect(container.style.width).toBe('100%')
    expect(container.style.height).toBe('100%')
    expect(container.style.zIndex).toBe('2147483647')
    expect(container.style.pointerEvents).toBe('none')
  })

  it('mounts via createRoot on the injected container', async () => {
    await import('../content/main.tsx')
    await waitForMount()

    const container = getContainer()
    expect(createRootMock).toHaveBeenCalledTimes(1)
    expect(createRootMock).toHaveBeenCalledWith(container)
    expect(renderMock).toHaveBeenCalledTimes(1)
  })

  it('renders App nested inside SettingsProvider inside StrictMode', async () => {
    await import('../content/main.tsx')
    await waitForMount()

    const rendered = renderMock.mock.calls[0][0]
    expect(rendered.type).toBe(StrictMode)

    const settingsProviderEl = rendered.props.children
    expect(typeof settingsProviderEl.type).toBe('function')

    const appEl = settingsProviderEl.props.children
    expect(typeof appEl.type).toBe('function')
  })
})