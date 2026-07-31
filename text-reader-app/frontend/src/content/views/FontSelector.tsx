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
   * Controlled by the parent via `togglePopup('font')`.
   */
  open: boolean

  /**
   * Callback to toggle the popup open/closed.
   * Called both when the dock button is clicked, and again when a font is
   * picked from the popup — so selecting a font also closes the popup,
   * since the parent's `togglePopup` flips the same popup id closed on a
   * repeated call.
   */
  onOpen: () => void
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
 * - Clicking the dock button calls `onOpen` to reveal the popup.
 * - The button renders with the `active` class whenever a non-default font
 *   is selected (`settings.font !== 'default'`).
 * - Picking a font from the popup writes `settings.font` via `updateSetting`
 *   and **also** calls `onOpen` again, which closes the popup (selecting a
 *   font is a one-shot action, unlike the multi-select POS highlighter).
 * - Mounts {@link useFontApplier}, which is responsible for actually
 *   applying `settings.font` to the page; this component only renders the
 *   picker UI and owns none of that DOM-mutation logic itself.
 */
export default function FontSelector({ open, onOpen }: FontSelectorProps) {
  const { settings, updateSetting } = useSettings()
  useFontApplier()
  return (
    <div className="bonita-font-wrapper">
      <button
        className={`bonita-icon-btn ${settings.font !== 'default' ? 'active' : ''}`}
        onClick={onOpen}
        data-tooltip="Font"
        aria-label="Font"
      >
        <Type size={20} strokeWidth={1.8} />
      </button>
      {open && (
        <div className="bonita-font-popup">
          {FONTS.map((f) => (
            <button
              key={f.value}
              className={`bonita-font-option ${settings.font === f.value ? 'selected' : ''}`}
              onClick={() => {
                updateSetting('font', f.value)
                onOpen()
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