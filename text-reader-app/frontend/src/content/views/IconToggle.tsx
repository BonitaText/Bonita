import type { LucideIcon } from 'lucide-react'

interface IconToggleProps {
  label: string
  icon: LucideIcon
  enabled: boolean
  onChange: (next: boolean) => void
}

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
