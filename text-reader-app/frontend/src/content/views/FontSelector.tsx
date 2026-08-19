import { useRef } from 'react'
import { Type } from 'lucide-react'
import { useSettings } from '../hooks/useSettings'
import { BonitaSettings } from '../../shared/settings'
import { useFontApplier } from '../hooks/useFontApplier'

/**
 * Props for the FontSelector component.
 *
 * Controls which font the page text is rendered in. Clicking the dock
 * button toggles the font override fully on/off — no "Default" option is
 * listed in the popup, since turning the tool off via the button *is* the
 * way to return to the default font.
 */
interface FontSelectorProps {
  /** Whether the configuration popup is currently open. Controlled by the parent. */
  open: boolean

  /**
   * Called on hover-in, only while a font override is active, to request
   * the popup open. Independent of the enable/disable click.
   */
  onShow: () => void

  /**
   * Called on hover-out (after a short grace period, so moving from the
   * button into the popup doesn't flicker-close it) to request the popup
   * close. Also called directly when a font is picked, closing the popup
   * immediately since selecting one is a one-shot action.
   */
  onHide: () => void
}

/**
 * The selectable fonts, in display order. Deliberately excludes `'default'`
 * — that state is reached by clicking the dock button off, not by picking
 * it from this list. `value` must match {@link BonitaSettings.font}.
 * Defined outside the component to avoid recreation on every render.
 */
const FONTS: { value: Exclude<BonitaSettings['font'], 'default'>; label: string }[] = [
  { value: 'opendyslexic', label: 'OpenDyslexic' },
  { value: 'arial', label: 'Arial' },
  { value: 'verdana', label: 'Verdana' },
]

/** Font applied when the tool is turned on with no prior selection. */
const FALLBACK_FONT: BonitaSettings['font'] = 'opendyslexic'

/**
 * FontSelector
 *
 * Dock button that lets the user override the page's font.
 *
 * Behaviour:
 * - Clicking the button toggles the override on/off directly:
 *   - Turning **on** applies the last-selected non-default font, or
 *     {@link FALLBACK_FONT} if none was chosen yet this session.
 *   - Turning **off** sets `settings.font` back to `'default'`.
 *   The click also calls `onShow`/`onHide` directly, since the mouse is
 *   already over the button at the moment of the click and `onMouseEnter`
 *   won't fire again on its own.
 * - Hovering the button, while a font override is active, opens the popup
 *   via `onShow`; moving away from both the button and popup closes it via
 *   `onHide`.
 * - The popup lists only real font choices (no "Default" row) — picking one
 *   writes `settings.font` and calls `onHide` directly to close immediately.
 * - Mounts {@link useFontApplier}, which is responsible for actually
 *   applying `settings.font` to the page; this component only renders the
 *   picker UI and owns none of that DOM-mutation logic itself.
 */
export default function FontSelector({ open, onShow, onHide }: FontSelectorProps) {
  const { settings, updateSetting } = useSettings()
  useFontApplier()

  /** Whether a font override is currently active. */
  const enabled = settings.font !== 'default'

  /** Remembers the last non-default font chosen, for re-enabling without re-picking. */
  const lastFontRef = useRef<BonitaSettings['font']>(
    settings.font !== 'default' ? settings.font : FALLBACK_FONT,
  )
  if (settings.font !== 'default') {
    lastFontRef.current = settings.font
  }

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
          updateSetting('font', next ? lastFontRef.current : 'default')
          cancelHide()
          // The mouse is already over the button on click, so onMouseEnter
          // won't fire again on its own — show/hide the popup directly here
          // too, in addition to the hover-based open/close for revisits.
          if (next) onShow()
          else onHide()
        }}
        data-tooltip="Font"
        aria-label="Font"
      >
        <Type size={20} strokeWidth={1.8} />
      </button>
      {open && enabled && (
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