import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { LucideIcon } from 'lucide-react'
import Toggle from '../../content/views/Toggle'

// Minimal stand-in for a LucideIcon: just needs to be a component that
// accepts the props Toggle passes through (size, className, strokeWidth).
const MockIcon = ((props: Record<string, unknown>) => (
  <svg data-testid="mock-icon" {...props} />
)) as unknown as LucideIcon

describe('Toggle', () => {
  it('renders the label text', () => {
    render(<Toggle label="Dark mode" icon={MockIcon} enabled={false} onChange={vi.fn()} />)
    expect(screen.getByText('Dark mode')).toBeInTheDocument()
  })

  it('renders the provided icon', () => {
    render(<Toggle label="Dark mode" icon={MockIcon} enabled={false} onChange={vi.fn()} />)
    expect(screen.getByTestId('mock-icon')).toBeInTheDocument()
  })

  it('exposes an aria-label of "Toggle {label}"', () => {
    render(<Toggle label="Dark mode" icon={MockIcon} enabled={false} onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Toggle Dark mode' })).toBeInTheDocument()
  })

  it('does not have the "on" class when disabled', () => {
    render(<Toggle label="Dark mode" icon={MockIcon} enabled={false} onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Toggle Dark mode' })).not.toHaveClass('on')
  })

  it('has the "on" class when enabled', () => {
    render(<Toggle label="Dark mode" icon={MockIcon} enabled={true} onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Toggle Dark mode' })).toHaveClass('on')
  })

  it('calls onChange(true) when clicked while disabled', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<Toggle label="Dark mode" icon={MockIcon} enabled={false} onChange={onChange} />)

    await user.click(screen.getByRole('button', { name: 'Toggle Dark mode' }))

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('calls onChange(false) when clicked while enabled', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<Toggle label="Dark mode" icon={MockIcon} enabled={true} onChange={onChange} />)

    await user.click(screen.getByRole('button', { name: 'Toggle Dark mode' }))

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith(false)
  })

  it('does not mutate enabled itself — toggling is fully controlled by the parent', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    const { rerender } = render(
      <Toggle label="Dark mode" icon={MockIcon} enabled={false} onChange={onChange} />
    )

    const button = screen.getByRole('button', { name: 'Toggle Dark mode' })
    await user.click(button)
    // Without the parent re-rendering with the new value, the prop hasn't changed.
    expect(button).not.toHaveClass('on')

    rerender(<Toggle label="Dark mode" icon={MockIcon} enabled={true} onChange={onChange} />)
    expect(button).toHaveClass('on')
  })
})