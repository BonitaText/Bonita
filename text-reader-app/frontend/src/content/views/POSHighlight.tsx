import { Palette } from 'lucide-react'
import { useSettings } from '../hooks/useSettings'


/**
 * Props for the POSHighlight component.
 *
 * Controls part-of-speech highlighting on the page. The component renders a
 * toggle button that opens an inline popup listing highlightable POS categories
 * (verbs, nouns, adjectives), each independently togglable with a colour swatch.
 *
 * The button appears `active` when at least one POS category is enabled.
 */
interface POSHighlightProps {
  /**
   * Whether the configuration popup is currently open.
   * Controlled by the parent via `togglePopup('pos')`.
   */
  open: boolean

  /**
   * Callback to toggle the popup open/closed.
   * Called on every button click — parent handles the open/close logic
   * via `setOpenPopup(prev => prev === name ? null : name)`.
   */
  onOpen: () => void
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
 * - Clicking the dock button opens/closes the popup via `onOpen`.
 * - The button renders with the `active` class when at least one POS
 *   category (`verbs`, `nouns`, or `adjectives`) is enabled — `anyOn`.
 * - Inside the popup each row independently toggles its POS category
 *   and shows a colour swatch sourced from `settings.posColors[key]`.
 * - A checkmark (✓) is visible on rows whose category is currently on.
 */
export default function POSHighlight({ open, onOpen }: POSHighlightProps) {
  const { settings, updateSetting } = useSettings()

  /**
   * Per-category enabled state. Defaults all categories to false
   * if the setting has never been written.
   */
  const posEnabled = settings.posEnabled ?? { verbs: false, nouns: false, adjectives: false }
  
  /**
   * True when at least one POS category is active.
   * Drives the `active` class on the dock button.
   */
  const anyOn = posEnabled.verbs || posEnabled.nouns || posEnabled.adjectives

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
    <div className="bonita-font-wrapper">
      <style>{styles}</style>
      <button
        className={`bonita-icon-btn ${anyOn ? 'active' : ''}`}
        onClick={onOpen}
        data-tooltip="POS Highlighting"
        aria-label="POS Highlighting"
      >
        <Palette size={20} strokeWidth={1.8} />
      </button>
      {open && (
        <div className="bonita-pos-popup">
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
