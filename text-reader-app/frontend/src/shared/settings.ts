/**
 * @file shared/settings.ts
 *
 * Defines the {@link BonitaSettings} shape, default values, and the three
 * storage helpers used by every part of the extension:
 * {@link getSettings}, {@link saveSettings}, and {@link onSettingsChanged}.
 *
 * Storage backend is chosen at runtime:
 * - **Extension context** — `chrome.storage.sync` (persisted, synced across
 *   devices).
 * - **Vite dev / browser tab** — `localStorage` + a synthetic `CustomEvent`
 *   so `onSettingsChanged` listeners still fire during local development.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Identifiers for every reading tool that can be shown or hidden in the
 * toolbar dock via {@link BonitaSettings.enabledTools}.
 *
 * Deliberately mirrors the popup's `featureToggles` list (minus `font`,
 * which has no visibility checkbox in the popup and is always shown in the
 * dock via `FontSelector`).
 */
export type ToolId =
  | 'sentenceSplitting'
  | 'keywordBolding'
  | 'wordSimplification'
  | 'pos'
  | 'lineFocus'
  | 'tts'

/**
 * Complete settings object for the Bonita reading-tools overlay.
 *
 * Every field has a safe default in {@link defaultSettings} so partial reads
 * from storage can always be merged back to a full object via
 * {@link mergeSettings}.
 */
export interface BonitaSettings {
  /** Global enable flag (currently unused at the settings layer; site-level
   *  opt-in is managed via `sessionStorage` in the overlay). */
  enabled: boolean

  /**
   * Controls which tool icons are shown in the toolbar dock, independent of
   * whether a visible tool is currently *active* on the page.
   *
   * Set from the extension popup. A tool whose flag here is `false` is
   * entirely absent from the dock — not merely disabled or greyed out — so
   * the dock only ever shows tools the user has opted into seeing.
   *
   * `font` has no entry: {@link FontSelector} has no corresponding popup
   * checkbox and is always shown in the dock.
   */
  enabledTools: Record<ToolId, boolean>

  /** Active reading font applied to the page's body text. */
  font: 'default' | 'opendyslexic' | 'arial' | 'verdana'

  /** Whether paragraph text is split into per-sentence bullet lists. */
  sentenceSplitting: boolean

  /** Whether bullet-point reformatting is active (distinct from sentence splitting). */
  bulletPoints: boolean

  /** Whether high-frequency keyword phrases are bolded in body text. */
  keywordBolding: boolean

  /**
   * Maximum number of distinct keyword phrases to bold per page.
   * Passed to the keyword extractor; higher values bold more terms.
   */
  boldTargetCount: number

  boldThresholdPercent: number

  /** CSS colour string applied to bolded keyword spans. */
  boldColor: string

  /**
   * Per–part-of-speech highlight toggles.
   * Each key maps to a boolean controlling whether that POS class is
   * highlighted on the page.
   */
  posEnabled: {
    verbs: boolean
    nouns: boolean
    adjectives: boolean
  }

  /**
   * CSS colour strings used for each part-of-speech highlight class.
   * Only applied when the corresponding {@link posEnabled} flag is `true`.
   */
  posColors: {
    verbs: string
    nouns: string
    adjectives: string
  }

  /** Whether the line-focus overlay (dims non-active lines) is active. */
  lineFocus: boolean

  /**
   * Height of the line-focus band in pixels.
   *
   * Controls how tall the illuminated region is as the user moves their
   * cursor over the page.  Clamped at render time between
   * `LINE_FOCUS_MIN_PX` (24) and `LINE_FOCUS_MAX_PX` (200) defined in
   * {@link LineFocusToggle}.
   *
   * @default 48
   */
  lineFocusHeight: number

  /** Whether complex words are replaced with simpler synonyms on hover/click. */
  wordSimplification: boolean

  wordComplexity: 'low' | 'medium' | 'high'

  /** Whether the text-to-speech reader is active. */
  tts: boolean

