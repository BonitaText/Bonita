/**
 * @file views/LineFocusToggle.tsx
 *
 * Dock button that toggles line-focus mode on the host page and exposes a
 * slider for configuring the height of the focus band.
 *
 * ## Popup behaviour
 * Follows the same pattern as {@link PhraseBolding}:
 * - The parent (`App`) owns which popup is open via `openPopup` / `togglePopup`.
 * - Clicking the button both toggles `settings.lineFocus` **and** calls
 *   `onOpen`, which the parent resolves to open/close this popup while
 *   closing any other open popup.
 * - The popup is rendered inside `.bonita-font-wrapper` so it shares the same
 *   `.bonita-font-popup` positioning styles already defined in `App.tsx`.
 *
 * ## Focus-band height
 * The slider controls `settings.lineFocusHeight` (a pixel value).
 * - **Min** (`LINE_FOCUS_MIN_PX`): 24 px — tall enough to be useful but never
 *   collapses to zero.
 * - **Max** (`LINE_FOCUS_MAX_PX`): 200 px — roughly one paragraph of body
 *   text at typical font sizes, so the user can widen the band to capture a
 *   full block of text.
 * The value is written to the CSS custom property `--bonita-line-focus-height`
 * on `:root` so `useLineFocusApplier` can read it without importing React state.
 */

import { ScanLine } from 'lucide-react'
import { useSettings } from '../hooks/useSettings'
import { useLineFocusApplier } from '../hooks/useLineFocusApplier'

// ─── Constants ────────────────────────────────────────────────────────────────

/** Minimum focus-band height in pixels. Prevents the band from collapsing to zero. */
export const LINE_FOCUS_MIN_PX = 24

/**
 * Maximum focus-band height in pixels.
 *
 * 200 px is roughly one paragraph of body text at a typical 16–18 px line
 * height with 1.5 line-spacing, giving the user room to widen the band to
 * capture a full block.
 */
export const LINE_FOCUS_MAX_PX = 200

/** Default focus-band height used when no value is stored in settings. */
export const LINE_FOCUS_DEFAULT_PX = 48

// ─── Props ────────────────────────────────────────────────────────────────────

/**
 * Props for the {@link LineFocusToggle} component.
 *
 * Mirrors the shape used by {@link PhraseBolding} so `App` can manage all
 * popups with a single `openPopup` state variable and a shared `togglePopup`
 * helper.
 */
export interface LineFocusToggleProps {
  /** Whether this component's popup is currently open. */
  open: boolean

  /**
   * Callback fired when the user clicks the toggle button.
   *
   * The parent resolves open/close by comparing the incoming name with
   * `openPopup`: same name closes, different name switches.
   */
  onOpen: () => void
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * LineFocusToggle
 *
 * Dock button that toggles line-focus mode on the host page.
 *
 * Behaviour:
 * - Clicking the button toggles `settings.lineFocus` on/off and simultaneously
 *   opens/closes the configuration popup via `onOpen`.
 * - The button renders with the `active` class while line focus is enabled.
 * - The popup exposes a range slider for `settings.lineFocusHeight` (px),
 *   clamped between {@link LINE_FOCUS_MIN_PX} and {@link LINE_FOCUS_MAX_PX}.
 *   The value is also mirrored onto `--bonita-line-focus-height` on `:root` so
 *   `useLineFocusApplier` can consume it as a CSS variable.
 *
 * @param props - {@link LineFocusToggleProps}
 */
export default function LineFocusToggle({ open, onOpen }: LineFocusToggleProps) {
  const { settings, updateSetting } = useSettings()
  useLineFocusApplier()

  /** Whether line-focus mode is currently active. */
  const enabled = settings.lineFocus

  /**
   * Current focus-band height in pixels.
   *
   * Falls back to {@link LINE_FOCUS_DEFAULT_PX} if the setting has never been
   * written (e.g. fresh install).
   */
  const height = settings.lineFocusHeight ?? LINE_FOCUS_DEFAULT_PX

  /**
   * Clamp the stored value into the allowed range.
   *
   * Guards against out-of-range values that could be stored by an older
   * version of the extension or edited directly in storage.
   */
  const clampedHeight = Math.min(Math.max(height, LINE_FOCUS_MIN_PX), LINE_FOCUS_MAX_PX)

  // Mirror the height onto :root so useLineFocusApplier can read it as a CSS var
  document.documentElement.style.setProperty(
    '--bonita-line-focus-height',
    `${clampedHeight}px`,
  )

  return (
    <div className="bonita-font-wrapper">
      <button
        className={`bonita-icon-btn ${enabled ? 'active' : ''}`}
        onClick={() => {
          const next = !enabled
          updateSetting('lineFocus', next)
          if (next !== open) onOpen()
        }}
        data-tooltip="Line Focus"
        aria-label="Line Focus"
      >
        <ScanLine size={20} strokeWidth={1.8} />
      </button>

      {open && (
        <div className="bonita-font-popup" style={{ minWidth: 176 }}>
          {/* ── Focus height header ── */}
          <div
            style={{
              padding: '6px 10px 4px',
              fontSize: 11,
              fontWeight: 700,
              color: 'var(--bonita-grey)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
            }}
          >
            <span>Focus Height</span>
            {/* Live pixel readout */}
            <span style={{ color: 'var(--bonita-purple-dark)', fontSize: 13 }}>
              {clampedHeight}px
            </span>
          </div>

          {/* ── Focus height slider ── */}
          <div style={{ padding: '2px 10px 8px' }}>
            <input
              type="range"
              min={LINE_FOCUS_MIN_PX}
              max={LINE_FOCUS_MAX_PX}
              step={4}
              value={clampedHeight}
              onChange={e => updateSetting('lineFocusHeight', Number(e.target.value))}
              style={{
                width: '100%',
                accentColor: 'var(--bonita-purple)',
                cursor: 'pointer',
              }}
            />

            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: 10,
                fontWeight: 600,
                color: 'var(--bonita-grey)',
                marginTop: 2,
                opacity: 0.7,
              }}
            >
              <span>Narrow</span>
              <span>Wide</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}