import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
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

describe('POSHighlight', () => {
  beforeEach(() => {
    mockedUseSettings.mockReset()
  })

  it('is inactive when posEnabled is absent (defaults all categories off)', () => {
    stubSettings()
    render(<POSHighlight open={false} onOpen={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'POS Highlighting' })).not.toHaveClass('active')
  })

  it('is active when at least one category is enabled', () => {
    stubSettings({ posEnabled: { verbs: true, nouns: false, adjectives: false } })
    render(<POSHighlight open={false} onOpen={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'POS Highlighting' })).toHaveClass('active')
  })

  it('calls onOpen when the dock button is clicked', async () => {
    stubSettings()
    const onOpen = vi.fn()
    const user = userEvent.setup()
    render(<POSHighlight open={false} onOpen={onOpen} />)

    await user.click(screen.getByRole('button', { name: 'POS Highlighting' }))
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('does not render the popup when closed', () => {
    stubSettings()
    render(<POSHighlight open={false} onOpen={vi.fn()} />)
    expect(screen.queryByText('Verbs')).not.toBeInTheDocument()
  })

  it('renders all three categories when open', () => {
    stubSettings()
    render(<POSHighlight open={true} onOpen={vi.fn()} />)
    expect(screen.getByText('Verbs')).toBeInTheDocument()
    expect(screen.getByText('Nouns')).toBeInTheDocument()
    expect(screen.getByText('Adjectives')).toBeInTheDocument()
  })

  it('marks only the enabled categories with the "on" class', () => {
    stubSettings({ posEnabled: { verbs: true, nouns: false, adjectives: true } })
    render(<POSHighlight open={true} onOpen={vi.fn()} />)

    expect(screen.getByText('Verbs').closest('button')).toHaveClass('on')
    expect(screen.getByText('Adjectives').closest('button')).toHaveClass('on')
    expect(screen.getByText('Nouns').closest('button')).not.toHaveClass('on')
  })

  it('toggles a single category on click while preserving the others', async () => {
    const updateSetting = stubSettings({ posEnabled: { verbs: true, nouns: false, adjectives: false } })
    const user = userEvent.setup()
    render(<POSHighlight open={true} onOpen={vi.fn()} />)

    await user.click(screen.getByText('Nouns'))

    expect(updateSetting).toHaveBeenCalledWith('posEnabled', {
      verbs: true,
      nouns: true,
      adjectives: false,
    })
  })

  it('sources each swatch colour from settings.posColors', () => {
    stubSettings({ posEnabled: { verbs: false, nouns: false, adjectives: false } })
    render(<POSHighlight open={true} onOpen={vi.fn()} />)

    const verbsRow = screen.getByText('Verbs').closest('button') as HTMLElement
    const swatch = verbsRow.querySelector('.bonita-pos-dot') as HTMLElement
    // jsdom normalises inline hex colours to rgb() when read back.
    expect(swatch.style.background).toBe('rgb(255, 0, 0)')
  })
})