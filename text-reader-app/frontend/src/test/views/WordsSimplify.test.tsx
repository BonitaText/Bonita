import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import WordSimplify from '../../content/views/WordSimplify'
import { useSettings } from '../../content/hooks/useSettings'

vi.mock('../../content/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}))

const mockedUseSettings = vi.mocked(useSettings)

type Complexity = 'low' | 'medium' | 'high'

function stubSettings(overrides: {
  wordSimplification?: boolean
  wordComplexity?: Complexity
} = {}) {
  const updateSetting = vi.fn()
  mockedUseSettings.mockReturnValue({
    settings: {
      wordSimplification: false,
      wordComplexity: 'medium' as Complexity,
      ...overrides,
    },
    updateSetting,
  } as unknown as ReturnType<typeof useSettings>)
  return updateSetting
}

describe('WordSimplify', () => {
  beforeEach(() => {
    mockedUseSettings.mockReset()
  })

  it('enables word simplification on first click when off, without opening the popup', async () => {
    const updateSetting = stubSettings({ wordSimplification: false })
    const onOpen = vi.fn()
    const user = userEvent.setup()
    render(<WordSimplify open={false} onOpen={onOpen} />)

    await user.click(screen.getByRole('button', { name: 'Word Simplification' }))

    expect(updateSetting).toHaveBeenCalledWith('wordSimplification', true)
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('calls onOpen (not updateSetting) when clicked while already enabled', async () => {
    const updateSetting = stubSettings({ wordSimplification: true })
    const onOpen = vi.fn()
    const user = userEvent.setup()
    render(<WordSimplify open={false} onOpen={onOpen} />)

    await user.click(screen.getByRole('button', { name: 'Word Simplification' }))

    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(updateSetting).not.toHaveBeenCalled()
  })

  it('shows the "active" class on the dock button only when simplification is on', () => {
    stubSettings({ wordSimplification: true })
    render(<WordSimplify open={false} onOpen={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Word Simplification' })).toHaveClass('active')
  })

  it('does not render the popup when closed, even if enabled', () => {
    stubSettings({ wordSimplification: true })
    render(<WordSimplify open={false} onOpen={vi.fn()} />)
    expect(screen.queryByText('Low')).not.toBeInTheDocument()
  })

  it('does not render the popup when open but simplification is off', () => {
    stubSettings({ wordSimplification: false })
    render(<WordSimplify open={true} onOpen={vi.fn()} />)
    expect(screen.queryByText('Low')).not.toBeInTheDocument()
  })

  it('renders all three levels when open and enabled', () => {
    stubSettings({ wordSimplification: true })
    render(<WordSimplify open={true} onOpen={vi.fn()} />)

    expect(screen.getByText('Low')).toBeInTheDocument()
    expect(screen.getByText('More words')).toBeInTheDocument()
    expect(screen.getByText('Medium')).toBeInTheDocument()
    expect(screen.getByText('Balanced')).toBeInTheDocument()
    expect(screen.getByText('High')).toBeInTheDocument()
    expect(screen.getByText('Fewer words')).toBeInTheDocument()
  })

  it('marks the currently active level with the "on" class', () => {
    stubSettings({ wordSimplification: true, wordComplexity: 'high' })
    render(<WordSimplify open={true} onOpen={vi.fn()} />)

    expect(screen.getByText('High').closest('button')).toHaveClass('on')
    expect(screen.getByText('Low').closest('button')).not.toHaveClass('on')
    expect(screen.getByText('Medium').closest('button')).not.toHaveClass('on')
  })

  it('updates wordComplexity when a different level is clicked', async () => {
    const updateSetting = stubSettings({ wordSimplification: true, wordComplexity: 'medium' })
    const user = userEvent.setup()
    render(<WordSimplify open={true} onOpen={vi.fn()} />)

    await user.click(screen.getByText('Low'))

    expect(updateSetting).toHaveBeenCalledWith('wordComplexity', 'low')
  })

  it('turns off simplification when "Turn off" is clicked', async () => {
    const updateSetting = stubSettings({ wordSimplification: true })
    const user = userEvent.setup()
    render(<WordSimplify open={true} onOpen={vi.fn()} />)

    await user.click(screen.getByText('Turn off'))

    expect(updateSetting).toHaveBeenCalledWith('wordSimplification', false)
  })
})