import { describe, it, expect, vi, beforeEach } from 'vitest'
import { StrictMode } from 'react'

const renderMock = vi.fn()
const createRootMock = vi.fn(() => ({ render: renderMock }))

vi.mock('react-dom/client', () => ({
  createRoot: createRootMock,
}))

// Adjust this path to match the real relative location of popup/App.tsx
// from this test file.
vi.mock('../../popup/App.tsx', () => ({
  default: () => null,
}))

describe('popup entry point (main.tsx)', () => {
  beforeEach(() => {
    vi.resetModules()
    renderMock.mockClear()
    createRootMock.mockClear()
    document.body.innerHTML = '<div id="root"></div>'
  })

  it('mounts into the #root element via createRoot', async () => {
    await import('../../popup/main.tsx')
    const rootEl = document.getElementById('root')

    expect(createRootMock).toHaveBeenCalledTimes(1)
    expect(createRootMock).toHaveBeenCalledWith(rootEl)
  })

  it('calls render exactly once', async () => {
    await import('../../popup/main.tsx')
    expect(renderMock).toHaveBeenCalledTimes(1)
  })

  it('renders App wrapped in StrictMode', async () => {
    await import('../../popup/main.tsx')
    const rendered = renderMock.mock.calls[0][0]

    expect(rendered.type).toBe(StrictMode)
    // The single child of StrictMode should be the App element.
    expect(typeof rendered.props.children.type).toBe('function')
  })
})