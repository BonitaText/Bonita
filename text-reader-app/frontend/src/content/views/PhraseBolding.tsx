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
   * Callback to toggle the popup open/closed.
   * Called on every button click — parent handles the open/close logic
   * via `setOpenPopup(prev => prev === name ? null : name)`.
   */
  onOpen: () => void
}

/**
 * PhraseBolding
 *
 * Dock button that toggles keyword bolding on the host page.
 *
 * Behaviour:
 * - Clicking the button toggles `settings.keywordBolding` on/off and
 *   simultaneously opens/closes the configuration popup via `onOpen`.
 * - The button renders with the `active` class while bolding is enabled.
 * - The popup exposes:
 *   - A range slider for `settings.boldThresholdPercent` (how many keywords to bold).
 *     The slider's max is clamped to `min(10 + paragraphCount * 2, 200)` so
 *     the count stays proportional to page length.
 *   - A colour picker for `settings.boldColor`, which is also mirrored onto
 *     the CSS custom property `--bonita-bold-color` so `phraseBolder.ts` can
 *     read it without importing React state.
 */
export default function PhraseBolding({ open, onOpen }: PhraseBoldingProps) {
  const { settings, updateSetting } = useSettings()
  
  /** Whether keyword bolding is currently active. */
  const enabled = settings.keywordBolding
  
  /** Current target keyword count, defaulting to 7. */
  const count = settings.boldThresholdPercent ?? 7
  
  /** Current bold colour as a hex string, defaulting to deep purple. */
  const boldColor = settings.boldColor ?? '#3e236b'
  


  // Inject the CSS variable onto :root so phraseBolder.ts picks it up
  document.documentElement.style.setProperty('--bonita-bold-color', boldColor)
  
  return (
    <div className="bonita-font-wrapper">
      <button
        className={`bonita-icon-btn ${enabled ? 'active' : ''}`}
        onClick={() => {
          const next = !enabled
          updateSetting('keywordBolding', !enabled)
          if (next !== open) onOpen()
        }}
        data-tooltip="Phrase Bolding"
        aria-label="Phrase Bolding"
      >
        <Bold size={20} strokeWidth={1.8} />
      </button>

      {open && (
        <div className="bonita-font-popup" style={{ minWidth: 176 }}>
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
              value={50}
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