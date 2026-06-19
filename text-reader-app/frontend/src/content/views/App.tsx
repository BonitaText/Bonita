/**
 * @file views/App.tsx
 *
 * Root component for the Bonita reading-tools overlay.
 *
 * Renders a draggable trigger button and a floating dock that contains the
 * master site-enable toggle and all individual reading tool controls.
 *
 * ## Layout
 * The trigger button is `position: fixed` and draggable to any screen position.
 * The dock appears anchored above and to the left of the trigger when it is
 * clicked (not dragged), and closes when the user clicks outside both elements.
 *
 * ## Per-site enable / disable
 * A master toggle at the top of the dock controls whether tools are active on
 * the current hostname.  State lives in `sessionStorage` (via
 * {@link getSiteEnabled} / {@link setSiteEnabled}) so:
 * - Each hostname is independent.
 * - A new tab always starts with tools **disabled** (opt-in).
 * - State is forgotten when the tab closes.
 *
 * ## Toolbar visibility (popup-controlled)
 * Which tool icons appear in the dock is controlled separately from whether
 * a visible tool is currently active. {@link BonitaSettings.enabledTools},
 * set from the extension popup, lists one boolean per tool id; a tool whose
 * flag is `false` is skipped entirely when the dock renders — its icon does
 * not appear, rather than appearing disabled or greyed out. This is
 * independent of {@link getSiteEnabled} / `siteEnabled`, which gates the
 * *entire* dock (all tools at once) per hostname. `enabledTools` instead
 * gates each tool icon individually, regardless of hostname.
 *
 * ## Disable-path ordering (latency fix)
 * When the master toggle is turned off, the settings reset is deliberately
 * **deferred** with `setTimeout(fn, 0)`.  This allows React to unmount all
 * tool components first — running their cleanup effects and removing all DOM
 * modifications — before `updateSettings` triggers a new settings state change
 * and storage write.  Without this deferral, hooks would fire twice: once in
 * response to the settings change and once on unmount, causing a double DOM
 * cleanup cycle that was the main source of disable-path latency.
 *
 * ## `ready` gate
 * Tool components are only mounted when both `siteEnabled` and `ready` are
 * `true`.  The `ready` flag comes from {@link SettingsProvider} and is `false`
 * until the initial `chrome.storage.sync.get()` resolves.  This prevents tool
 * hooks from running once with {@link defaultSettings} and then immediately
 * again with real stored values, which was causing a redundant DOM work cycle
 * on every first toggle.
 *
 * ## Popup management
 * At most one tool popup (bold options, POS options, font selector) is open at
 * a time.  `openPopup` tracks the active one; `togglePopup` closes it when the
 * same button is pressed again or opens a new one (closing the previous).
 *
 * ## Trigger position
 * The trigger button's position is persisted to `sessionStorage` (via
 * {@link getTriggerPos} / {@link saveTriggerPos}) so it survives disable/re-enable
 * cycles within the same tab without jumping back to the default corner.
 * A `resize` listener re-clamps the position within the new viewport bounds
 * whenever the window is resized, split-screened, or fullscreened, preventing
 * the trigger from drifting off-screen.
 */

import { useEffect, useRef, useState } from 'react'
import { useSettings } from '../hooks/useSettings'

import FontSelector from './FontSelector'
import LineFocusToggle from './LineFocusToggle'
import PhraseBolding from './PhraseBolding'
import POSHighlight from './POSHighlight'
import SentenceSplitting from './SentenceSplitting'
import ReadingToolsController from './ReadingToolsController'
import TTSReader from './TTSReader'
import WordSimplify from './WordSimplify'


// ─── Constants ────────────────────────────────────────────────────────────────

/** Point size of the square trigger button (width = height, and 1 pt = 1.3333... px). */
const TRIGGER_SIZE = 58

/** Default distance from the right and bottom viewport edges on first render. */
const DEFAULT_MARGIN = 40

/**
 * Minimum pointer-travel distance (px) before a mousedown is classified as a
 * drag rather than a click.  Prevents accidental dock-toggles when the user
 * intends to move the button slightly.
 */
const DRAG_THRESHOLD = 5

// ─── sessionStorage helpers ───────────────────────────────────────────────────

