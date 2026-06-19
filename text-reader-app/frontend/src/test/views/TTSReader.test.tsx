/**
 * @file components/TTSReader.test.tsx
 *
 * Tests for TTSReader. Covers the setup/teardown lifecycle driven by
 * `settings.tts`, the 400 ms hover-debounce, word-wrapping, the Chrome
 * resume hack interval, and the `onboundary` word-highlight handler.
 *
 * ## Mocking strategy
 * - `useSettings` — returns a mutable settings ref so individual tests can
 *   flip `settings.tts` and trigger the effect.
 * - `window.speechSynthesis` — replaced with a Jest spy object; `speak` is
 *   a spy, `cancel`/`pause`/`resume` are spies, and `speaking` is a writable
 *   property so the resume-hack branch can be exercised.
 * - `IconToggle` — renders a minimal button so we can fire `onChange` without
 *   testing that component itself.
 * - Timers — `vi.useFakeTimers()` so the 400 ms debounce and 1 s interval
 *   are fully controlled.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, fireEvent, act } from '@testing-library/react'
import TTSReader from '../../content/views/TTSReader'
import { useSettings } from '../../content/hooks/useSettings'

console.log(useSettings)

// ─── useSettings mock ─────────────────────────────────────────────────────────

let mockSettings: Record<string, unknown> = { tts: false }
const mockUpdateSetting = vi.fn((key: string, value: unknown) => {
  mockSettings[key] = value
})

vi.mock('../../content/hooks/useSettings', () => ({
  useSettings: () => ({
    settings: mockSettings,
    updateSetting: mockUpdateSetting,
    updateSettings: vi.fn(),
    ready: true,
  }),
}))
// ─── IconToggle mock ──────────────────────────────────────────────────────────

vi.mock('../../content/views/IconToggle', () => ({
  default: ({ label, enabled, onChange }: {
    label: string
    enabled: boolean
    onChange: (v: boolean) => void
  }) => (
    <button
      data-testid="icon-toggle"
      data-enabled={String(enabled)}
      aria-label={label}
      onClick={() => onChange(!enabled)}
    />
  ),
}))

// ─── speechSynthesis mock ─────────────────────────────────────────────────────

const mockSpeak   = vi.fn()
const mockCancel  = vi.fn()
const mockPause   = vi.fn()
const mockResume  = vi.fn()
let   mockSpeaking = false

const mockSynthesis = {
  get speaking() { return mockSpeaking },
  speak:  mockSpeak,
  cancel: mockCancel,
  pause:  mockPause,
  resume: mockResume,
}

// Stored utterance callbacks so tests can invoke them manually
let lastUtterance: SpeechSynthesisUtterance | null = null

beforeEach(() => {
  vi.useFakeTimers()

  mockSettings = { tts: false }
  mockSpeaking = false

  mockSpeak.mockReset()
  mockCancel.mockReset()
  mockPause.mockReset()
  mockResume.mockReset()
  mockUpdateSetting.mockReset()

  lastUtterance = null

  ;(globalThis as any).SpeechSynthesisUtterance = class {
    text: string
    rate = 1
    pitch = 1
    onboundary = null
    onend = null

    constructor(text: string) {
      this.text = text
    }
  }

  mockSpeak.mockImplementation((utt) => {
    lastUtterance = utt
  })

  Object.defineProperty(window, 'speechSynthesis', {
    value: mockSynthesis,
    writable: true,
    configurable: true,
  })
})

afterEach(() => {
  vi.useRealTimers()
  document.body.innerHTML = ''
  document.getElementById('bonita-tts-styles')?.remove()
})

// ─── Helpers ─────────────────────────────────────────────────────────────────

function renderWithTTS(ttsEnabled: boolean) {
  mockSettings.tts = ttsEnabled
  return render(<TTSReader />)
}

function makeReadable(text = 'Hello world test paragraph text here.'): HTMLElement {
  const p = document.createElement('p')
  p.textContent = text
  document.body.appendChild(p)
  return p
}

function hoverOver(el: HTMLElement) {
  fireEvent.mouseOver(el)
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Rendering
// ─────────────────────────────────────────────────────────────────────────────

describe('TTSReader — rendering', () => {
  it('renders the IconToggle button', () => {
    const { getByTestId } = renderWithTTS(false)
    expect(getByTestId('icon-toggle')).toBeTruthy()
  })

  it('passes enabled=false to IconToggle when tts is off', () => {
    const { getByTestId } = renderWithTTS(false)
    expect(getByTestId('icon-toggle').dataset.enabled).toBe('false')
  })

  it('passes enabled=true to IconToggle when tts is on', () => {
    const { getByTestId } = renderWithTTS(true)
    expect(getByTestId('icon-toggle').dataset.enabled).toBe('true')
  })

  it('calls updateSetting("tts", true) when the toggle is clicked while off', () => {
    const { getByTestId } = renderWithTTS(false)
    fireEvent.click(getByTestId('icon-toggle'))
    expect(mockUpdateSetting).toHaveBeenCalledWith('tts', true)
  })

  it('calls updateSetting("tts", false) when the toggle is clicked while on', () => {
    const { getByTestId } = renderWithTTS(true)
    fireEvent.click(getByTestId('icon-toggle'))
    expect(mockUpdateSetting).toHaveBeenCalledWith('tts', false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 2. Setup — style injection & synthesis warm-up
// ─────────────────────────────────────────────────────────────────────────────

describe('TTSReader — setup when tts=true', () => {
  it('injects the bonita-tts-styles <style> tag', () => {
    renderWithTTS(true)
    expect(document.getElementById('bonita-tts-styles')).not.toBeNull()
  })

  it('does not inject a duplicate style tag on re-render', () => {
    const { rerender } = renderWithTTS(true)
    rerender(<TTSReader />)
    expect(document.querySelectorAll('#bonita-tts-styles').length).toBe(1)
  })

  it('calls speechSynthesis.speak once immediately (warm-up utterance)', () => {
    renderWithTTS(true)
    expect(mockSpeak).toHaveBeenCalledTimes(1)
  })

  it('starts the Chrome resume-hack interval', () => {
    renderWithTTS(true)
    mockSpeaking = true
    act(() => { vi.advanceTimersByTime(3000) })
    // pause+resume called at 1 s, 2 s, 3 s
    expect(mockPause).toHaveBeenCalledTimes(3)
    expect(mockResume).toHaveBeenCalledTimes(3)
  })

  it('does NOT call pause/resume when not speaking', () => {
    renderWithTTS(true)
    mockSpeaking = false
    act(() => { vi.advanceTimersByTime(3000) })
    expect(mockPause).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 3. Teardown when tts=false
// ─────────────────────────────────────────────────────────────────────────────

describe('TTSReader — teardown when tts=false', () => {
  it('calls speechSynthesis.cancel', () => {
    renderWithTTS(false)
    expect(mockCancel).toHaveBeenCalled()
  })

  it('removes the style tag', () => {
    // Inject a fake style tag as if TTS was previously on
    const style = document.createElement('style')
    style.id = 'bonita-tts-styles'
    document.head.appendChild(style)

    renderWithTTS(false)
    expect(document.getElementById('bonita-tts-styles')).toBeNull()
  })

  it('does not start the resume-hack interval', () => {
    renderWithTTS(false)
    act(() => { vi.advanceTimersByTime(3000) })
    expect(mockPause).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 4. Hover debounce & speech triggering
// ─────────────────────────────────────────────────────────────────────────────

describe('TTSReader — hover debounce', () => {
  it('does not speak before 400 ms have elapsed', () => {
    renderWithTTS(true)
    mockSpeak.mockClear() // clear the warm-up call
    const p = makeReadable()
    hoverOver(p)
    act(() => { vi.advanceTimersByTime(300) })
    expect(mockSpeak).not.toHaveBeenCalled()
  })

  it('speaks after 400 ms have elapsed', () => {
    renderWithTTS(true)
    mockSpeak.mockClear()
    const p = makeReadable()
    hoverOver(p)
    act(() => { vi.advanceTimersByTime(400) })
    expect(mockSpeak).toHaveBeenCalledTimes(1)
  })

  it('cancels the previous timer if the mouse moves to another element', () => {
    renderWithTTS(true)
    mockSpeak.mockClear()
    const p1 = makeReadable('First paragraph with enough words.')
    const p2 = makeReadable('Second paragraph with enough words.')
    hoverOver(p1)
    act(() => { vi.advanceTimersByTime(200) })
    hoverOver(p2)
    act(() => { vi.advanceTimersByTime(400) })
    // Only one speak call — for p2, not p1
    expect(mockSpeak).toHaveBeenCalledTimes(1)
  })

  it('calls speechSynthesis.cancel before speaking the new element', () => {
    renderWithTTS(true)
    mockCancel.mockClear()
    const p = makeReadable()
    hoverOver(p)
    act(() => { vi.advanceTimersByTime(400) })
    expect(mockCancel).toHaveBeenCalled()
  })

  it('does not re-trigger if the same element is hovered again', () => {
    renderWithTTS(true)
    mockSpeak.mockClear()
    const p = makeReadable()
    hoverOver(p)
    act(() => { vi.advanceTimersByTime(400) })
    hoverOver(p)
    act(() => { vi.advanceTimersByTime(400) })
    // activeEl is already `p`, so the second hover is a no-op
    expect(mockSpeak).toHaveBeenCalledTimes(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 5. Word wrapping
// ─────────────────────────────────────────────────────────────────────────────

describe('TTSReader — word wrapping', () => {
  it('wraps each word in a bonita-tts-word span', () => {
    renderWithTTS(true)
    const p = makeReadable('Hello world')
    hoverOver(p)
    act(() => { vi.advanceTimersByTime(400) })

    const spans = p.querySelectorAll('.bonita-tts-word')
    expect(spans.length).toBe(2)
    expect(spans[0].textContent).toBe('Hello')
    expect(spans[1].textContent).toBe('world')
  })

  it('saves the original innerHTML to data-bonita-original', () => {
    renderWithTTS(true)
    const p = makeReadable('Hello world')
    const originalHTML = p.innerHTML
    hoverOver(p)
    act(() => { vi.advanceTimersByTime(400) })
    expect(p.dataset.bonitaOriginal).toBe(originalHTML)
  })

  it('restores the element innerHTML when the utterance ends', () => {
    renderWithTTS(true)
    const p = makeReadable('Hello world')
    const originalHTML = p.innerHTML
    hoverOver(p)
    act(() => { vi.advanceTimersByTime(400) })

    // Fire the onend callback
    act(() => { lastUtterance?.onend?.(new Event('end') as SpeechSynthesisEvent) })

    expect(p.innerHTML).toBe(originalHTML)
    expect(p.dataset.bonitaOriginal).toBeUndefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 6. onboundary word highlighting
// ─────────────────────────────────────────────────────────────────────────────

describe('TTSReader — onboundary highlighting', () => {
  function fireBoundary(charIndex: number) {
    const ev = Object.assign(new Event('boundary'), { name: 'word', charIndex })
    lastUtterance?.onboundary?.(ev as SpeechSynthesisEvent)
  }

  it('adds bonita-tts-active to the span at charIndex 0', () => {
    renderWithTTS(true)
    const p = makeReadable('Hello world')
    hoverOver(p)
    act(() => { vi.advanceTimersByTime(400) })

    act(() => { fireBoundary(0) })

    const spans = p.querySelectorAll('.bonita-tts-word')
    expect(spans[0].classList.contains('bonita-tts-active')).toBe(true)
    expect(spans[1].classList.contains('bonita-tts-active')).toBe(false)
  })

  it('moves the active class to the second word', () => {
    renderWithTTS(true)
    const p = makeReadable('Hello world')
    hoverOver(p)
    act(() => { vi.advanceTimersByTime(400) })

    // "Hello " is 6 chars; "world" starts at index 6
    act(() => { fireBoundary(6) })

    const spans = p.querySelectorAll('.bonita-tts-word')
    expect(spans[0].classList.contains('bonita-tts-active')).toBe(false)
    expect(spans[1].classList.contains('bonita-tts-active')).toBe(true)
  })

  it('ignores boundary events that are not word boundaries', () => {
    renderWithTTS(true)
    const p = makeReadable('Hello world')
    hoverOver(p)
    act(() => { vi.advanceTimersByTime(400) })

    const ev = Object.assign(new Event('boundary'), { name: 'sentence', charIndex: 0 })
    act(() => { lastUtterance?.onboundary?.(ev as SpeechSynthesisEvent) })

    const active = p.querySelectorAll('.bonita-tts-active')
    expect(active.length).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 7. Cleanup on unmount
// ─────────────────────────────────────────────────────────────────────────────

describe('TTSReader — cleanup on unmount', () => {
  it('cancels speech on unmount', () => {
    const { unmount } = renderWithTTS(true)
    mockCancel.mockClear()
    unmount()
    expect(mockCancel).toHaveBeenCalled()
  })

  it('removes the event listener — no speech after unmount', () => {
    const { unmount } = renderWithTTS(true)
    unmount()
    mockSpeak.mockClear()
    const p = makeReadable()
    hoverOver(p)
    act(() => { vi.advanceTimersByTime(400) })
    expect(mockSpeak).not.toHaveBeenCalled()
  })

  it('removes the style tag on unmount', () => {
    const { unmount } = renderWithTTS(true)
    unmount()
    expect(document.getElementById('bonita-tts-styles')).toBeNull()
  })
})