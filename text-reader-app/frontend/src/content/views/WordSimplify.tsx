import { useRef } from 'react'
import { BookOpen } from 'lucide-react'
import { useSettings } from '../hooks/useSettings'

/**
 * Props for the WordSimplify component.
 *
 * Controls word-simplification on the page. The dock button's click turns
 * the feature on/off; hovering the button (while enabled) reveals the popup
 * for choosing a complexity level (`low` / `medium` / `high`), independent
 * of the click.
 */
interface WordSimplifyProps {
  /**
   * Whether the configuration popup is currently open.
   * Controlled by the parent.
   */
  open: boolean

  /**
   * Called on hover-in, only while word simplification is enabled, to
   * request the popup open. Independent of the enable/disable click.
   */
  onShow: () => void

  /**
   * Called on hover-out (after a short grace period, so moving from the
   * button into the popup doesn't flicker-close it) to request the popup
   * close. Also called when the user turns simplification off from inside
   * the popup, since the popup has nothing left to show once disabled.
   */
  onHide: () => void
}

/**
 * The three selectable simplification intensities, in order from least to
 * most aggressive. Defined outside the component to avoid recreation on
 * every render.
 */
const levels: { key: 'low' | 'medium' | 'high'; label: string; desc: string }[] = [
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
 * - Clicking the dock button toggles `settings.wordSimplification` on/off.
 *   This is independent of the popup — clicking does not open or close it.
 * - Hovering the button, while simplification is enabled, opens the level
 *   picker via `onShow`; moving the mouse away from both the button and the
 *   popup closes it via `onHide`, after a short delay so crossing from the
 *   button into the popup doesn't close it prematurely.
 * - The popup itself only renders when both `open` is true **and**
 *   `settings.wordSimplification` is true — so turning simplification off
 *   hides it even if `open` hasn't caught up yet.
 * - Selecting a level writes `wordComplexity`; a checkmark and filled
 *   dot mark the currently active level.
 * - A "Turn off" row at the bottom disables simplification entirely via
 *   `updateSetting('wordSimplification', false)` and closes the popup.
 */
export default function WordSimplify({ open, onShow, onHide }: WordSimplifyProps) {
  const { settings, updateSetting } = useSettings()

  /** Whether word simplification is currently active. */
  const enabled = settings.wordSimplification

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
          updateSetting('wordSimplification', !enabled)
        }}
        data-tooltip="Word Simplification"
        aria-label="Word Simplification"
      >
        <BookOpen size={20} strokeWidth={1.8} />
      </button>

      {open && enabled && (
        <div
          className="bonita-pos-popup"
          onMouseEnter={cancelHide}
          onMouseLeave={scheduleHide}
        >
          {levels.map(({ key, label, desc }) => (
            <button
              key={key}
              className={`bonita-pos-row ${settings.wordComplexity === key ? 'on' : ''}`}
              onClick={() => updateSetting('wordComplexity', key)}
            >
              <span style={{
                width: 12, height: 12, borderRadius: '50%', flexShrink: 0,
                background: settings.wordComplexity === key ? '#6f4fd8' : '#d1cce8',
                display: 'inline-block',
              }} />
              <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <span>{label}</span>
                <span style={{ fontSize: 10, opacity: 0.6 }}>{desc}</span>
              </span>
              <span className="bonita-pos-check">✓</span>
            </button>
          ))}
          <div style={{ borderTop: '1px solid rgba(111,79,216,0.12)', margin: '4px 0' }} />
          <button
            className="bonita-pos-row"
            onClick={() => {
              updateSetting('wordSimplification', false)
              cancelHide()
              onHide()
            }}
            style={{ color: '#9678D3' }}
          >
            Turn off
          </button>
        </div>
      )}
    </div>
  )
}