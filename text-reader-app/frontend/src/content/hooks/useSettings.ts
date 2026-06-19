/**
 * @file hooks/useSettings.ts
 *
 * Exports {@link SettingsContext} and the {@link useSettings} convenience hook.
 *
 * The context is created here (not in `SettingsProvider`) so that any module
 * can import `SettingsContext` directly when needed (e.g. for testing with a
 * custom provider) without creating a circular dependency through the provider
 * file.
 */

import { createContext, useContext } from 'react'
import { BonitaSettings } from '../../shared/settings'

// ─── Context shape ────────────────────────────────────────────────────────────

/**
 * Value exposed by {@link SettingsContext} and returned by {@link useSettings}.
 */
export interface SettingsContextValue {
  /** The current, fully-merged {@link BonitaSettings} object. */
  settings: BonitaSettings

  /**
   * `true` once the initial `chrome.storage.sync.get()` in
   * {@link SettingsProvider} has resolved.
   *
   * Tool components should not render (and their hooks should not fire) until
   * this is `true`, to avoid a double DOM-work cycle caused by hooks running
   * first with {@link defaultSettings} and then again with real stored values.
   */
  ready: boolean

  /**
   * Updates a single {@link BonitaSettings} key and persists the change.
   *
   * Optimistically applies the new value to React state before the storage
   * write completes, so the UI responds immediately.
   *
   * @param key   - The settings key to update.
   * @param value - The new value for that key.
   */
  updateSetting: <K extends keyof BonitaSettings>(
    key: K,
    value: BonitaSettings[K],
  ) => void

  /**
   * Applies a partial settings patch and persists the result in a single
   * storage write.
   *
   * Prefer over multiple sequential {@link updateSetting} calls when several
   * keys need to change at once (e.g. resetting all tools on site-toggle off),
   * to avoid multiple storage round-trips and intermediate re-renders.
   *
   * @param patch - Keys to update; all other keys retain their current values.
   */
  updateSettings: (patch: Partial<BonitaSettings>) => void
}

// ─── Context ──────────────────────────────────────────────────────────────────

/**
 * React context that carries the shared settings state for the Bonita overlay.
 *
 * Initialised to `null`; the non-null value is provided exclusively by
 * {@link SettingsProvider}.  Consuming this context directly (rather than via
 * {@link useSettings}) is discouraged — use the hook so you get the null-check
 * for free.
 */
export const SettingsContext = createContext<SettingsContextValue | null>(null)

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Returns the shared Bonita settings state, readiness flag, and updaters.
 *
 * Must be called from a component that is a descendant of
 * {@link SettingsProvider}; throws an error otherwise.
 *
 * @returns The current {@link SettingsContextValue}.
 *
 * @throws If called outside a {@link SettingsProvider} tree.
 *
 * @example
 * ```tsx
 * function MyTool() {
 *   const { settings, updateSetting } = useSettings()
 *   return (
 *     <button onClick={() => updateSetting('lineFocus', !settings.lineFocus)}>
 *       Toggle line focus
 *     </button>
 *   )
 * }
 * ```
 */
export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('useSettings must be used within a SettingsProvider')
  return ctx
}