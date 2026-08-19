import { useRef, useState } from 'react'
import { Palette } from 'lucide-react'
import { useSettings } from '../hooks/useSettings'


/**
 * Props for the POSHighlight component.
 *
 * Controls part-of-speech highlighting on the page. The component renders a
 * toggle button that opens an inline popup listing highlightable POS categories
 * (verbs, nouns, adjectives), each independently togglable with a colour swatch.
 *
 * The button appears `active` whenever the tool has been toggled on — this is
 * tracked independently of whether any individual category is selected, so
 * clicking the button on immediately reveals the popup on hover even before
 * the user picks a category.
 */
interface POSHighlightProps {
  /**
   * Whether the configuration popup is currently open.
   * Controlled by the parent.
   */
  open: boolean

  /**
   * Called on hover-in, only while the tool is toggled on, to request the
   * popup open. Independent of the enable/disable click.
   */
  onShow: () => void

  /**
   * Called on hover-out (after a short grace period, so moving from the
   * button into the popup doesn't flicker-close it) to request the popup
   * close.
   */
  onHide: () => void
}

const styles = `
  .bonita-pos-popup {
    position: absolute;
    right: calc(100% + 12px);
    top: 0;
    background: white;
    border-radius: 12px;
    padding: 6px;
    box-shadow: 0 6px 20px rgba(0,0,0,0.15);
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 160px;
  }

  .bonita-pos-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 13px;
    color: #1a1a1a;
    border: none;
    background: transparent;
    text-align: left;
    width: 100%;
    font-family: sans-serif;
  }

  .bonita-pos-row:hover { background: #f3f0fa; }

  .bonita-pos-dot {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .bonita-pos-row .bonita-pos-check {
    margin-left: auto;
    color: #9678D3;
    font-weight: bold;
    visibility: hidden;
  }

  .bonita-pos-row.on .bonita-pos-check { visibility: visible; }
`

/**
* The three POS categories that can be independently highlighted.
* Defined outside the component to avoid recreation on every render.
*/
const items: { key: 'verbs' | 'nouns' | 'adjectives'; label: string }[] = [
  { key: 'verbs', label: 'Verbs' },
  { key: 'nouns', label: 'Nouns' },
  { key: 'adjectives', label: 'Adjectives' },
]

/**
 * POSHighlight
 *
 * Dock button that toggles part-of-speech highlighting on the host page.
 *
 * Behaviour:
 * - Clicking the button toggles a local "tool enabled" state on/off,
 *   independent of which categories are selected. This is what drives the
 *   `active` class and gates the hover popup — matching the click-toggles/
 *   hover-reveals pattern used by the other dock tools. The click also calls
 *   `onShow`/`onHide` directly, since the mouse is already over the button
 *   at the moment of the click and `onMouseEnter` won't fire again on its
 *   own.
 * - Turning the tool off also clears all selected categories
 *   (`settings.posEnabled`), so highlighting actually stops rather than
 *   just hiding the button state.
 * - Hovering the button, while the tool is enabled, opens the popup via
 *   `onShow`; moving the mouse away from both the button and the popup
 *   closes it via `onHide`, after a short delay so crossing from the
 *   button into the popup doesn't close it prematurely.
 * - Inside the popup each row independently toggles its POS category
 *   and shows a colour swatch sourced from `settings.posColors[key]`.
 * - A checkmark (✓) is visible on rows whose category is currently on.
 */
export default function POSHighlight({ open, onShow, onHide }: POSHighlightProps) {
  const { settings, updateSetting } = useSettings()

  /**
   * Per-category enabled state. Defaults all categories to false
   * if the setting has never been written.
   */
  const posEnabled = settings.posEnabled ?? { verbs: false, nouns: false, adjectives: false }

  /**
   * Whether the tool has been toggled on via the main button — independent
   * of which categories (if any) are currently selected. Drives the
   * `active` class and gates the hover-popup, matching the other dock
   * tools' click-toggles/hover-reveals pattern.
   */
  const [enabled, setEnabled] = useState(false)

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

  /**
   * Flips a single POS category on or off while preserving the others.
   *
   * @param key - The POS category to toggle.
   */
  const toggle = (key: 'verbs' | 'nouns' | 'adjectives') => {
    updateSetting('posEnabled', {
      ...posEnabled,
      [key]: !posEnabled[key],
    })
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
      <style>{styles}</style>
      <button
        className={`bonita-icon-btn ${enabled ? 'active' : ''}`}
        onClick={() => {
          const next = !enabled
          setEnabled(next)
          cancelHide()
          if (next) {
            // Mouse is already over the button on click — show directly
            // rather than waiting for a hover-enter that won't fire again.
            onShow()
          } else {
            // Turning the tool off stops highlighting entirely, rather than
            // leaving stale categories selected underneath.
            updateSetting('posEnabled', { verbs: false, nouns: false, adjectives: false })
            onHide()
          }
        }}
        data-tooltip="POS Highlighting"
        aria-label="POS Highlighting"
      >
        <Palette size={20} strokeWidth={1.8} />
      </button>
      {open && enabled && (
        <div
          className="bonita-pos-popup"
          onMouseEnter={cancelHide}
          onMouseLeave={scheduleHide}
        >
          {items.map((item) => (
            <button
              key={item.key}
              className={`bonita-pos-row ${posEnabled[item.key] ? 'on' : ''}`}
              onClick={() => toggle(item.key)}
            >
              {/* Colour swatch sourced from settings.posColors */}
              <span
                className="bonita-pos-dot"
                style={{ background: settings.posColors[item.key] }}
              />
              {item.label}
              {/* Visible only when this category is enabled (.on class) */}
              <span className="bonita-pos-check">✓</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}