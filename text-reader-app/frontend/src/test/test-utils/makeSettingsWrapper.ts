import React from 'react'
import { vi } from 'vitest'
import { SettingsContext } from '../../content/hooks/useSettings'
import type { SettingsContextValue } from '../../content/hooks/useSettings'
import type { BonitaSettings } from '../../shared/settings'
import { defaultSettings } from '../../shared/settings'

export function makeSettingsWrapper(
  overrides: Partial<BonitaSettings> = {},
): React.ComponentType<{ children: React.ReactNode }> {
  const settings: BonitaSettings = { ...defaultSettings, ...overrides }

  const value: SettingsContextValue = {
    settings,
    ready: true,
    updateSetting: vi.fn(),
    updateSettings: vi.fn(),
  }

  return function SettingsWrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(SettingsContext.Provider, { value }, children)
  }
}