/**
 * `sessionStorage` key for the per-hostname enabled map.
 *
 * The value is a JSON object: `{ [hostname: string]: boolean }`.
 * `sessionStorage` is intentional — state never outlives the tab, so a fresh
 * tab always starts with tools disabled (opt-in behaviour per hostname).
 */
const SESSION_KEY = 'bonita-site-enabled'

/**
 * `sessionStorage` key for the trigger button's last known position.
 *
 * The value is a JSON object: `{ left: number; top: number }`.
 * Persisting to `sessionStorage` (rather than `chrome.storage`) keeps the
 * position tab-local and avoids unnecessary storage round-trips on every drag.
 */
const POS_KEY = 'bonita-trigger-pos'

/**
 * Reads whether Bonita is enabled for the current hostname from
 * `sessionStorage`.
 *
 * Defaults to `false` for any hostname not yet in the map, enforcing opt-in
 * behaviour on first visit.
 *
 * @returns `true` if the user enabled Bonita on this hostname during the
 *   current session, `false` otherwise.
 */
function getSiteEnabled(): boolean {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    if (!raw) return false
    const map: Record<string, boolean> = JSON.parse(raw)
    return map[location.hostname] ?? false
  } catch {
    return false
  }
}

/**
 * Persists the enabled state for the current hostname into `sessionStorage`.
 *
 * Merges with the existing map so other hostnames are not affected.
 *
 * @param value - The new enabled state to store for `location.hostname`.
 */
function setSiteEnabled(value: boolean): void {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    const map: Record<string, boolean> = raw ? JSON.parse(raw) : {}
    map[location.hostname] = value
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(map))
  } catch {
    // sessionStorage unavailable (e.g. private browsing with strict settings) — fail silently
  }
}

/**
 * Reads the last saved trigger position from `sessionStorage`.
 *
 * Returns `null` if no position has been saved yet (e.g. first visit), so the
 * caller can fall back to the default bottom-right corner position.
 *
 * @returns The saved `{ left, top }` position, or `null` if absent.
 */
