import { useRef } from 'react'
import { Type } from 'lucide-react'
import { useSettings } from '../hooks/useSettings'
import { BonitaSettings } from '../../shared/settings'
import { useFontApplier } from '../hooks/useFontApplier'

/**
 * Props for the FontSelector component.
 *
 * Controls which font the page text is rendered in. The component renders a
 * dock button that opens an inline popup listing the available fonts.
 */
interface FontSelectorProps {
  /**
   * Whether the configuration popup is currently open.
   * Controlled by the parent.
   */
  open: boolean

  /**
   * Called on hover-in (or click, as a fallback for touch/accessibility) to
   * request the popup open. Like POS highlighting, font selection has no
   * separate on/off click — the popup itself is where a font gets picked —
   * so this isn't gated on any prior "enabled" state.
   */
  onShow: () => void

  /**
   * Called on hover-out (after a short grace period, so moving from the
   * button into the popup doesn't flicker-close it) to request the popup
   * close. Also called directly when a font is picked, since selecting one
   * is a one-shot action that should close the popup immediately.
   */
  onHide: () => void
}

/**
 * The selectable fonts, in display order. `value` must match
 * {@link BonitaSettings.font}. Defined outside the component to avoid
 * recreation on every render.
 */
const FONTS: { value: BonitaSettings['font']; label: string }[] = [
  { value: 'default', label: 'Default' },
  { value: 'opendyslexic', label: 'OpenDyslexic' },
  { value: 'arial', label: 'Arial' },
  { value: 'verdana', label: 'Verdana' },
]

/**
 * FontSelector
 *
 * Dock button that lets the user override the page's font.
 *
 * Behaviour:
 * - Hovering the dock button opens the popup via `onShow`; moving the mouse
 *   away from both the button and the popup closes it via `onHide`, after a
 *   short delay so crossing from the button into the popup doesn't close it
 *   prematurely. Clicking the button also calls `onShow`, as a fallback for
 *   touch/accessibility.
 * - The button renders with the `active` class whenever a non-default font
 *   is selected (`settings.font !== 'default'`).
 * - Picking a font from the popup writes `settings.font` via `updateSetting`
 *   and calls `onHide` directly, closing the popup immediately (selecting a
 *   font is a one-shot action, unlike the multi-select POS highlighter).
 * - Mounts {@link useFontApplier}, which is responsible for actually
 *   applying `settings.font` to the page; this component only renders the
 *   picker UI and owns none of that DOM-mutation logic itself.
 */
export default function FontSelector({ open, onShow, onHide }: FontSelectorProps) {
  const { settings, updateSetting } = useSettings()
  useFontApplier()

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
        cancelHide()
        onShow()
      }}
      onMouseLeave={scheduleHide}
    >
      <button
        className={`bonita-icon-btn ${settings.font !== 'default' ? 'active' : ''}`}
        onClick={onShow}
        data-tooltip="Font"
        aria-label="Font"
      >
        <Type size={20} strokeWidth={1.8} />
      </button>
      {open && (
        <div
          className="bonita-font-popup"
          onMouseEnter={cancelHide}
          onMouseLeave={scheduleHide}
        >
          {FONTS.map((f) => (
            <button
              key={f.value}
              className={`bonita-font-option ${settings.font === f.value ? 'selected' : ''}`}
              onClick={() => {
                updateSetting('font', f.value)
                cancelHide()
                onHide()
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}