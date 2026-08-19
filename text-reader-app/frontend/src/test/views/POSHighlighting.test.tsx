import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import POSHighlight from '../../content/views/POSHighlight'
import { useSettings } from '../../content/hooks/useSettings'

vi.mock('../../content/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}))

const mockedUseSettings = vi.mocked(useSettings)

type PosEnabled = { verbs: boolean; nouns: boolean; adjectives: boolean }

function stubSettings(overrides: { posEnabled?: PosEnabled } = {}) {
  const updateSetting = vi.fn()
  mockedUseSettings.mockReturnValue({
    settings: {
      posEnabled: overrides.posEnabled,
      posColors: { verbs: '#ff0000', nouns: '#00ff00', adjectives: '#0000ff' },
    },
    updateSetting,
  } as unknown as ReturnType<typeof useSettings>)
  return updateSetting
}

/** Returns the `.bonita-font-wrapper` div — the hover target for the whole tool. */
function getWrapper(): HTMLElement {
  return document.querySelector('.bonita-font-wrapper') as HTMLElement
}

describe('POSHighlight', () => {
  beforeEach(() => {
    mockedUseSettings.mockReset()
  })

  // The button's active state and popup visibility are now driven by a local
  // "tool enabled" toggle (set via click), independent of which categories
  // are selected in settings — not by whether any category is currently on.

  it('is inactive by default, even if posEnabled has categories on from a previous session', () => {
    stubSettings({ posEnabled: { verbs: true, nouns: false, adjectives: false } })
    render(<POSHighlight open={false} onShow={vi.fn()} onHide={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'POS Highlighting' })).not.toHaveClass('active')
  })

  it('becomes active after clicking the dock button', async () => {
    stubSettings()
    const user = userEvent.setup()
    render(<POSHighlight open={false} onShow={vi.fn()} onHide={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'POS Highlighting' }))
    expect(screen.getByRole('button', { name: 'POS Highlighting' })).toHaveClass('active')
  })

  it('calls onShow directly when enabling via click', async () => {
    stubSettings()
    const onShow = vi.fn()
    const onHide = vi.fn()
    const user = userEvent.setup()
    render(<POSHighlight open={false} onShow={onShow} onHide={onHide} />)

    await user.click(screen.getByRole('button', { name: 'POS Highlighting' }))
    expect(onShow).toHaveBeenCalledTimes(1)
    expect(onHide).not.toHaveBeenCalled()
  })

  it('calls onHide and clears all categories when disabling via a second click', async () => {
    const updateSetting = stubSettings({ posEnabled: { verbs: true, nouns: true, adjectives: false } })
    const onShow = vi.fn()
    const onHide = vi.fn()
    const user = userEvent.setup()
    render(<POSHighlight open={true} onShow={onShow} onHide={onHide} />)

    const button = screen.getByRole('button', { name: 'POS Highlighting' })
    await user.click(button) // turn on
    await user.click(button) // turn off

    expect(onHide).toHaveBeenCalledTimes(1)
    expect(updateSetting).toHaveBeenCalledWith('posEnabled', {
      verbs: false,
      nouns: false,
      adjectives: false,
    })
  })

  describe('hover behaviour', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.runOnlyPendingTimers()
      vi.useRealTimers()
    })

    it('does not call onShow on hover-in before the tool has been toggled on', () => {
      stubSettings()
      const onShow = vi.fn()
      render(<POSHighlight open={false} onShow={onShow} onHide={vi.fn()} />)

      fireEvent.mouseEnter(getWrapper())
      expect(onShow).not.toHaveBeenCalled()
    })

    it('calls onHide after a delay on hover-out once enabled', () => {
      stubSettings()
      const onHide = vi.fn()
      render(<POSHighlight open={true} onShow={vi.fn()} onHide={onHide} />)

      fireEvent.click(screen.getByRole('button', { name: 'POS Highlighting' }))
      fireEvent.mouseLeave(getWrapper())
      expect(onHide).not.toHaveBeenCalled()
      vi.advanceTimersByTime(150)
      expect(onHide).toHaveBeenCalledTimes(1)
    })
  })

  it('does not render the popup when closed', () => {
    stubSettings()
    render(<POSHighlight open={false} onShow={vi.fn()} onHide={vi.fn()} />)
    expect(screen.queryByText('Verbs')).not.toBeInTheDocument()
  })

  it('does not render the popup when open is true but the tool has not been toggled on', () => {
    // open alone isn't enough now — the popup also requires the local
    // `enabled` state, which starts false until the button is clicked.
    stubSettings()
    render(<POSHighlight open={true} onShow={vi.fn()} onHide={vi.fn()} />)
    expect(screen.queryByText('Verbs')).not.toBeInTheDocument()
  })

  it('renders all three categories once toggled on and open', async () => {
    stubSettings()
    const user = userEvent.setup()
    render(<POSHighlight open={true} onShow={vi.fn()} onHide={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'POS Highlighting' }))

    expect(screen.getByText('Verbs')).toBeInTheDocument()
    expect(screen.getByText('Nouns')).toBeInTheDocument()
    expect(screen.getByText('Adjectives')).toBeInTheDocument()
  })

  it('marks only the enabled categories with the "on" class', async () => {
    stubSettings({ posEnabled: { verbs: true, nouns: false, adjectives: true } })
    const user = userEvent.setup()
    render(<POSHighlight open={true} onShow={vi.fn()} onHide={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'POS Highlighting' }))

    expect(screen.getByText('Verbs').closest('button')).toHaveClass('on')
    expect(screen.getByText('Adjectives').closest('button')).toHaveClass('on')
    expect(screen.getByText('Nouns').closest('button')).not.toHaveClass('on')
  })

  it('toggles a single category on click while preserving the others', async () => {
    const updateSetting = stubSettings({ posEnabled: { verbs: true, nouns: false, adjectives: false } })
    const user = userEvent.setup()
    render(<POSHighlight open={true} onShow={vi.fn()} onHide={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'POS Highlighting' })) // toggle tool on
    await user.click(screen.getByText('Nouns'))

    expect(updateSetting).toHaveBeenCalledWith('posEnabled', {
      verbs: true,
      nouns: true,
      adjectives: false,
    })
  })

  it('sources each swatch colour from settings.posColors', async () => {
    stubSettings({ posEnabled: { verbs: false, nouns: false, adjectives: false } })
    const user = userEvent.setup()
    render(<POSHighlight open={true} onShow={vi.fn()} onHide={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'POS Highlighting' }))

    const verbsRow = screen.getByText('Verbs').closest('button') as HTMLElement
    const swatch = verbsRow.querySelector('.bonita-pos-dot') as HTMLElement
    // jsdom normalises inline hex colours to rgb() when read back.
    expect(swatch.style.background).toBe('rgb(255, 0, 0)')
  })
})