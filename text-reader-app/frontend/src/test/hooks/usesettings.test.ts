import { vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import React from 'react'
import { SettingsContext, useSettings } from '../../content/hooks/useSettings'
import type { SettingsContextValue } from '../../content/hooks/useSettings'
import type { BonitaSettings } from '../../shared/settings'
import { defaultSettings } from '../../shared/settings'

function makeContextValue(overrides: Partial<BonitaSettings> = {}): SettingsContextValue {
  const settings: BonitaSettings = { ...defaultSettings, ...overrides }
  return {
    settings,
    ready: true,
    updateSetting: vi.fn(),
    updateSettings: vi.fn(),
  }
}

function wrapWithContext(value: SettingsContextValue | null) {
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(SettingsContext.Provider, { value }, children)
}

describe('useSettings', () => {

  describe('when called outside a SettingsProvider', () => {
    it('throws an error', () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

      expect(() => {
        renderHook(() => useSettings())
      }).toThrow('useSettings must be used within a SettingsProvider')

      consoleError.mockRestore()
    })
  })

  describe('when called inside a SettingsProvider', () => {
    it('returns the settings object from context', () => {
      const value = makeContextValue({ keywordBolding: true })
      const { result } = renderHook(() => useSettings(), { wrapper: wrapWithContext(value) })
      expect(result.current.settings.keywordBolding).toBe(true)
    })

    it('returns the ready flag from context', () => {
      const value = makeContextValue()
      const { result } = renderHook(() => useSettings(), { wrapper: wrapWithContext(value) })
      expect(result.current.ready).toBe(true)
    })

    it('returns the updateSetting function from context', () => {
      const value = makeContextValue()
      const { result } = renderHook(() => useSettings(), { wrapper: wrapWithContext(value) })
      expect(typeof result.current.updateSetting).toBe('function')
    })

    it('returns the updateSettings function from context', () => {
      const value = makeContextValue()
      const { result } = renderHook(() => useSettings(), { wrapper: wrapWithContext(value) })
      expect(typeof result.current.updateSettings).toBe('function')
    })
  })

  describe('context reactivity', () => {
    it('reflects updated context value when the provider re-renders', () => {
      const initialValue = makeContextValue({ keywordBolding: false })
      const updatedValue = makeContextValue({ keywordBolding: true })

      let contextValue = initialValue

      const DynamicWrapper = ({ children }: { children: React.ReactNode }) =>
        React.createElement(SettingsContext.Provider, { value: contextValue }, children)

      const { result, rerender } = renderHook(() => useSettings(), { wrapper: DynamicWrapper })

      expect(result.current.settings.keywordBolding).toBe(false)

      act(() => {
        contextValue = updatedValue
        rerender()
      })

      expect(result.current.settings.keywordBolding).toBe(true)
    })
  })

  describe('updateSetting', () => {
    it('delegates to the context updateSetting function', () => {
      const value = makeContextValue()
      const { result } = renderHook(() => useSettings(), { wrapper: wrapWithContext(value) })

      act(() => { result.current.updateSetting('keywordBolding', true) })

      expect(value.updateSetting).toHaveBeenCalledWith('keywordBolding', true)
    })
  })

  describe('updateSettings', () => {
    it('delegates to the context updateSettings function', () => {
      const value = makeContextValue()
      const { result } = renderHook(() => useSettings(), { wrapper: wrapWithContext(value) })

      const patch: Partial<BonitaSettings> = { keywordBolding: false, sentenceSplitting: true }
      act(() => { result.current.updateSettings(patch) })

      expect(value.updateSettings).toHaveBeenCalledWith(patch)
    })
  })
})