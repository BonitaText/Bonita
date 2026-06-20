import type { LucideIcon } from 'lucide-react'

const styles = `
  .bonita-toggle-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 0;
  }

  .bonita-toggle-left {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .bonita-toggle-label {
    font-size: 14px;
    color: #1a1a1a;
    font-weight: 500;
  }

  .bonita-toggle-icon {
    color: #9678D3;
    flex-shrink: 0;
  }

  .bonita-toggle {
    position: relative;
    width: 44px;
    height: 24px;
    border-radius: 12px;
    background: #d1d1d1;
    border: none;
    cursor: pointer;
    padding: 0;
    transition: background 0.2s;
    flex-shrink: 0;
  }

  .bonita-toggle.on {
    background: #9678D3;
  }

  .bonita-toggle::after {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 20px;
    height: 20px;
    background: white;
    border-radius: 50%;
    transition: transform 0.2s;
    box-shadow: 0 1px 3px rgba(0,0,0,0.2);
  }

  .bonita-toggle.on::after {
    transform: translateX(20px);
  }
`

/**
 * Props for the Toggle component.
 *
 * A labelled row pairing an icon + text label with a pill-style on/off
 * switch. Fully controlled — the parent owns `enabled` and receives the
 * next value through `onChange`; the component holds no internal state.
 */
interface ToggleProps {
  /** Text shown next to the icon, and used to build the switch's aria-label. */
  label: string

  /** Icon rendered to the left of the label. */
  icon: LucideIcon

  /** Current on/off state of the switch. */
  enabled: boolean

  /** Called with the negated value whenever the switch is clicked. */
  onChange: (next: boolean) => void
}

/**
 * Toggle
 *
 * Renders an icon, a label, and a pill switch on a single row.
 *
 * Behaviour:
 * - Clicking the switch calls `onChange(!enabled)`; the parent is
 *   responsible for persisting the new value and re-rendering with it.
 * - The `.on` class on the switch drives both its background colour and
 *   the knob's `translateX` via CSS, so the visual state always mirrors
 *   the `enabled` prop directly (no animation state is held locally).
 * - The switch's accessible name is `Toggle {label}`.
 */
export default function Toggle({ label, icon: Icon, enabled, onChange }: ToggleProps) {
  return (
    <>
      <style>{styles}</style>
      <div className="bonita-toggle-row">
        <div className="bonita-toggle-left">
          <Icon size={18} className="bonita-toggle-icon" strokeWidth={1.8} />
          <span className="bonita-toggle-label">{label}</span>
        </div>
        <button
          className={`bonita-toggle ${enabled ? 'on' : ''}`}
          onClick={() => onChange(!enabled)}
          aria-label={`Toggle ${label}`}
        />
      </div>
    </>
  )
}