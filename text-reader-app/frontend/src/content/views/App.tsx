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
 * a time.  `openPopup` tracks the active one. A tool's popup opens on hover
 * (while the tool is enabled) via `showPopup`, and closes on hover-out via
 * `hidePopup` — independent of the tool's own on/off click. Opening a new
 * popup (via `showPopup`) implicitly replaces whichever was previously open,
 * ensuring at most one is visible at any time.
 *
 * ## Trigger position (cross-tab, cross-site)
 * The trigger button's position and tucked state are persisted to
 * `chrome.storage.local` (via the `POS_KEY` reads/writes below), NOT
 * `sessionStorage`. `chrome.storage.local` is shared across every open tab
 * and every site the extension runs on, so:
 * - Dragging the trigger on one page updates its position everywhere else,
 *   live, via a `chrome.storage.onChanged` listener.
 * - Tucking the trigger away on one page tucks it away on every other open
 *   tab immediately, instead of only where you tucked it.
 * This is a deliberate split from the per-site logic above: physical
 * position/tuck state is a UI-chrome preference (belongs to "the browser"),
 * while `siteEnabled` and `enabledTools` remain per-hostname/session so
 * tools never silently activate somewhere you didn't opt in.
 *
 * Writes to `chrome.storage.local` only happen when a drag/tuck gesture
 * settles (on mouseup), not on every drag frame, to avoid spamming every
 * other tab with updates mid-drag. A `resize` listener re-clamps/re-pins the
 * position within the new viewport bounds whenever the window is resized,
 * split-screened, or fullscreened.
 *
 * ## Edge tucking
 * Dropping the trigger within {@link EDGE_SNAP_THRESHOLD}px of the left or
 * right edge on drag-release snaps it fully off-screen except for a
 * {@link TUCK_PEEK_LEFT}/{@link TUCK_PEEK_RIGHT}px sliver, per edge
 * (`pos.tuckedSide` tracks which edge), and closes the dock if it was open.
 * While tucked, a plain click (not a drag) slides the trigger back to a
 * fully visible position instead of opening the dock — it stays there until
 * the user drags it near an edge again. The tucked side is persisted
 * alongside position so it survives reloads/new tabs, and the `resize`
 * listener re-pins tucked triggers to their edge (rather than clamping them
 * back on-screen) whenever the viewport changes size.
 */

import { useEffect, useRef, useState } from 'react'
import { useSettings } from '../hooks/useSettings'

import lightButtonIcon from '../../assets/dock/light_button_2000.png'
import darkButtonIcon from '../../assets/dock/dark_button_2000.png'

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
const TRIGGER_SIZE = 75

/** Default distance from the right and bottom viewport edges on first render. */
const DEFAULT_MARGIN = 40

/**
 * Minimum pointer-travel distance (px) before a mousedown is classified as a
 * drag rather than a click.  Prevents accidental dock-toggles when the user
 * intends to move the button slightly.
 */
const DRAG_THRESHOLD = 5

/**
 * How close (px) to the left/right viewport edge the trigger must be dropped
 * for a drag-release to snap and tuck it against that edge.
 */
const EDGE_SNAP_THRESHOLD = 70

/**
 * Width (px) of the trigger that remains visible when tucked against the
 * left edge — the rest is pushed off-screen.
 */
const TUCK_PEEK_LEFT = 25

/**
 * Width (px) of the trigger that remains visible when tucked against the
 * right edge — the rest is pushed off-screen. Independent of
 * {@link TUCK_PEEK_LEFT} so each edge can show a different amount.
 */
const TUCK_PEEK_RIGHT = 25

// ─── Storage helpers ────────────────────────────────────────────────────────

/**
 * `sessionStorage` key for the per-hostname enabled map.
 *
 * The value is a JSON object: `{ [hostname: string]: boolean }`.
 * `sessionStorage` is intentional — state never outlives the tab, so a fresh
 * tab always starts with tools disabled (opt-in behaviour per hostname).
 */
