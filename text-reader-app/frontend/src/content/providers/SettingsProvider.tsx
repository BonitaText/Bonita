/**
 * @file providers/SettingsProvider.tsx
 *
 * Provides the single shared {@link BonitaSettings} state to the entire
 * overlay via {@link SettingsContext}.
 *
 * ## Responsibilities
 * - Loads settings once on mount via {@link getSettings}.
 * - Exposes a `ready` flag that is `false` until that initial load resolves,
 *   preventing tool hooks from running against {@link defaultSettings} before
 *   real stored values are available.
 * - Registers exactly one `chrome.storage.onChanged` listener for the lifetime
 *   of the overlay, regardless of how many tool components are mounted.
 * - Exposes {@link SettingsContextValue.updateSetting} for single-key updates
 *   and {@link SettingsContextValue.updateSettings} for multi-key patches,
 *   both of which optimistically update React state and persist to storage.
 *
 * ## Why `ready` matters
 * Without it, tool hooks would fire twice on first mount: once with
 * `defaultSettings` (all tools off) and once with the real loaded values.
 * That double-fire caused a redundant DOM work cycle on every page load —
 * the hook would apply no changes, then immediately re-run and apply the
 * real settings.  Gating tool component rendering on `ready` eliminates it.
 *
 * ## Disable-path ordering
 * `updateSettings` is intentionally **not** called during site-toggle off
 * inside this provider.  Instead, `App` defers the reset call via
 * `setTimeout(fn, 0)` so React unmounts all tool components (running their
 * cleanup effects) before the settings state changes.  This avoids a
 * double-cleanup cycle where hooks would react to the settings change AND
 * then again to unmount.
 */

import { useEffect, useState, ReactNode } from 'react'
import {
  BonitaSettings,
  defaultSettings,
  getSettings,
  onSettingsChanged,
  saveSettings,
} from '../../shared/settings'
import { SettingsContext } from '../hooks/useSettings'

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Props for {@link SettingsProvider}.
 */
interface SettingsProviderProps {
  /** The subtree that will have access to {@link SettingsContext}. */
  children: ReactNode
}

/**
 * Root settings provider for the Bonita overlay.
 *
 * Render this once at the top of the component tree (wrapping `<App />`).
 * All descendant components can access settings via {@link useSettings}.
 *
 * @example
 * ```tsx
 * createRoot(container).render(
 *   <StrictMode>
 *     <SettingsProvider>
 *       <App />
 *     </SettingsProvider>
 *   </StrictMode>
 * )
 * ```
 */
export function SettingsProvider({ children }: SettingsProviderProps) {
  const [settings, setSettings] = useState<BonitaSettings>(defaultSettings)

  /**
   * `false` until the initial `chrome.storage.sync.get()` resolves.
   *
   * Exposed via context so `App` can gate tool component rendering on it,
   * preventing hooks from firing with stale `defaultSettings` values.
   */
  const [ready, setReady] = useState(false)

  /**
   * On mount:
   * 1. Loads real settings from storage and marks the provider as `ready`.
   * 2. Registers a storage-change listener so settings stay in sync with
   *    changes made from other tabs or the extension options page.
   *
   * The cleanup function returned by `onSettingsChanged` is forwarded as the
   * effect cleanup so the listener is removed if the provider ever unmounts.
   */
  useEffect(() => {
    getSettings().then(loaded => {
      setSettings(loaded)
      setReady(true)
    })
    return onSettingsChanged(setSettings)
  }, [])

  /**
   * Updates a single settings key, optimistically applying the change to
   * React state and persisting it to storage.
   *
   * @param key   - The {@link BonitaSettings} key to update.
   * @param value - The new value for that key.
   */
  const updateSetting = <K extends keyof BonitaSettings>(
    key: K,
    value: BonitaSettings[K],
  ): void => {
    const next = { ...settings, [key]: value }
    setSettings(next)
    void saveSettings(next)
  }

  /**
   * Applies a partial settings patch, optimistically updating React state
   * and persisting the result to storage in a single write.
   *
   * Prefer this over multiple sequential {@link updateSetting} calls when
   * resetting several tools at once (e.g. on site-toggle off) to avoid
   * multiple storage writes and intermediate re-renders.
   *
   * @param patch - A partial {@link BonitaSettings} object. Only the provided
   *   keys are changed; all others retain their current values.
   */
  const updateSettings = (patch: Partial<BonitaSettings>): void => {
    const next = { ...settings, ...patch }
    setSettings(next)
    void saveSettings(next)
  }

  return (
    <SettingsContext.Provider value={{ settings, updateSetting, updateSettings, ready }}>
      {children}
    </SettingsContext.Provider>
  )
}