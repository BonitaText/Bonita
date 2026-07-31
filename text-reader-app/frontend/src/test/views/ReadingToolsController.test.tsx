import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import ReadingToolsController from '../../content/views/ReadingToolsController'
import { useReadingTools } from '../../content/hooks/useReadingTools'

vi.mock('../../content/hooks/useReadingTools', () => ({
  useReadingTools: vi.fn(),
}))

const mockedUseReadingTools = vi.mocked(useReadingTools)

describe('ReadingToolsController', () => {
  beforeEach(() => {
    mockedUseReadingTools.mockReset()
  })

  it('invokes useReadingTools on mount', () => {
    render(<ReadingToolsController />)
    expect(mockedUseReadingTools).toHaveBeenCalledTimes(1)
  })

  it('renders nothing to the DOM', () => {
    const { container } = render(<ReadingToolsController />)
    expect(container).toBeEmptyDOMElement()
  })

  it('unmounts cleanly, allowing useReadingTools to run its own cleanup', () => {
    const { unmount } = render(<ReadingToolsController />)
    expect(() => unmount()).not.toThrow()
  })
})