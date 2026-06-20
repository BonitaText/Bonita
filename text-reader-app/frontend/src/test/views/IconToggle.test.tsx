import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { LucideIcon } from 'lucide-react'
import IconToggle from '../../content/views/IconToggle'

const MockIcon = ((props: Record<string, unknown>) => (
  <svg data-testid="mock-icon" {...props} />
)) as unknown as LucideIcon

describe('IconToggle', () => {
  it('renders the provided icon', () => {
    render(<IconToggle label="Bookmarks" icon={MockIcon} enabled={false} onChange={vi.fn()} />)
    expect(screen.getByTestId('mock-icon')).toBeInTheDocument()
  })

  it('renders no visible label text', () => {
    render(<IconToggle label="Bookmarks" icon={MockIcon} enabled={false} onChange={vi.fn()} />)
    expect(screen.queryByText('Bookmarks')).not.toBeInTheDocument()
  })

  it('sets aria-label and data-tooltip to the label prop (unprefixed)', () => {
    render(<IconToggle label="Bookmarks" icon={MockIcon} enabled={false} onChange={vi.fn()} />)
    const button = screen.getByRole('button', { name: 'Bookmarks' })
    expect(button).toHaveAttribute('data-tooltip', 'Bookmarks')
  })

  it('does not have the "active" class when disabled', () => {
    render(<IconToggle label="Bookmarks" icon={MockIcon} enabled={false} onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Bookmarks' })).not.toHaveClass('active')
  })

  it('has the "active" class when enabled', () => {
    render(<IconToggle label="Bookmarks" icon={MockIcon} enabled={true} onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Bookmarks' })).toHaveClass('active')
  })

  it('calls onChange(true) when clicked while disabled', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<IconToggle label="Bookmarks" icon={MockIcon} enabled={false} onChange={onChange} />)

    await user.click(screen.getByRole('button', { name: 'Bookmarks' }))

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('calls onChange(false) when clicked while enabled', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<IconToggle label="Bookmarks" icon={MockIcon} enabled={true} onChange={onChange} />)

    await user.click(screen.getByRole('button', { name: 'Bookmarks' }))

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith(false)
  })
})