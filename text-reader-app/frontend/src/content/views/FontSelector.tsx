import { Type } from 'lucide-react'
import { useSettings } from '../hooks/useSettings'
import { BonitaSettings } from '../../shared/settings'
import { useFontApplier } from '../hooks/useFontApplier'

interface FontSelectorProps {
  open: boolean
  onOpen: () => void
}

const FONTS: { value: BonitaSettings['font']; label: string }[] = [
  { value: 'default', label: 'Default' },
  { value: 'opendyslexic', label: 'OpenDyslexic' },
  { value: 'arial', label: 'Arial' },
  { value: 'verdana', label: 'Verdana' },
]

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
