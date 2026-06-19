/**
 * @file hooks/useLineFocusApplier.ts
 *
 * React hook that mounts a line-focus overlay onto the host page and keeps it
 * in sync with {@link BonitaSettings.lineFocus} and
 * {@link BonitaSettings.lineFocusHeight}.
 *
 * ## How the overlay works
 * Three `position: fixed` layers are injected into `document.body` inside a
 * single wrapper `<div>` (identified by {@link ROOT_ID}):
 *
 * ```
 * ┌─────────────────────────────┐  ← top dim layer    (0 → bandTop)
 * │  rgba overlay + blur        │
 * ├─────────────────────────────┤
 * │  focus band (transparent)   │  ← band             (bandTop → bandTop + height)
 * ├─────────────────────────────┤
 * │  rgba overlay + blur        │  ← bottom dim layer (bandTop + height → 100vh)
 * └─────────────────────────────┘
 * ```
 *
 * On every `mousemove` event, `update()` repositions all three layers so the
 * bright band tracks the cursor's Y position, centred on it.
 *
 * ## Lifecycle
 * - **Mount / `lineFocus` → true**: wrapper + style tag + three layers are
 *   created and appended to `<body>`.  The initial position is set to vertical
 *   centre so the overlay looks correct before the first mouse movement.
 * - **`lineFocusHeight` changes**: the effect tears down and rebuilds the
 *   entire overlay so the inline CSS in the `<style>` tag reflects the new
 *   height.  The rebuild is cheap (no network, no reflow of page content) and
 *   keeps the code simple.
 * - **`lineFocus` → false / unmount**: the wrapper is removed from the DOM and
 *   the `mousemove` listener is detached.
 *
 * ## Dependencies
 * - {@link useSettings} — reads `lineFocus` and `lineFocusHeight` from the
 *   shared settings store.
 * - `LINE_FOCUS_DEFAULT_PX` — fallback height when `lineFocusHeight` is absent
 *   from storage (e.g. fresh install).
 */

import { useEffect } from 'react'
import { useSettings } from './useSettings'
import { LINE_FOCUS_DEFAULT_PX } from '../views/LineFocusToggle'

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * `id` attribute of the wrapper element injected into `<body>`.
 *
 * Used as the removal target so re-runs of the effect never leave orphaned
 * overlay elements behind.
 */
export const ROOT_ID = 'bonita-line-focus-root'

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Creates a `<div>` with the given CSS class name.
 *
 * Extracted as a helper so the main effect body stays readable.
 *
 * @param className - The CSS class to assign to the new element.
 * @returns A freshly created `HTMLDivElement`.
 */
const createLayer = (className: string): HTMLDivElement => {
  const layer = document.createElement('div')
  layer.className = className
  return layer
}

/**
 * Builds the inner HTML string for the overlay's `<style>` block.
 *
 * The focus-band height is baked into the CSS at creation time so we avoid
 * reading a CSS custom property at runtime.  The effect rebuilds the overlay
 * whenever `height` changes, so the emitted value is always current.
 *
 * @param rootId  - The wrapper element's `id`; used to scope all selectors.
 * @param height  - Height of the focus band in pixels.
 * @returns A `<style>` HTML string ready to assign to `innerHTML`.
 */
export const buildStyleHTML = (rootId: string, height: number): string => `
  <style>
    #${rootId} .bonita-focus-layer {
      position: fixed;
      left: 0;
      right: 0;
      z-index: 2147483644;
      pointer-events: none;
      background: rgba(18, 14, 24, 0.20);
      backdrop-filter: blur(0.6px);
      transition: height 120ms ease, top 120ms ease;
    }

    #${rootId} .bonita-focus-band {
      position: fixed;
      left: 10px;
      right: 10px;
      height: ${height}px;
      z-index: 2147483645;
      pointer-events: none;
      border: 1px solid rgba(126, 91, 239, 0.42);
      border-radius: 12px;
      background: rgba(249, 244, 232, 0.18);
      box-shadow: 0 12px 30px rgba(39, 26, 58, 0.10);
      transition: top 120ms ease;
    }
  </style>
`

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Mounts and manages the line-focus overlay on the host page.
 *
 * Call this hook once, near the top of the component tree (e.g. in `App`).
 * It has no return value; all side effects are managed internally via
 * `useEffect`.
 *
 * ### Effect triggers
 * The effect re-runs (and rebuilds the overlay) when either:
 * - `settings.lineFocus` changes — toggles the overlay on/off.
 * - `settings.lineFocusHeight` changes — rebuilds with the new band height.
 *
 * ### Cleanup
 * The effect's cleanup function removes the overlay wrapper from `<body>` and
 * detaches the `mousemove` listener, so React's strict-mode double-invoke and
 * hot-reload both leave the DOM clean.
 *
 * @example
 * ```tsx
 * // In App.tsx
 * export default function App() {
 *   useLineFocusApplier()
 *   return <Dock />
 * }
 * ```
 */
export function useLineFocusApplier(): void {
  const { settings } = useSettings()

  /**
   * Resolved band height.
   *
   * Falls back to {@link LINE_FOCUS_DEFAULT_PX} when `lineFocusHeight` has
   * never been saved to storage (e.g. immediately after installation).
   */
  const height = settings.lineFocusHeight ?? LINE_FOCUS_DEFAULT_PX

  useEffect(() => {
    // Always remove any existing overlay first so we never stack duplicates.
    document.getElementById(ROOT_ID)?.remove()

    if (!settings.lineFocus) return

    // ── Build wrapper ──────────────────────────────────────────────────────
    const root = document.createElement('div')
    root.id = ROOT_ID
    root.setAttribute('data-bonita-root', 'true')
    root.innerHTML = buildStyleHTML(ROOT_ID, height)

    // ── Create the three overlay layers ───────────────────────────────────
    const top = createLayer('bonita-focus-layer')
    const bottom = createLayer('bonita-focus-layer')
    const band = createLayer('bonita-focus-band')
    root.append(top, bottom, band)
    document.body.appendChild(root)

    // ── Position updater ──────────────────────────────────────────────────

    /**
     * Repositions the three overlay layers so the focus band is centred on
     * the given Y coordinate.
     *
     * Called on every `mousemove` event and once on mount (at vertical centre)
     * so the overlay looks correct before the user moves the mouse.
     *
     * @param y - The target Y coordinate in viewport pixels (e.g. `clientY`).
     */
    const update = (y: number): void => {
      const bandTop = Math.max(0, y - height / 2)
      top.style.top = '0'
      top.style.height = `${bandTop}px`
      band.style.top = `${bandTop}px`
      bottom.style.top = `${bandTop + height}px`
      bottom.style.height = `${Math.max(0, window.innerHeight - bandTop - height)}px`
    }

    const onMouseMove = (event: MouseEvent): void => update(event.clientY)

    // Seed the initial position at the vertical centre of the viewport.
    update(window.innerHeight / 2)
    window.addEventListener('mousemove', onMouseMove)

    // ── Cleanup ───────────────────────────────────────────────────────────
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      root.remove()
    }
  }, [settings.lineFocus, height])
}