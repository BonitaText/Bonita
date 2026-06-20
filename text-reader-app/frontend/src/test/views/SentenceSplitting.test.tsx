import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SentenceSplitting from '../../content/views/SentenceSplitting'
import { useSettings } from '../../content/hooks/useSettings'

vi.mock('../../content/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}))

const mockedUseSettings = vi.mocked(useSettings)

function stubSettings(sentenceSplitting: boolean) {
  const updateSetting = vi.fn()
  mockedUseSettings.mockReturnValue({
    settings: { sentenceSplitting },
    updateSetting,
  } as unknown as ReturnType<typeof useSettings>)
  return updateSetting
}

describe('SentenceSplitting', () => {
  beforeEach(() => {
    mockedUseSettings.mockReset()
  })

  it('renders an IconToggle labelled "Sentence Splitting"', () => {
    stubSettings(false)
    render(<SentenceSplitting />)
    expect(screen.getByRole('button', { name: 'Sentence Splitting' })).toBeInTheDocument()
  })

  it('reflects settings.sentenceSplitting=false as inactive', () => {
    stubSettings(false)
    render(<SentenceSplitting />)
    expect(screen.getByRole('button', { name: 'Sentence Splitting' })).not.toHaveClass('active')
  })

  it('reflects settings.sentenceSplitting=true as active', () => {
    stubSettings(true)
    render(<SentenceSplitting />)
    expect(screen.getByRole('button', { name: 'Sentence Splitting' })).toHaveClass('active')
  })

  it('calls updateSetting("sentenceSplitting", true) when toggled on', async () => {
    const updateSetting = stubSettings(false)
    const user = userEvent.setup()
    render(<SentenceSplitting />)

    await user.click(screen.getByRole('button', { name: 'Sentence Splitting' }))

    expect(updateSetting).toHaveBeenCalledWith('sentenceSplitting', true)
  })

  it('calls updateSetting("sentenceSplitting", false) when toggled off', async () => {
    const updateSetting = stubSettings(true)
    const user = userEvent.setup()
    render(<SentenceSplitting />)

    await user.click(screen.getByRole('button', { name: 'Sentence Splitting' }))

    expect(updateSetting).toHaveBeenCalledWith('sentenceSplitting', false)
  })
})