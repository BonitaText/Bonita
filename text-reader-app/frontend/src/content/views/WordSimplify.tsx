import { BookOpen } from 'lucide-react'
import { useSettings } from '../hooks/useSettings'

/**
 * Props for the WordSimplify component.
 *
 * Controls word-simplification on the page. The dock button has a
 * two-step interaction: the first click turns the feature on, and only
 * once it's on do subsequent clicks open the popup for choosing a
 * complexity level (`low` / `medium` / `high`).
 */
interface WordSimplifyProps {
  /**
   * Whether the configuration popup is currently open.
   * Controlled by the parent via `togglePopup('wordSimplify')`.
   */
  open: boolean

  /**
   * Callback to open the popup. Only invoked when word simplification is
   * already enabled — see the component-level behaviour notes.
   */
  onOpen: () => void
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
 * - If `settings.wordSimplification` is off, clicking the dock button
 *   turns it on directly (`updateSetting('wordSimplification', true)`)
 *   and does **not** open the popup on that click.
 * - If it's already on, clicking the dock button instead calls `onOpen`
 *   to reveal the level picker.
 * - The popup itself only renders when both `open` is true **and**
 *   `settings.wordSimplification` is true — so closing the parent popup
 *   state alone, or turning simplification off, both hide it.
 * - Selecting a level writes `wordComplexity`; a checkmark and filled
 *   dot mark the currently active level.
 * - A "Turn off" row at the bottom disables simplification entirely via
 *   `updateSetting('wordSimplification', false)`.
 */
export default function WordSimplify({ open, onOpen }: WordSimplifyProps) {
  const { settings, updateSetting } = useSettings()
  

  return (
    <div className="bonita-font-wrapper">
      <button
        className={`bonita-icon-btn ${settings.wordSimplification ? 'active' : ''}`}
        onClick={() => {
          // First click enables if off; subsequent clicks open the popup
          if (!settings.wordSimplification) {
            updateSetting('wordSimplification', true)
          } else {
            onOpen()
          }
        }}
        data-tooltip="Word Simplification"
        aria-label="Word Simplification"
      >
        <BookOpen size={20} strokeWidth={1.8} />
      </button>

      {open && settings.wordSimplification && (
        <div className="bonita-pos-popup">
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
            onClick={() => updateSetting('wordSimplification', false)}
            style={{ color: '#9678D3' }}
          >
            Turn off
          </button>
        </div>
      )}
    </div>
  )
}