function getTriggerPos(): { left: number; top: number } | null {
  try {
    const raw = sessionStorage.getItem(POS_KEY)
    if (!raw) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/**
 * Persists the trigger button's current position to `sessionStorage`.
 *
 * Called on every drag end so the position survives disable/re-enable cycles
 * within the same tab without resetting to the default corner.
 *
 * @param pos - The `{ left, top }` coordinates to persist.
 */
function saveTriggerPos(pos: { left: number; top: number }): void {
  try {
    sessionStorage.setItem(POS_KEY, JSON.stringify(pos))
  } catch {
    // sessionStorage unavailable — fail silently
  }
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = `
  :root {
    --bonita-purple: #6f4fd8;
    --bonita-purple-dark: #2d2148;
    --bonita-cream: #f7f0df;
    --bonita-white: #fffdf8;
    --bonita-grey: #716b7b;
    --bonita-black: #17131f;
  }

  .bonita-trigger {
    position: fixed;
    width: 58px;
    height: 58px;
    border-radius: 18px;
    background:
      radial-gradient(circle at 28% 24%, rgba(255, 253, 248, 0.44), transparent 28px),
      linear-gradient(145deg, #8061ee, #4b2fa2);
    border: 1px solid rgba(255, 253, 248, 0.42);
    cursor: grab;
    pointer-events: auto;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 18px 44px rgba(45, 33, 72, 0.36);
    z-index: 2147483647;
    transition: transform 0.22s ease, box-shadow 0.22s ease, filter 0.22s ease;
    color: white;
    font-weight: 900;
    font-size: 20px;
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    user-select: none;
  }

  .bonita-trigger:active { cursor: grabbing; }

  .bonita-trigger:hover {
    transform: translateY(-3px) scale(1.04);
    box-shadow: 0 22px 54px rgba(45, 33, 72, 0.44);
    filter: saturate(1.08);
  }

  .bonita-trigger.open { border-radius: 50%; }

  .bonita-trigger-mark {
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    border-radius: 12px;
    background: rgba(255, 253, 248, 0.16);
    box-shadow: inset 0 0 0 1px rgba(255, 253, 248, 0.18);
  }

  .bonita-dock {
    position: fixed;
    box-sizing: border-box;
    width: 70px;
    min-width: 70px;
    background:
      linear-gradient(180deg, rgba(255, 253, 248, 0.96), rgba(247, 240, 223, 0.94));
    border: 1px solid rgba(111, 79, 216, 0.20);
    border-radius: 26px;
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    align-items: center;
    box-shadow: 0 20px 58px rgba(23, 19, 31, 0.22);
    z-index: 2147483646;
    pointer-events: auto;
    opacity: 0;
    transform: translateY(12px) scale(0.88);
    transform-origin: bottom right;
    transition: transform 0.22s ease, opacity 0.18s ease;
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    backdrop-filter: blur(18px);
  }

  .bonita-dock.open {
    opacity: 1;
    transform: translateY(0) scale(1);
  }

  .bonita-dock-header {
    display: grid;
    justify-items: center;
    gap: 1px;
    padding: 8px 0 10px;
    border-bottom: 1px solid rgba(111, 79, 216, 0.15);
    text-align: center;
  }

  .bonita-dock-header strong {
    color: var(--bonita-purple-dark);
    font-size: 16px;
    line-height: 1.15;
    letter-spacing: 0;
  }

  .bonita-dock-header span {
    color: var(--bonita-grey);
    max-width: 66px;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.03em;
    line-height: 1.18;
    text-transform: uppercase;
  }

  .bonita-icon-btn {
    box-sizing: border-box;
    width: 48px;
    height: 48px;
    border-radius: 16px;
    border: none;
    background: rgba(255, 253, 248, 0.72);
    color: var(--bonita-grey);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.18s ease, color 0.18s ease, transform 0.18s ease, box-shadow 0.18s ease;
    position: relative;
    padding: 0;
  }

  .bonita-icon-btn:hover {
    background: #f7f0df;
    color: var(--bonita-purple);
    transform: translateX(-2px);
  }

  .bonita-icon-btn.active {
    background: linear-gradient(145deg, #7f5df0, #5634b8);
    color: white;
    box-shadow: 0 12px 26px rgba(111, 79, 216, 0.30);
  }

  .bonita-icon-btn::before {
    content: attr(data-tooltip);
    position: absolute;
    right: 100%;
    top: 50%;
    transform: translateY(-50%);
    margin-right: 10px;
    background: var(--bonita-black);
    color: var(--bonita-white);
    padding: 7px 11px;
    border-radius: 10px;
    font-size: 12px;
    font-weight: 700;
    white-space: nowrap;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.15s ease, transform 0.15s ease;
    box-shadow: 0 12px 28px rgba(23, 19, 31, 0.22);
  }

  .bonita-icon-btn:hover::before {
    opacity: 1;
    transform: translateY(-50%) translateX(-2px);
  }

  .bonita-font-wrapper { position: relative; }

  .bonita-font-popup,
  .bonita-pos-popup {
    position: absolute;
    right: calc(100% + 12px);
    top: 0;
    background: var(--bonita-white);
    border: 1px solid rgba(111, 79, 216, 0.18);
    border-radius: 16px;
    padding: 8px;
    box-shadow: 0 18px 44px rgba(23, 19, 31, 0.18);
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 160px;
    animation: bonita-pop 180ms ease both;
    max-height: 110px;
    overflow-y: auto;
  }

  .bonita-font-option {
    border: none;
    background: transparent;
    padding: 10px 12px;
    border-radius: 10px;
    cursor: pointer;
    font-size: 13px;
    color: var(--bonita-black);
    text-align: left;
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    transition: background 0.16s ease, color 0.16s ease;
  }

  .bonita-font-option:hover { background: #f7f0df; }

  .bonita-font-option.selected {
    background: var(--bonita-purple);
    color: white;
  }

  @keyframes bonita-pop {
    from { opacity: 0; transform: translateX(6px) scale(0.98); }
    to   { opacity: 1; transform: translateX(0) scale(1); }
  }

  @media (prefers-reduced-motion: reduce) {
    .bonita-trigger,
    .bonita-dock,
    .bonita-icon-btn,
    .bonita-font-popup,
    .bonita-pos-popup {
      transition: none !important;
      animation: none !important;
    }
  }

  /* ── Site toggle ── */
  .bonita-site-toggle {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 48px;
    height: 28px;
    border-radius: 14px;
    border: none;
    cursor: pointer;
    padding: 0;
    position: relative;
    transition: background 0.22s ease, box-shadow 0.22s ease;
    flex-shrink: 0;
  }

  .bonita-site-toggle.off {
    background: rgba(113, 107, 123, 0.18);
  }

  .bonita-site-toggle.on {
    background: linear-gradient(145deg, #7f5df0, #5634b8);
    box-shadow: 0 6px 18px rgba(111, 79, 216, 0.32);
  }

  .bonita-site-toggle-knob {
    position: absolute;
    width: 22px;
    height: 22px;
    border-radius: 11px;
    background: white;
    box-shadow: 0 2px 6px rgba(23, 19, 31, 0.18);
    transition: left 0.22s ease;
    top: 3px;
  }

  .bonita-site-toggle.off .bonita-site-toggle-knob { left: 3px; }
  .bonita-site-toggle.on  .bonita-site-toggle-knob { left: 23px; }

  .bonita-divider {
    width: 36px;
    height: 1px;
    background: rgba(111, 79, 216, 0.15);
    flex-shrink: 0;
  }
`

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Root component for the Bonita reading-tools overlay.
 *
 * Renders a draggable trigger button and a floating dock.  See the file-level
 * JSDoc for architecture details.
 */
function App() {
  /** Whether the dock is currently visible. */
  const [open, setOpen] = useState(false)

  /**
   * Screen coordinates of the trigger button's top-left corner.
   *
   * Initialised from `sessionStorage` if a saved position exists (so the
   * trigger stays where the user last dragged it across disable/re-enable
   * cycles), falling back to the bottom-right viewport corner with
   * {@link DEFAULT_MARGIN} padding on first render.
   */
  const [pos, setPos] = useState(() => {
    const saved = getTriggerPos()
    if (saved) return saved
    return {
      left: window.innerWidth - TRIGGER_SIZE - DEFAULT_MARGIN,
      top: window.innerHeight - TRIGGER_SIZE - DEFAULT_MARGIN,
    }
  })

  /**
   * Master per-site enabled flag.
   *
   * Seeded from `sessionStorage` on mount via {@link getSiteEnabled} so the
   * value survives in-page navigation but not tab closure or new tabs.
   */
  const [siteEnabled, setSiteEnabledState] = useState<boolean>(getSiteEnabled)

  /**
   * Which tool popup is currently open, or `null` if none.
   * At most one popup is open at a time.
   */
  const [openPopup, setOpenPopup] = useState<'bold' | 'pos' | 'font' | 'lineFocus' | 'wordComplexity' | null>(null)

  const { settings, updateSettings, ready } = useSettings()

  /**
   * Convenience lookup for dock-icon visibility, sourced from the popup via
   * {@link BonitaSettings.enabledTools}. Falls back to showing every tool if
   * `enabledTools` is somehow absent (e.g. settings loaded before the merge
   * helper back-filled it), so a missing field never silently hides the
   * entire dock.
   */
  const toolVisible = settings.enabledTools ?? {
    sentenceSplitting: true,
    keywordBolding: true,
    wordSimplification: true,
    pos: true,
    lineFocus: true,
    tts: true,
  }

  const triggerRef = useRef<HTMLButtonElement>(null)
  const dockRef = useRef<HTMLDivElement>(null)

  /**
   * Persists the trigger position to `sessionStorage` whenever it changes.
   *
   * This ensures the user's chosen position survives disable/re-enable cycles
   * within the same tab without resetting to the default corner.
   */
  useEffect(() => {
    saveTriggerPos(pos)
  }, [pos])

  /**
   * Re-clamps the trigger position within the viewport on resize.
   *
   * Handles split-screen, fullscreen transitions, and window resizing — the
   * trigger snaps to the nearest valid in-bounds position instead of drifting
   * off-screen or glitching back to the default corner.
   */
  useEffect(() => {
    const onResize = () => {
      setPos(prev => ({
        left: Math.max(0, Math.min(window.innerWidth - TRIGGER_SIZE, prev.left)),
        top: Math.max(0, Math.min(window.innerHeight - TRIGGER_SIZE, prev.top)),
      }))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  /**
   * Toggles a named popup open or closed.
   *
   * Opening a new popup implicitly closes the previously open one, ensuring
   * at most one popup is visible at any time.
   *
   * @param name - The popup identifier to toggle.
   */
  const togglePopup = (name: 'bold' | 'pos' | 'font' | 'lineFocus' | 'wordComplexity'): void =>
    setOpenPopup(prev => (prev === name ? null : name))

  /**
   * Toggles the master site-enabled flag.
   *
   * **Enable path:**
   * - Persists `true` to `sessionStorage` for this hostname.
   * - Tool components mount on the next render and their hooks initialise from
   *   current settings.
   *
   * **Disable path:**
   * - Persists `false` to `sessionStorage` for this hostname.
   * - Closes any open tool popup immediately.
   * - Tool components unmount on the next render, running their cleanup effects
   *   and removing all DOM modifications.
   * - After unmount (deferred via `setTimeout(fn, 0)`), `updateSettings` resets
   *   all tool flags to `false` in a single `chrome.storage` write.
   *
   * The `setTimeout` deferral on the settings reset is the key latency fix:
   * without it, hooks would react to the settings change (first cleanup pass)
   * AND then react to unmounting (second cleanup pass), doubling DOM work on
   * every disable.
   */
  const handleSiteToggle = (): void => {
    const next = !siteEnabled
    setSiteEnabledState(next)
    setSiteEnabled(next)

    if (!next) {
      setOpenPopup(null)

      // Defer the settings reset until after React has unmounted tool
      // components and their cleanup effects have run.  This prevents a
      // double-cleanup cycle: hooks would otherwise fire once for the settings
      // change and once for unmount.
      setTimeout(() => {
        updateSettings({
          font: 'default',
          keywordBolding: false,
          posEnabled: { verbs: false, nouns: false, adjectives: false },
          lineFocus: false,
          sentenceSplitting: false,
          tts: false,
          wordSimplification: false,   
          wordComplexity: 'medium',   
        })
      }, 0)
    }
  }

  /**
   * Closes the dock when the user clicks outside both the trigger and the dock.
   *
   * The listener is registered on `document` in capture phase so it fires
   * before any internal click handlers.  It is only active while the dock is
   * open, avoiding a permanent global listener when the dock is closed.
   */
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (
        triggerRef.current?.contains(e.target as Node) ||
        dockRef.current?.contains(e.target as Node)
      )
        return
      setOpen(false)
    }
    document.addEventListener('mousedown', handler, true)
    return () => document.removeEventListener('mousedown', handler, true)
  }, [open])

  /**
   * Mutable ref tracking drag state for the trigger button.
   *
   * A ref (not state) is used deliberately: updating it during a drag does not
   * trigger re-renders, keeping drag performance smooth.
   */
  const dragStateRef = useRef({
    originLeft: 0,
    originTop: 0,
    startX: 0,
    startY: 0,
    /** `true` once the pointer has moved beyond {@link DRAG_THRESHOLD} pixels. */
    moved: false,
  })

  /**
   * Handles `mousedown` on the trigger button.
   *
   * Distinguishes between a **click** (toggle dock) and a **drag** (reposition
   * trigger) by tracking pointer travel distance:
   * - Travel > {@link DRAG_THRESHOLD} px before `mouseup` → drag; updates
   *   `pos`, clamped to keep the trigger fully within the viewport.
   * - `mouseup` without exceeding the threshold → click; toggles `open`.
   *
   * Global `mousemove` / `mouseup` listeners are attached for the duration of
   * the interaction and removed on `mouseup` to avoid leaking handlers.
   *
   * @param e - The React synthetic `mousedown` event on the trigger button.
   */
  const onMouseDown = (e: React.MouseEvent): void => {
    e.preventDefault()
    dragStateRef.current = {
      originLeft: pos.left,
      originTop: pos.top,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
    }

    const onMove = (ev: MouseEvent): void => {
      const s = dragStateRef.current
      const dx = ev.clientX - s.startX
      const dy = ev.clientY - s.startY
      if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
        s.moved = true
      }
      if (s.moved) {
        setPos({
          left: Math.max(
            0,
            Math.min(window.innerWidth - TRIGGER_SIZE, s.originLeft + dx),
          ),
          top: Math.max(
            0,
            Math.min(window.innerHeight - TRIGGER_SIZE, s.originTop + dy),
          ),
        })
      }
    }

    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      if (!dragStateRef.current.moved) setOpen(o => !o)
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  /**
   * Positions the dock from the same anchor coordinates as the trigger.
   *
   * Using the same left/top coordinate system prevents drift when the
   * viewport size or browser zoom changes.
   */

  

  const dockLeft = pos.left - 6
  const dockBottom = window.innerHeight - (pos.top - 10)
  return (
    <>
      <style>{styles}</style>

      <button
        ref={triggerRef}
        className={`bonita-trigger ${open ? 'open' : ''}`}
        style={{ left: pos.left, top: pos.top }}
        onMouseDown={onMouseDown}
        title="drag to move"
        data-bonita-root="true"
      >
        <span className="bonita-trigger-mark">B</span>
      </button>

      <div
        ref={dockRef}
        className={`bonita-dock ${open ? 'open' : ''}`}
        style={{
          left: dockLeft,
          bottom: dockBottom,
          
        }}
        data-bonita-root="true"
      >
        <div className="bonita-dock-header">
          <strong>Bonita</strong>
          <span>
            Reading
            <br />
            Tools
          </span>
        </div>

        {/*
         * Master site toggle.
         * Always rendered regardless of siteEnabled so the user can re-enable
         * tools without needing to interact with a collapsed or hidden control.
         */}
        <button
          className={`bonita-site-toggle ${siteEnabled ? 'on' : 'off'}`}
          onClick={handleSiteToggle}
          data-tooltip={siteEnabled ? 'Disable on this site' : 'Enable on this site'}
          aria-label={
            siteEnabled
              ? 'Disable Bonita on this site'
              : 'Enable Bonita on this site'
          }
          aria-pressed={siteEnabled}
        >
          <span className="bonita-site-toggle-knob" />
        </button>

        {/*
         * Tool buttons — only mounted while both siteEnabled and ready are true.
         *
         * `siteEnabled`: unmounting (rather than hiding) ensures hooks clean up
         * naturally and no stale popup state persists across disable/re-enable.
         *
         * `ready`: prevents tool hooks from firing once with defaultSettings
         * and again with real stored values, avoiding a redundant DOM work cycle
         * on every first enable.
         *
         * Each individual tool is additionally gated on `toolVisible[id]`,
         * set from the extension popup. A tool with its flag off is skipped
         * entirely — its icon does not render in the dock — independent of
         * `siteEnabled`/`ready`, which gate the dock as a whole.
         */}
        {siteEnabled && ready && (
          <>
          <ReadingToolsController />   {/* ← add this */}
          <div className="bonita-divider" />
          {toolVisible.sentenceSplitting && (
            <div onClick={() => setOpenPopup(null)}>
              <SentenceSplitting />
            </div>
          )}
          {toolVisible.keywordBolding && (
            <PhraseBolding
              open={openPopup === 'bold'}
              onOpen={() => togglePopup('bold')}
            />
          )}
          {toolVisible.pos && (
            <POSHighlight
              open={openPopup === 'pos'}
              onOpen={() => togglePopup('pos')}
            />
          )}
          {toolVisible.wordSimplification && (
            <WordSimplify
              open={openPopup === 'wordComplexity'}
              onOpen={() => togglePopup('wordComplexity')}
            />
          )}
          {toolVisible.lineFocus && (
            <LineFocusToggle
              open={openPopup === 'lineFocus'}
              onOpen={() => togglePopup('lineFocus')}
            />
          )}
          {toolVisible.tts && (
            <div onClick={() => setOpenPopup(null)}>
              <TTSReader />
            </div>
          )}
          <FontSelector
            open={openPopup === 'font'}
            onOpen={() => togglePopup('font')}
          />
          </>
        )}
      </div>
    </>
  )
}

export default App