  /** Controls how inline images are treated when tools are active. */
  imageHandling: 'keep' | 'strip' | 'bottom'
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

/**
 * Default toolbar visibility: every tool is shown in the dock out of the box.
 * Users opt *out* via the popup rather than opting in.
 */
const defaultEnabledTools: Record<ToolId, boolean> = {
  sentenceSplitting: true,
  keywordBolding: true,
  wordSimplification: true,
  pos: true,
  lineFocus: true,
  tts: true,
}

/**
 * Safe baseline for every {@link BonitaSettings} field.
 *
 * Used as the merge target in {@link mergeSettings} so a partial or missing
 * storage value always produces a complete, valid settings object.
 * All tools start disabled; colours match the Bonita design tokens.
 */
export const defaultSettings: BonitaSettings = {
  enabled: false,
  enabledTools: defaultEnabledTools,
  font: 'default',
  sentenceSplitting: false,
  bulletPoints: false,
  keywordBolding: false,
  boldTargetCount: 7,
  boldThresholdPercent: 50,
  boldColor: '#3e236b',
  posEnabled: {
    verbs: false,
    nouns: false,
    adjectives: false,
  },
  posColors: {
    verbs: '#4A90D9',
    nouns: '#27AE60',
    adjectives: '#E67E22',
  },
  lineFocus: false,
  lineFocusHeight: 48,
  wordSimplification: false,
  wordComplexity: 'medium',
  tts: false,
  imageHandling: 'keep',
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** The key used for both `chrome.storage.sync` and `localStorage`. */
const storageKey = 'bonitaSettings'

/**
 * Returns `true` when running inside an extension context that has access to
 * `chrome.storage.sync`.  Falls back to `false` in plain browser tabs (e.g.
 * Vite dev server).
 */
const hasChromeStorage = (): boolean =>
  typeof chrome !== 'undefined' && Boolean(chrome.storage?.sync)

/**
 * Deep-merges an unknown storage value with {@link defaultSettings}.
 *
 * Handles the common case where only some settings have been saved (e.g. on
 * first install, or after adding new fields) by filling missing keys from
 * `defaultSettings`.  Nested objects (`posEnabled`, `posColors`,
 * `enabledTools`) are also merged shallowly so individual sub-keys can be
 * absent without error — this matters for `enabledTools` in particular,
 * since it was added after the original settings shape and existing stored
 * settings won't have it yet.
 *
 * @param settings - Raw value read from storage; may be `null`, `undefined`,
 *   or a partial {@link BonitaSettings} object.
 * @returns A complete, validated {@link BonitaSettings} object.
 */
const mergeSettings = (settings: unknown): BonitaSettings => {
  if (!settings || typeof settings !== 'object') {
    return defaultSettings
  }

  const next = settings as Partial<BonitaSettings>
  return {
    ...defaultSettings,
    ...next,
    enabledTools: {
      ...defaultSettings.enabledTools,
      ...next.enabledTools,
    },
    posEnabled: {
      ...defaultSettings.posEnabled,
      ...next.posEnabled,
    },
    posColors: {
      ...defaultSettings.posColors,
      ...next.posColors,
    },
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Reads the current {@link BonitaSettings} from storage.
 *
 * Uses `chrome.storage.sync` in extension contexts, or `localStorage` in
 * plain browser tabs (Vite dev).  The raw value is always passed through
 * {@link mergeSettings} so callers always receive a fully-populated object.
 *
 * @returns A promise that resolves to the current settings.
 */
export const getSettings = async (): Promise<BonitaSettings> => {
  if (hasChromeStorage()) {
    const res = await chrome.storage.sync.get(storageKey)
    return mergeSettings(res[storageKey])
  }

  const cached = localStorage.getItem(storageKey)
  return cached ? mergeSettings(JSON.parse(cached)) : defaultSettings
}

/**
 * Persists a complete {@link BonitaSettings} object to storage.
 *
 * In extension contexts, writes to `chrome.storage.sync`.  In plain browser
 * tabs, writes to `localStorage` and dispatches a synthetic `CustomEvent` so
 * any {@link onSettingsChanged} listeners registered in the same tab still
 * fire.
 *
 * @param settings - The full settings object to persist.
 * @returns A promise that resolves when the write is complete.
 */
export const saveSettings = async (settings: BonitaSettings): Promise<void> => {
  if (hasChromeStorage()) {
    await chrome.storage.sync.set({ [storageKey]: settings })
    return
  }

  localStorage.setItem(storageKey, JSON.stringify(settings))
  window.dispatchEvent(new CustomEvent(storageKey, { detail: settings }))
}

/**
 * Registers a callback that fires whenever {@link BonitaSettings} change in
 * storage.
 *
 * In extension contexts, listens on `chrome.storage.onChanged`.  In plain
 * browser tabs, listens for the synthetic `CustomEvent` dispatched by
 * {@link saveSettings}.
 *
 * @param handler - Called with the new, fully-merged settings on every change.
 * @returns A cleanup function that removes the listener; pass it to a
 *   `useEffect` return or call it manually when the listener is no longer needed.
 */
export const onSettingsChanged = (
  handler: (settings: BonitaSettings) => void,
): (() => void) => {
  if (hasChromeStorage()) {
    const listener = (
      changes: { [key: string]: chrome.storage.StorageChange },
    ) => {
      if (changes[storageKey]) {
        handler(mergeSettings(changes[storageKey].newValue))
      }
    }

    chrome.storage.onChanged.addListener(listener)
    return () => chrome.storage.onChanged.removeListener(listener)
  }

  const listener = (event: Event) => {
    handler(mergeSettings((event as CustomEvent<BonitaSettings>).detail))
  }

  window.addEventListener(storageKey, listener)
  return () => window.removeEventListener(storageKey, listener)
}