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

interface ToggleProps {
  label: string
  icon: LucideIcon
  enabled: boolean
  onChange: (next: boolean) => void
}

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
