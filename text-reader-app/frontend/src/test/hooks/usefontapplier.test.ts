/**
 * @file hooks/__tests__/useFontApplier.test.ts
 */
import { vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useFontApplier } from '../../content/hooks/useFontApplier'
import { makeSettingsWrapper } from '../test-utils/makeSettingsWrapper'

// ─── Constants ────────────────────────────────────────────────────────────────

const STYLE_ID = 'bonita-font-override'

// ─── chrome.runtime mock ──────────────────────────────────────────────────────

beforeEach(() => {
  
  global.chrome = {
    // @ts-expect-error — minimal chrome mock for jsdom
    runtime: {
      getURL: vi.fn((path: string) => `chrome-extension://fake-id/${path}`),
    },
  }
})

afterEach(() => {
  document.getElementById(STYLE_ID)?.remove()
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getStyle(): HTMLStyleElement | null {
  return document.getElementById(STYLE_ID) as HTMLStyleElement | null
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('useFontApplier', () => {

  describe('font: "default"', () => {
    it('does not inject a style tag', () => {
      renderHook(() => useFontApplier(), {
        wrapper: makeSettingsWrapper({ font: 'default' }),
      })
      expect(getStyle()).toBeNull()
    })

    it('removes any existing override style', () => {
      // Pre-seed a style tag as if a previous font had been applied
      const stale = document.createElement('style')
      stale.id = STYLE_ID
      stale.textContent = 'body { font-family: Arial; }'
      document.head.appendChild(stale)

      renderHook(() => useFontApplier(), {
        wrapper: makeSettingsWrapper({ font: 'default' }),
      })

      expect(getStyle()).toBeNull()
    })
  })

  describe('font: "arial"', () => {
    it('injects a style tag with the Arial font stack', () => {
      renderHook(() => useFontApplier(), {
        wrapper: makeSettingsWrapper({ font: 'arial' }),
      })
      const style = getStyle()
      expect(style).not.toBeNull()
      expect(style!.textContent).toContain('Arial, sans-serif')
    })

    it('does not include an @font-face declaration', () => {
      renderHook(() => useFontApplier(), {
        wrapper: makeSettingsWrapper({ font: 'arial' }),
      })
      expect(getStyle()!.textContent).not.toContain('@font-face')
    })

    it('exempts the Bonita root from the override', () => {
      renderHook(() => useFontApplier(), {
        wrapper: makeSettingsWrapper({ font: 'arial' }),
      })
      expect(getStyle()!.textContent).toContain('[data-bonita-root="true"]')
      expect(getStyle()!.textContent).toContain('Inter')
    })
  })

  describe('font: "verdana"', () => {
    it('injects a style tag with the Verdana font stack', () => {
      renderHook(() => useFontApplier(), {
        wrapper: makeSettingsWrapper({ font: 'verdana' }),
      })
      expect(getStyle()!.textContent).toContain('Verdana, sans-serif')
    })
  })

  describe('font: "opendyslexic"', () => {
    it('injects an @font-face declaration using chrome.runtime.getURL', () => {
      renderHook(() => useFontApplier(), {
        wrapper: makeSettingsWrapper({ font: 'opendyslexic' }),
      })
      const style = getStyle()
      expect(style!.textContent).toContain('@font-face')
      expect(style!.textContent).toContain(
        'chrome-extension://fake-id/fonts/opendyslexic-latin-400-normal.woff2',
      )
      expect(chrome.runtime.getURL).toHaveBeenCalledWith(
        'fonts/opendyslexic-latin-400-normal.woff2',
      )
    })

    it('applies the OpenDyslexic font stack to body', () => {
      renderHook(() => useFontApplier(), {
        wrapper: makeSettingsWrapper({ font: 'opendyslexic' }),
      })
      expect(getStyle()!.textContent).toContain('"OpenDyslexic"')
    })
  })

  describe('cleanup', () => {
    it('removes the style tag on unmount', () => {
      const { unmount } = renderHook(() => useFontApplier(), {
        wrapper: makeSettingsWrapper({ font: 'arial' }),
      })
      expect(getStyle()).not.toBeNull()
      unmount()
      expect(getStyle()).toBeNull()
    })

    it('removes the previous style tag when the font setting changes', () => {
      const { rerender } = renderHook(() => useFontApplier(), {
        wrapper: makeSettingsWrapper({ font: 'arial' }),
      })
      expect(getStyle()!.textContent).toContain('Arial')

      act(() => { rerender() })

      // Same wrapper re-renders with the same settings; style tag should
      // still exist and not duplicate
      expect(document.querySelectorAll(`#${STYLE_ID}`)).toHaveLength(1)
    })

    it('never leaves more than one style tag after multiple renders', () => {
      const { rerender } = renderHook(() => useFontApplier(), {
        wrapper: makeSettingsWrapper({ font: 'verdana' }),
      })
      act(() => { rerender() })
      act(() => { rerender() })
      expect(document.querySelectorAll(`#${STYLE_ID}`)).toHaveLength(1)
    })

    it('removes the style tag when switching from a font to "default"', () => {
      const { unmount } = renderHook(() => useFontApplier(), {
        wrapper: makeSettingsWrapper({ font: 'arial' }),
      })
      expect(getStyle()).not.toBeNull()
      unmount()

      renderHook(() => useFontApplier(), {
        wrapper: makeSettingsWrapper({ font: 'default' }),
      })
      expect(getStyle()).toBeNull()
    })
  })
})