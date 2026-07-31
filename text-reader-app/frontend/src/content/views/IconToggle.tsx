import type { LucideIcon } from 'lucide-react'

/**
 * Props for the IconToggle component.
 *
 * A bare icon-only toggle button (no visible text label), styled with the
 * shared `bonita-icon-btn` dock-button class. The label is still required
 * — it's used for the tooltip and the accessible name, just not rendered
 * as visible text.
 */
interface IconToggleProps {
  /** Used as both the `data-tooltip` content and the `aria-label`. */
  label: string

  /** Icon rendered inside the button. */
  icon: LucideIcon

  /** Current on/off state of the toggle. */
  enabled: boolean

  /** Called with the negated value whenever the button is clicked. */
  onChange: (next: boolean) => void
}

/**
 * IconToggle
 *
 * A minimal icon-only toggle button for the dock. Unlike {@link Toggle},
 * it renders no visible label text or switch track — just an icon whose
 * button gets an `active` class when `enabled` is true. Clicking always
 * calls `onChange(!enabled)`; the component holds no internal state.
 */
export default function IconToggle({ label, icon: Icon, enabled, onChange }: IconToggleProps) {
  return (
    <button
      className={`bonita-icon-btn ${enabled ? 'active' : ''}`}
      onClick={() => onChange(!enabled)}
      data-tooltip={label}
      aria-label={label}
    >
      <Icon size={20} strokeWidth={1.8} />
    </button>
  )
}