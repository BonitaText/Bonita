import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import FontSelector from '../../content/views/FontSelector'
import { useSettings } from '../../content/hooks/useSettings'
import { useFontApplier } from '../../content/hooks/useFontApplier'

vi.mock('../../content/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}))
vi.mock('../../content/hooks/useFontApplier', () => ({
  useFontApplier: vi.fn(),
}))

const mockedUseSettings = vi.mocked(useSettings)
const mockedUseFontApplier = vi.mocked(useFontApplier)

function stubSettings(font: string = 'default') {
  const updateSetting = vi.fn()
  mockedUseSettings.mockReturnValue({
    settings: { font },
    updateSetting,
  } as unknown as ReturnType<typeof useSettings>)
  return updateSetting
}

describe('FontSelector', () => {
  beforeEach(() => {
    mockedUseSettings.mockReset()
    mockedUseFontApplier.mockReset()
  })

  it('mounts useFontApplier', () => {
    stubSettings()
    render(<FontSelector open={false} onOpen={vi.fn()} />)
    expect(mockedUseFontApplier).toHaveBeenCalled()
  })

  it('is inactive when the font is "default"', () => {
    stubSettings('default')
    render(<FontSelector open={false} onOpen={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Font' })).not.toHaveClass('active')
  })

  it('is active when a non-default font is selected', () => {
    stubSettings('arial')
    render(<FontSelector open={false} onOpen={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Font' })).toHaveClass('active')
  })

  it('calls onOpen when the dock button is clicked', async () => {
    stubSettings()
    const onOpen = vi.fn()
    const user = userEvent.setup()
    render(<FontSelector open={false} onOpen={onOpen} />)

    await user.click(screen.getByRole('button', { name: 'Font' }))
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('does not render the popup when closed', () => {
    stubSettings()
    render(<FontSelector open={false} onOpen={vi.fn()} />)
    expect(screen.queryByText('OpenDyslexic')).not.toBeInTheDocument()
  })

  it('renders all four font options when open', () => {
    stubSettings()
    render(<FontSelector open={true} onOpen={vi.fn()} />)

    expect(screen.getByText('Default')).toBeInTheDocument()
    expect(screen.getByText('OpenDyslexic')).toBeInTheDocument()
    expect(screen.getByText('Arial')).toBeInTheDocument()
    expect(screen.getByText('Verdana')).toBeInTheDocument()
  })

  it('marks the currently selected font with the "selected" class', () => {
    stubSettings('verdana')
    render(<FontSelector open={true} onOpen={vi.fn()} />)

    expect(screen.getByText('Verdana').closest('button')).toHaveClass('selected')
    expect(screen.getByText('Default').closest('button')).not.toHaveClass('selected')
  })

  it('updates the font and closes the popup (calls onOpen again) when an option is picked', async () => {
    const updateSetting = stubSettings('default')
    const onOpen = vi.fn()
    const user = userEvent.setup()
    render(<FontSelector open={true} onOpen={onOpen} />)

    await user.click(screen.getByText('Arial'))

    expect(updateSetting).toHaveBeenCalledWith('font', 'arial')
    expect(onOpen).toHaveBeenCalledTimes(1)
  })
})