const SESSION_KEY = 'bonita-site-enabled'

/**
 * `chrome.storage.local` key for the trigger button's position + tuck state.
 *
 * Using `chrome.storage.local` (not `sessionStorage`) means position and
 * tuck state are shared across every tab and every site — moving or tucking
 * the trigger on one page updates it everywhere, live. The extension already
 * has the `storage` permission (used by `chrome.storage.sync` in
 * `useSettings`), so no manifest change is needed.
 */
const POS_KEY = 'bonita-trigger-pos'

/**
 * `chrome.storage.local` key for the shared DPR baseline used by
 * `useZoomCorrection` to counter page-zoom's effect on apparent trigger
 * size. Shared across all tabs (not captured fresh per tab-mount) so a tab
 * that happens to load already zoomed to 200% renders the trigger at the
 * SAME physical size as a tab that loaded at 100% — previously each tab
 * treated whatever DPR it woke up at as "normal," so two tabs loaded at
 * different zoom levels disagreed on what size counted as unscaled.
 */
 const DPR_BASELINE_KEY = 'bonita-dpr-baseline'

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
* Live, in-memory position (CSS px) — used for rendering, dragging, and
* resize-clamping math. Never written to storage directly; see
* {@link StoredTriggerPos} / {@link toStoredPos} / {@link applySavedPos}.
*/
interface TriggerPos {
  left: number
  top: number
  tuckedSide: 'left' | 'right' | null
}

/**
 * Shape persisted to `chrome.storage.local`.
 *
 * Position is stored as FRACTIONS of the viewport (0–1), not absolute CSS
 * pixels — deliberately. CSS px are relative to that tab's current zoom
 * level, so a raw-px position saved from a tab at 100% zoom lands in the
 * wrong physical spot when applied to a tab at 200% zoom. "50% across" is
 * the physical center of the window regardless of zoom, so storing
 * fractions makes the saved spot zoom-invariant automatically — no DPR
 * math required for position, only for the separate size correction (see
 * `useZoomCorrection`'s shared baseline below).
 */
interface StoredTriggerPos {
  leftFrac: number
  topFrac: number
  tuckedSide: 'left' | 'right' | null
}

