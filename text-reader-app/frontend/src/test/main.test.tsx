import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { waitFor } from '@testing-library/react'
import { StrictMode } from 'react'

const renderMock = vi.fn()
const createRootMock = vi.fn(() => ({ render: renderMock }))

vi.mock('react-dom/client', () => ({
  createRoot: createRootMock,
}))

vi.mock('../../content/views/App.tsx', () => ({
  default: () => null,
}))

vi.mock('../../content/providers/SettingsProvider.tsx', () => ({
  SettingsProvider: ({ children }: { children: React.ReactNode }) => children,
}))

const waitForMount = () =>
  waitFor(
    () => {
      expect(document.getElementById('bonita-root')).not.toBeNull()
    },
    { timeout: 5000, interval: 50 },
  )

const settle = () => new Promise((resolve) => setTimeout(resolve, 50))

describe('content script entry point (main.tsx)', () => {
  const originalTop = window.top

  beforeAll(async () => {
    // Warm the transform cache for the real + mocked modules main.tsx
    // dynamically imports, so individual tests below aren't the first to
    // pay that cold-compile cost against their waitFor() timeout.
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
  })

  afterEach(() => {
    Object.defineProperty(window, 'top', { value: originalTop, configurable: true })
  })

  it('does nothing when running inside an iframe (window !== window.top)', async () => {
    Object.defineProperty(window, 'top', { value: {}, configurable: true })

    await import('../content/main.tsx')
    await settle()

    expect(document.getElementById('bonita-root')).toBeNull()
    expect(createRootMock).not.toHaveBeenCalled()
  })

  it('creates and appends the #bonita-root container to document.body in the top frame', async () => {
    await import('../content/main.tsx')
    await waitForMount()

    const container = document.getElementById('bonita-root')
    expect(container).toHaveAttribute('data-bonita-root', 'true')
    expect(container?.parentElement).toBe(document.body)
  })

  it('applies full-viewport, top-layer, pointer-events-none inline styles', async () => {
    await import('../content/main.tsx')
    await waitForMount()

    const container = document.getElementById('bonita-root') as HTMLElement
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

    const container = document.getElementById('bonita-root')
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