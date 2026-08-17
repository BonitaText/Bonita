import { useRef } from 'react'
import { Bold } from 'lucide-react'
import { useSettings } from '../hooks/useSettings'

/**
 * Props for the PhraseBolding component.
 *
 * Controls keyword/phrase bolding on the page. The component renders a toggle
 * button that activates bolding and opens an inline popup for configuring how
 * many keywords to bold, and what colour to use.
 */
interface PhraseBoldingProps {
  open: boolean

  /**
   * Called on hover-in (while the tool is enabled) to request the popup open.
   * Independent of the enable/disable click.
   */
  onShow: () => void

  /**
   * Called on hover-out (after a short grace period, so moving from the
   * button into the popup doesn't flicker-close it) to request the popup
   * close.
   */
  onHide: () => void
}

/**
 * PhraseBolding
 *
 * Dock button that toggles keyword bolding on the host page.
 *
 * Behaviour:
 * - Clicking the button toggles `settings.keywordBolding` on/off. This is
 *   independent of the popup — clicking does not open or close it.
 * - Hovering the button (while bolding is enabled) opens the configuration
 *   popup via `onShow`; moving the mouse away from both the button and the
 *   popup closes it via `onHide`, after a short delay so crossing from the
 *   button into the popup doesn't close it prematurely.
 * - The button renders with the `active` class while bolding is enabled.
 * - The popup exposes:
 *   - A range slider for `settings.boldThresholdPercent` (how many keywords to bold).
 *     The slider's max is clamped to `min(10 + paragraphCount * 2, 200)` so
 *     the count stays proportional to page length.
 *   - A colour picker for `settings.boldColor`, which is also mirrored onto
 *     the CSS custom property `--bonita-bold-color` so `phraseBolder.ts` can
 *     read it without importing React state.
 */
export default function PhraseBolding({ open, onShow, onHide }: PhraseBoldingProps) {
  const { settings, updateSetting } = useSettings()
  
  /** Whether keyword bolding is currently active. */
  const enabled = settings.keywordBolding
  
  /** Current target keyword count, defaulting to 7. */
  const count = settings.boldThresholdPercent ?? 7
  
  /** Current bold colour as a hex string, defaulting to deep purple. */
  const boldColor = settings.boldColor ?? '#3e236b'

  /** Pending hide timeout, so leaving the button and re-entering the popup can cancel it. */
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const cancelHide = (): void => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    }
  }

  const scheduleHide = (): void => {
    cancelHide()
    hideTimerRef.current = setTimeout(() => onHide(), 150)
  }

  // Inject the CSS variable onto :root so phraseBolder.ts picks it up
  document.documentElement.style.setProperty('--bonita-bold-color', boldColor)
  
  return (
    <div
      className="bonita-font-wrapper"
      onMouseEnter={() => {
        if (enabled) {
          cancelHide()
          onShow()
        }
      }}
      onMouseLeave={scheduleHide}
    >
      <button
        className={`bonita-icon-btn ${enabled ? 'active' : ''}`}
        onClick={() => {
          updateSetting('keywordBolding', !enabled)
        }}
        data-tooltip="Phrase Bolding"
        aria-label="Phrase Bolding"
      >
        <Bold size={20} strokeWidth={1.8} />
      </button>

      {open && (
        <div
          className="bonita-font-popup"
          style={{ minWidth: 176 }}
          onMouseEnter={cancelHide}
          onMouseLeave={scheduleHide}
        >
          {/* ── Keyword count header ── */}
          <div style={{
            padding: '6px 10px 4px',
            fontSize: 11,
            fontWeight: 700,
            color: 'var(--bonita-grey)',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
          }}>
            <span>Keywords</span>
            {/* Live count readout next to the label */}
            <span style={{ color: 'var(--bonita-purple-dark)', fontSize: 13 }}>
              {count}%
            </span>
          </div>

          {/* ── Keyword count slider ── */}
          <div style={{ padding: '2px 10px 8px' }}>
            <input
              type="range"
              min={1}
              max={100}
              step={1}
              value={count}
              onChange={e => updateSetting('boldThresholdPercent', Number(e.target.value))}
              style={{
                width: '100%',
                accentColor: 'var(--bonita-purple)',
                cursor: 'pointer',
              }}
            />

            {/* ── Bold colour picker ── */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: 10,
              fontWeight: 600,
              color: 'var(--bonita-grey)',
              marginTop: 2,
              opacity: 0.7,
            }}>
              <span>Fewer</span>
              <span>More</span>
            </div>
          </div>

          {/* Colour picker */}
          <div style={{
            padding: '4px 10px 8px',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}>
            <span style={{
              fontSize: 11,
              fontWeight: 700,
              color: 'var(--bonita-grey)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              flex: 1,
            }}>
              Colour
            </span>
            <input
              type="color"
              value={boldColor}
              onChange={e => updateSetting('boldColor', e.target.value)}
              style={{
                width: 28,
                height: 22,
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer',
                padding: 0,
                background: 'none',
              }}
            />
          </div>
        </div>
      )}
    </div>
  )
}