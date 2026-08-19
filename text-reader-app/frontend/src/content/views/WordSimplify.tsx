import { useRef } from 'react'
import { BookOpen } from 'lucide-react'
import { useSettings } from '../hooks/useSettings'

/**
 * Props for the WordSimplify component.
 *
 * Controls word-simplification on the page. Clicking the dock button toggles
 * the feature fully on/off — no separate "turn off" control exists anywhere
 * in the popup. Hovering the button, while enabled, reveals a popup with a
 * 3-point slider for choosing intensity (low / medium / high) — mirroring
 * the threshold slider used by Phrase Bolding, rather than a list of
 * discrete rows.
 */
interface WordSimplifyProps {
  /** Whether the configuration popup is currently open. Controlled by the parent. */
  open: boolean

  /**
   * Called on hover-in, only while word simplification is enabled, to
   * request the popup open. Independent of the enable/disable click.
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
 * The three selectable simplification intensities, in slider order
 * (0 = low, 1 = medium, 2 = high). Defined outside the component to avoid
 * recreation on every render.
 */
const LEVELS: { key: 'low' | 'medium' | 'high'; label: string; desc: string }[] = [
  { key: 'low',    label: 'Low',    desc: 'More words' },
  { key: 'medium', label: 'Medium', desc: 'Balanced'   },
  { key: 'high',   label: 'High',   desc: 'Fewer words' },
]

/**
 * WordSimplify
 *
 * Dock button that toggles word simplification on the host page and lets
 * the user pick how aggressive it should be.
 *
 * Behaviour:
 * - Clicking the button toggles `settings.wordSimplification` on/off
 *   directly, and also calls `onShow`/`onHide` for that same click — since
 *   the mouse is already over the button at the moment of the click,
 *   `onMouseEnter` won't fire again on its own, so without this the popup
 *   wouldn't appear until the user moved away and hovered back in.
 * - Hovering the button, while enabled, opens the popup via `onShow`;
 *   moving away from both the button and popup closes it via `onHide`.
 * - The popup contains a single 3-point slider (snapping to low/medium/
 *   high) for `settings.wordComplexity`, matching the visual language of
 *   Phrase Bolding's threshold slider rather than a list of rows.
 */
export default function WordSimplify({ open, onShow, onHide }: WordSimplifyProps) {
  const { settings, updateSetting } = useSettings()

  /** Whether word simplification is currently active. */
  const enabled = settings.wordSimplification

  /** Current complexity level, defaulting to medium. */
  const level = settings.wordComplexity ?? 'medium'

  /** Slider position (0/1/2) derived from the current level. */
  const levelIndex = LEVELS.findIndex(l => l.key === level)
  const sliderValue = levelIndex === -1 ? 1 : levelIndex

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
          const next = !enabled
          updateSetting('wordSimplification', next)
          cancelHide()
          // The mouse is already over the button on click, so onMouseEnter
          // won't fire again on its own — show/hide the popup directly here
          // too, in addition to the hover-based open/close for revisits.
          if (next) onShow()
          else onHide()
        }}
        data-tooltip="Word Simplification"
        aria-label="Word Simplification"
      >
        <BookOpen size={20} strokeWidth={1.8} />
      </button>

      {open && enabled && (
        <div
          className="bonita-font-popup"
          style={{ minWidth: 176 }}
          onMouseEnter={cancelHide}
          onMouseLeave={scheduleHide}
        >
          {/* ── Level header ── */}
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
            <span>Simplify</span>
            {/* Live level readout next to the label */}
            <span style={{ color: 'var(--bonita-purple-dark)', fontSize: 13 }}>
              {LEVELS[sliderValue].label}
            </span>
          </div>

          {/* ── 3-point snapping slider ── */}
          <div style={{ padding: '2px 10px 8px' }}>
            <input
              type="range"
              min={0}
              max={2}
              step={1}
              value={sliderValue}
              onChange={e => updateSetting('wordComplexity', LEVELS[Number(e.target.value)].key)}
              style={{
                width: '100%',
                accentColor: 'var(--bonita-purple)',
                cursor: 'pointer',
              }}
            />
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: 10,
              fontWeight: 600,
              color: 'var(--bonita-grey)',
              marginTop: 2,
              opacity: 0.7,
            }}>
              <span>Low</span>
              <span>High</span>
            </div>
            {/* Short description of the currently selected level */}
            <div style={{
              fontSize: 10,
              color: 'var(--bonita-grey)',
              opacity: 0.6,
              marginTop: 4,
            }}>
              {LEVELS[sliderValue].desc}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}