/** Converts live px position → the fraction-based shape written to storage. */
function toStoredPos(p: TriggerPos): StoredTriggerPos {
  return {
    leftFrac: p.left / window.innerWidth,
    topFrac: p.top / window.innerHeight,
    tuckedSide: p.tuckedSide,
   }
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = `
    :host {
    --bonita-purple: #6f4fd8;
    --bonita-purple-dark: #2d2148;
    --bonita-cream: #f7f0df;
    --bonita-white: #fffdf8;
    --bonita-grey: #716b7b;
    --bonita-black: #17131f;
  }
  
  .bonita-vv-anchor {
    position: fixed;
    top: 0;
    left: 0;
    width: 0;
    height: 0;
    transform-origin: 0 0;
    pointer-events: none;
  }

  .bonita-pos-anchor {
    position: absolute;
    top: 0;
    left: 0;
    width: 58px;   
    height: 58px;
    pointer-events: none;
    transform: scale(var(--bonita-zoom, 1));
    transform-origin: 0 0;
  }

  .bonita-trigger {
    position: absolute;
    top: 0;
    left: 0;
    width: 58px;
    height: 58px;
    border-radius: 18px;
    background: transparent;
    border: none;
    cursor: grab;
    pointer-events: auto;
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 2147483647;
    transition: left 0.25s ease, transform 0.3s ease, filter 0.22s ease, opacity 0.22s ease, border-radius 0.25s ease;
    overflow: hidden;
    transform: rotate(var(--bonita-rotation, 0deg));
    box-shadow: 0px 0px 30px rgba(23, 19, 31, 0.40);
  }

  .bonita-trigger-icon {
    width: 140%;
    height: 140%;
    object-fit: contain;
    pointer-events: none;
    user-select: none;
    transition: filter 0.22s ease;
  }



  .bonita-trigger:active { cursor: grabbing; }

  .bonita-trigger:hover {
    transform: rotate(var(--bonita-rotation, 0deg)) translateY(-3px) scale(1.04);
    box-shadow: 0px 0px 30px rgba(23, 19, 31, 0.40);
  }

  .bonita-trigger:hover .bonita-trigger-icon {
    filter: saturate(1.08);
  }

  .bonita-trigger.open { border-radius: 50%; }


  /* Disables the position transition for the duration of an active drag so
   * live movement tracks the pointer exactly; state-driven (via isDragging)
   * rather than a direct style write, matching Toggle/IconToggle's pattern
   * of visual state flowing from props/state into a class name. */
  .bonita-trigger.dragging { transition: none; }

  /* ── Edge-tucked state ──
   * Most of the button is shifted off-screen (via "left") leaving only a
   * TUCK_PEEK_LEFT/TUCK_PEEK_RIGHT-px sliver visible. Dimmed until hovered/touched so it reads as
   * "tucked away" rather than "broken/cut off". Rounded only on the visible
   * edge so the sliver doesn't look like a stray corner.
   */
  .bonita-trigger.tucked-left,
  .bonita-trigger.tucked-right {
    opacity: 0.5;
    cursor: pointer;
    box-shadow: 0 0px 40px rgba(19, 9, 44, 0.9);
  }

  .bonita-trigger.tucked-left:hover,
  .bonita-trigger.tucked-right:hover {
    opacity: 0.92;
  }

  .bonita-trigger.tucked-left { border-radius: 0 16px 16px 0; }
  .bonita-trigger.tucked-right { border-radius: 16px 0 0 16px; }

  .bonita-dock {
    position: absolute;
    left: -5px;
    bottom: calc(100% + 10px);
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

  /* ── Loading sign (shown while async passes run) ── */
  .bonita-loading {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 4px 0 2px;
    color: var(--bonita-purple-dark);
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .bonita-loading-spinner {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    border: 2px solid rgba(111, 79, 216, 0.25);
    border-top-color: var(--bonita-purple);
    animation: bonita-spin 0.7s linear infinite;
  }

  @keyframes bonita-spin {
    to { transform: rotate(360deg); }
  }

  @media (prefers-reduced-motion: reduce) {
    .bonita-loading-spinner { animation-duration: 1.8s; }
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
   * Screen coordinates of the trigger button's top-left corner, plus which
   * edge (if any) it's currently tucked against.
   *
   * Starts at the default bottom-right corner, untucked; the real saved
   * value (if any) is applied once the initial `chrome.storage.local` read
   * resolves, via `applySavedPos` below. We can't read `chrome.storage`
   * synchronously the way `sessionStorage` could be read in the old
   * lazy-initializer, so `posReady` gates the trigger's render to avoid a
   * flash at the default corner before it jumps to the synced position.
   */
  const [pos, setPos] = useState<TriggerPos>({
    left: window.innerWidth - TRIGGER_SIZE - DEFAULT_MARGIN,
    top: window.innerHeight - TRIGGER_SIZE - DEFAULT_MARGIN,
    tuckedSide: null,
  })

  const zoomScale = useZoomCorrection()
  const vv = useVisualViewportCorrection() 

  /**
   * True once the initial `chrome.storage.local` read has resolved, so the
   * trigger doesn't flash at the default corner before jumping to its saved
   * (and possibly cross-tab-synced) position.
   */
  const [posReady, setPosReady] = useState(false)

  /**
   * Whether the trigger is actively being dragged right now.
   *
   * Drives the `.dragging` CSS class (which disables the position
   * transition) so live drag movement isn't smoothed/lagged, while the
   * transition still applies normally to the edge-snap-on-release and the
   * tap-to-untuck slide, since `isDragging` is `false` for those. State-
   * driven rather than a direct `ref.style` write, so visual state flows
   * from React the same way it does for {@link Toggle}/{@link IconToggle}.
   */
  const [isDragging, setIsDragging] = useState(false)

  /**
   * Mirrors `isDragging` for use inside the `chrome.storage.onChanged`
   * listener below. That listener's closure is set up once on mount, so it
   * would otherwise see a stale `isDragging` value; the ref always reads
   * current.
   */
  const isDraggingRef = useRef(false)
  useEffect(() => {
    isDraggingRef.current = isDragging
  }, [isDragging])

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

  const triggerIcon = chrome.runtime.getURL(
    settings.darkMode ? darkButtonIcon : lightButtonIcon
  )
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
    font: true,
  }

  const triggerRef = useRef<HTMLButtonElement>(null)
  const dockRef = useRef<HTMLDivElement>(null)

  /**
   * Applies a saved `{ left, top, tuckedSide }` to the live `pos` state.
   *
   * Recomputes `left` for tucked positions against the *current* viewport
   * (rather than reusing the stored value verbatim), since the window may
   * have been resized — or this may be a different tab/screen entirely —
   * since the value was saved. Shared by both the initial load and the
   * cross-tab sync listener below.
   */
  const applySavedPos = (saved: StoredTriggerPos): void => {
    if (typeof saved.leftFrac !== 'number' || typeof saved.topFrac !== 'number') return

    const top = saved.topFrac * window.innerHeight
    if (saved.tuckedSide === 'left') {
      setPos({ left: -(TRIGGER_SIZE - TUCK_PEEK_LEFT), top, tuckedSide: 'left' })
    } else if (saved.tuckedSide === 'right') {
      setPos({ left: window.innerWidth - TUCK_PEEK_RIGHT, top, tuckedSide: 'right' })
    } else {
      setPos({ left: saved.leftFrac * window.innerWidth, top, tuckedSide: null })
    }
  }

  /**
   * Initial load: reads the trigger's saved position/tuck state from
   * `chrome.storage.local` once on mount. Sets `posReady` regardless of
   * whether a saved value existed, so the trigger always renders after this
   * resolves (falling back to the default corner if nothing was saved yet).
   */
  useEffect(() => {
    chrome.storage.local.get(POS_KEY, (result) => {
      const saved = result[POS_KEY] as StoredTriggerPos | undefined
      if (saved) applySavedPos(saved)
      setPosReady(true)
    })
  }, [])

  /**
   * Live cross-tab sync: when another tab drags or tucks its trigger, this
   * tab's button jumps to match immediately, via `chrome.storage.onChanged`.
   *
   * Ignored while `isDragging` (checked through `isDraggingRef`) so an
   * incoming update from another tab can't fight the user's own in-progress
   * gesture in this tab.
   */
  useEffect(() => {
    const onStorageChange = (
      changes: { [key: string]: chrome.storage.StorageChange },
      area: string,
    ) => {
      if (area !== 'local' || !changes[POS_KEY] || isDraggingRef.current) return
      const saved = changes[POS_KEY].newValue as StoredTriggerPos | undefined
      if (saved) applySavedPos(saved)
    }
    chrome.storage.onChanged.addListener(onStorageChange)
    return () => chrome.storage.onChanged.removeListener(onStorageChange)
  }, [])

  function useVisualViewportCorrection() {
    const [vv, setVv] = useState({ x: 0, y: 0, scale: 1 })

    useEffect(() => {
      const viewport = window.visualViewport
      if (!viewport) return

      const update = () => {
        setVv({ x: viewport.offsetLeft, y: viewport.offsetTop, scale: viewport.scale })
      }
      update()
      viewport.addEventListener('resize', update)
      viewport.addEventListener('scroll', update)
      return () => {
        viewport.removeEventListener('resize', update)
        viewport.removeEventListener('scroll', update)
      }
    }, [])

    return vv
  }

  /**
   * Tracks browser page-zoom (Ctrl +/-, Ctrl+scroll) and keeps both the
   * trigger's visual scale AND its CSS-pixel position correct as DPR changes —
   * in a single matchMedia listener, so they always update together in the
   * same render. (Previously these were two separate hooks/listeners; even
   * though both react to the same DPR change, nothing guaranteed they'd land
   * in the same React commit, so the dock — whose position and scale both
   * derive from these two values — could visibly separate from the trigger
   * for a frame on each discrete zoom step.)
   *
   * Returns the scale factor to counter apparent size change (1 at baseline,
   * <1 when zoomed in, >1 when zoomed out). Also rescales pos.left/pos.top by
   * the DPR ratio so the trigger stays in the same physical screen location.
   */
  function useZoomCorrection(): number {
    const baselineDPR = useRef<number | null>(null)
    const [scale, setScale] = useState(1)

    useEffect(() => {
      let prevDPR = window.devicePixelRatio
      let mql: MediaQueryList

      const applyScale = () => {
        if (baselineDPR.current == null) return
        setScale(baselineDPR.current / window.devicePixelRatio)
      }

      // Resolve the SHARED baseline once, from storage, instead of just
      // reading window.devicePixelRatio at mount. The first tab ever to run
      // this seeds it for every tab thereafter.
      chrome.storage.local.get(DPR_BASELINE_KEY, (result) => {
        let baseline = result[DPR_BASELINE_KEY] as number | undefined
        if (baseline == null) {
          baseline = window.devicePixelRatio
          chrome.storage.local.set({ [DPR_BASELINE_KEY]: baseline })
        }
        baselineDPR.current = baseline
        applyScale()
      })
    

      const onZoomChange = () => {
        const newDPR = window.devicePixelRatio
        const ratio = prevDPR / newDPR

        applyScale()

        if (ratio !== 1) {
          setPos(prev =>
            prev.tuckedSide
              ? prev
              : { ...prev, left: prev.left * ratio, top: prev.top * ratio },
          )
        }

        prevDPR = newDPR
        mql = matchMedia(`(resolution: ${newDPR}dppx)`)
        mql.addEventListener('change', onZoomChange, { once: true })
      }

      mql = matchMedia(`(resolution: ${prevDPR}dppx)`)
      mql.addEventListener('change', onZoomChange, { once: true })
      return () => mql?.removeEventListener('change', onZoomChange)
    }, [])

    return scale
  }

  /**
   * Re-clamps the trigger position within the viewport on resize AND on
   * pinch/ctrl zoom.
   *
   * `window`'s `resize` event covers layout-viewport changes (window resize,
   * split-screen, fullscreen). It does NOT reliably fire for pinch-zoom or
   * ctrl+scroll zoom in Chrome, since those change the *visual* viewport's
   * scale without necessarily changing layout viewport dimensions. Those are
   * instead reported via `window.visualViewport`'s own `resize` event. We
   * listen on both and prefer `visualViewport` dimensions when available,
   * since at extreme zoom levels they reflect what's actually visible more
   * accurately than `window.innerWidth`/`innerHeight`.
   *
   * Without this, zooming out, dragging the trigger near an edge, then
   * zooming back in can leave it clamped against coordinates that are now
   * off-screen — effectively invisible until dragged again.
   */
  useEffect(() => {
    const getViewport = () => ({
      width: window.innerWidth,
      height: window.innerHeight,
    })

    const onResize = () => {
      const { width, height } = getViewport()
      setPos(prev => {
        const top = Math.max(0, Math.min(height - TRIGGER_SIZE, prev.top))
        if (prev.tuckedSide === 'left') {
          return { ...prev, left: -(TRIGGER_SIZE - TUCK_PEEK_LEFT), top }
        }
        if (prev.tuckedSide === 'right') {
          return { ...prev, left: width - TUCK_PEEK_RIGHT, top }
        }
        return {
          ...prev,
          left: Math.max(0, Math.min(width - TRIGGER_SIZE, prev.left)),
          top,
        }
      })
    }

    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
    }
  }, [])

  /**
   * Opens a named popup, replacing whichever popup was previously open.
   *
   * Called from a tool's `onMouseEnter` (while that tool is active), not
   * from its on/off click — popup visibility is driven by hover, not by the
   * enable/disable toggle.
   *
   * @param name - The popup identifier to show.
   */
  const showPopup = (name: 'bold' | 'pos' | 'font' | 'lineFocus' | 'wordComplexity'): void =>
    setOpenPopup(name)

  /**
   * Closes a named popup, but only if it is the one currently open.
   *
   * Called from a tool's `onMouseLeave` (after a short grace period handled
   * by the tool component itself). Guarding on `name` prevents a stale
   * hide-timer from one tool closing a different tool's popup that opened
   * in the meantime.
   *
   * @param name - The popup identifier to hide.
   */
  const hidePopup = (name: 'bold' | 'pos' | 'font' | 'lineFocus' | 'wordComplexity'): void =>
    setOpenPopup(prev => (prev === name ? null : prev))

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
   * open, avoiding a permanent global listener when the dock is closed. Also
   * resets the trigger's rotation back to 0° so it returns to its resting
   * orientation whenever the dock closes this way.
   */
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      const path = e.composedPath()
      if (
        (triggerRef.current && path.includes(triggerRef.current)) ||
        (dockRef.current && path.includes(dockRef.current))
      )
        return
      setOpen(false)
      setRotation(0)
    }
    document.addEventListener('mousedown', handler, true)
    return () => document.removeEventListener('mousedown', handler, true)
  }, [open])

  /**
   * Mutable ref tracking drag state for the trigger button.
   *
   * A ref (not state) is used deliberately: updating it during a drag does not
   * trigger re-renders, keeping drag performance smooth. `lastLeft`/`lastTop`
   * track the most recently applied (clamped) position during the drag.
   * `wasTuckedSide` is an explicit snapshot of `pos.tuckedSide` taken at
   * `mousedown` — `onUp` reads from this rather than closing over `pos`
   * directly, so a click-to-untuck decision can't silently go stale if
   * something else (e.g. a `resize`, or an incoming cross-tab sync) updates
   * `pos` mid-gesture.
   */
  const dragStateRef = useRef({
    originLeft: 0,
    originTop: 0,
    startX: 0,
    startY: 0,
    /** `true` once the pointer has moved beyond {@link DRAG_THRESHOLD} pixels. */
    moved: false,
    lastLeft: 0,
    lastTop: 0,
    wasTuckedSide: null as 'left' | 'right' | null,
  })

  /**
   * Current rotation angle (in degrees) applied to the trigger button.
   *
   * This is a plain (non-wrapped) numeric value, not just 0/90/180/etc as
   * fixed states — CSS animates the raw difference between old and new
   * values, so decreasing it later naturally spins the button backward
   * through the same path it took to get there ("retracing").
   *
   * - `0`   — dock closed (rest position).
   * - `90`  — dock open, tools off.
   * - `450` — dock open, tools on (90 + one extra full turn, so opening
   *   with tools already on, or toggling tools on while open, both spin
   *   forward an extra 360° past the 90° "tools off" position rather than
   *   jumping backward to 270°).
   *
   * Toggling tools off while the dock is open retraces from 450 back to 90.
   * Closing the dock (from either 90 or 450) always retraces all the way
   * back to 0.
   */
  const [rotation, setRotation] = useState(0)

  /**
   * Keeps the trigger's rotation in sync when the site-enable toggle
   * changes *while the dock is already open*.
   *
   * Turning tools on while open spins forward from 90° to 450° (an extra
   * full turn). Turning tools back off while still open retraces that same
   * turn, back down to 90°. Values outside these two cases (0, or already
   * mid-transition) are left alone.
   */
  useEffect(() => {
    if (!open) return
    if (siteEnabled && rotation === 90) {
      setRotation(450)
    } else if (!siteEnabled && rotation === 450) {
      setRotation(90)
    }
  }, [siteEnabled, open])

  /**
   * Handles `mousedown` on the trigger button.
   *
   * Distinguishes between a **click** and a **drag** by tracking pointer
   * travel distance:
   * - Travel > {@link DRAG_THRESHOLD} px before `mouseup` → drag; updates
   *   `pos` live, clamped to keep the trigger fully within the viewport, and
   *   un-tucks it immediately so it follows the cursor normally. On release,
   *   dropping within {@link EDGE_SNAP_THRESHOLD}px of the left or right edge
   *   snaps and tucks the trigger against that edge (and closes the dock if
   *   it was open, resetting rotation to 0°); otherwise it settles wherever
   *   it was dropped.
   * - `mouseup` without exceeding the threshold → click. If the trigger is
   *   currently tucked, this slides it back to a fully visible position
   *   (rather than opening the dock) and it stays there until dragged near
   *   an edge again. Otherwise it toggles `open` as before, and sets
   *   `rotation` to 90° (tools off) or 450° (tools already on) when opening,
   *   or back to 0° when closing.
   *
   * `isDragging` is `true` for the duration of an active drag, which adds
   * the `.dragging` class (disabling the position transition) so live
   * dragging tracks the pointer exactly instead of lagging behind a smoothed
   * transition — the transition still applies normally to the edge-snap on
   * release and the tap-to-untuck slide, since `isDragging` is `false` by
   * then.
   *
   * The settled position/tuck state is written to `chrome.storage.local`
   * only here, on release — not on every drag frame — so other tabs aren't
   * spammed with updates mid-drag and only see the final result.
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
      lastLeft: pos.left,
      lastTop: pos.top,
      wasTuckedSide: pos.tuckedSide,
    }

    setIsDragging(true)

    const onMove = (ev: MouseEvent): void => {
      const s = dragStateRef.current
      const dx = ev.clientX - s.startX
      const dy = ev.clientY - s.startY
      if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
        s.moved = true
      }
      if (s.moved) {
        const left = Math.max(
          0,
          Math.min(window.innerWidth - TRIGGER_SIZE, s.originLeft + dx),
        )
        const top = Math.max(
          0,
          Math.min(window.innerHeight - TRIGGER_SIZE, s.originTop + dy),
        )
        s.lastLeft = left
        s.lastTop = top
        // Un-tuck immediately once a real drag starts, so the trigger is
        // fully visible and follows the cursor rather than staying clipped.
        setPos({ left, top, tuckedSide: null })
      }
    }

    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)

      setIsDragging(false)

      const s = dragStateRef.current

      if (!s.moved) {
        // Plain click, no drag. Read the tucked state from the snapshot
        // taken at mousedown rather than the (potentially stale) `pos`
        // closure.
        if (s.wasTuckedSide) {
          const untuckedLeft =
            s.wasTuckedSide === 'left'
              ? DEFAULT_MARGIN
              : window.innerWidth - TRIGGER_SIZE - DEFAULT_MARGIN
          const next: TriggerPos = { left: untuckedLeft, top: s.lastTop, tuckedSide: null }
          setPos(next)
          chrome.storage.local.set({ [POS_KEY]: toStoredPos(next) })
          } else {
          // Toggling the dock open/closed also drives the trigger's
          // rotation: opening sets it to 90° (tools off) or 450° (tools
          // already on, one extra full turn past 90°); closing always
          // retraces back to 0°.
          setOpen(o => {
            const next = !o
            setRotation(next ? (siteEnabled ? 450 : 90) : 0)
            return next
          })
        }
        return
      }

      // Drag ended — snap/tuck if dropped near an edge, otherwise settle in place.
      let next: TriggerPos
      if (s.lastLeft < EDGE_SNAP_THRESHOLD) {
        next = { left: -(TRIGGER_SIZE - TUCK_PEEK_LEFT), top: s.lastTop, tuckedSide: 'left' }
        setOpen(false) // close the dock whenever the trigger tucks
        setRotation(0)
      } else if (s.lastLeft > window.innerWidth - TRIGGER_SIZE - EDGE_SNAP_THRESHOLD) {
        next = { left: window.innerWidth - TUCK_PEEK_RIGHT, top: s.lastTop, tuckedSide: 'right' }
        setOpen(false) // close the dock whenever the trigger tucks
        setRotation(0)
      } else {
        next = { left: s.lastLeft, top: s.lastTop, tuckedSide: null }
      }
      setPos(next)
      chrome.storage.local.set({ [POS_KEY]: toStoredPos(next) })
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  // Don't render the trigger until the initial chrome.storage.local read has
  // resolved — otherwise it would flash at the default corner for a frame
  // before jumping to its saved/synced position.
  if (!posReady) return <style>{styles}</style>

  return (
    <>
      <style>{styles}</style>

      <div
        className="bonita-vv-anchor"
        style={{ transform: `translate(${vv.x}px, ${vv.y}px) scale(${1 / vv.scale})` }}
      >
        <div
          className="bonita-pos-anchor"
          style={{ left: pos.left, top: pos.top, '--bonita-zoom': zoomScale } as React.CSSProperties}
        >
          <button
            ref={triggerRef}
            className={`bonita-trigger ${open ? 'open' : ''} ${isDragging ? 'dragging' : ''} ${
              pos.tuckedSide === 'left' ? 'tucked-left' : pos.tuckedSide === 'right' ? 'tucked-right' : ''
            }`}
            style={{ '--bonita-rotation': `${rotation}deg` } as React.CSSProperties}
            onMouseDown={onMouseDown}
            title={pos.tuckedSide ? 'Tap to bring back' : 'drag to move'}
            data-bonita-root="true"
          >
            <img
              className="bonita-trigger-icon"
              src={triggerIcon}
              alt="Bonita"
              draggable={false}
            />
          </button>

          <div
            ref={dockRef}
            className={`bonita-dock ${open ? 'open' : ''}`}
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
          <ReadingToolsController />  
          <div className="bonita-divider" />
          {toolVisible.sentenceSplitting && (
            <div onClick={() => setOpenPopup(null)}>
              <SentenceSplitting />
            </div>
          )}
          {toolVisible.keywordBolding && (
            <PhraseBolding
              open={openPopup === 'bold'}
              onShow={() => showPopup('bold')}
              onHide={() => hidePopup('bold')}
            />
          )}
          {toolVisible.pos && (
            <POSHighlight
              open={openPopup === 'pos'}
              onShow={() => showPopup('pos')}
              onHide={() => hidePopup('pos')}
            />
          )}
          {toolVisible.wordSimplification && (
            <WordSimplify
              open={openPopup === 'wordComplexity'}
              onShow={() => showPopup('wordComplexity')}
              onHide={() => hidePopup('wordComplexity')}
            />
          )}
          {toolVisible.lineFocus && (
            <LineFocusToggle
              open={openPopup === 'lineFocus'}
              onShow={() => showPopup('lineFocus')}
              onHide={() => hidePopup('lineFocus')}
            />
          )}
          {toolVisible.tts && (
            <div onClick={() => setOpenPopup(null)}>
              <TTSReader />
            </div>
          )}
          {toolVisible.font && (
            <FontSelector
              open={openPopup === 'font'}
              onShow={() => showPopup('font')}
              onHide={() => hidePopup('font')}
            />
          )}
          </>
          )}
        </div>
      </div>
    </div>
  </>
)}

export default App