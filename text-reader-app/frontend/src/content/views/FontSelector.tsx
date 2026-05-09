import { Type } from 'lucide-react'
import { useState, useRef, useEffect } from 'react'
import { useSettings } from '../hooks/useSettings'
import { BonitaSettings } from '../../shared/settings'

const FONTS: { value: BonitaSettings['font']; label: string }[] = [
  { value: 'default', label: 'Default' },
  { value: 'opendyslexic', label: 'OpenDyslexic' },
  { value: 'arial', label: 'Arial' },
  { value: 'verdana', label: 'Verdana' },
]

export default function FontSelector() {
  const { settings, updateSetting } = useSettings()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div className="bonita-font-wrapper" ref={ref}>
      <button
        className={`bonita-icon-btn ${settings.font !== 'default' ? 'active' : ''}`}
        onClick={() => setOpen(!open)}
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
                setOpen(false)
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
