import { Palette } from 'lucide-react'
import { useState, useRef, useEffect } from 'react'
import { useSettings } from '../hooks/useSettings'

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

export default function POSHighlight() {
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

  const posEnabled = settings.posEnabled ?? { verbs: false, nouns: false, adjectives: false }
  const anyOn = posEnabled.verbs || posEnabled.nouns || posEnabled.adjectives

  const toggle = (key: 'verbs' | 'nouns' | 'adjectives') => {
    updateSetting('posEnabled', {
      ...posEnabled,
      [key]: !posEnabled[key],
    })
  }

  const items: { key: 'verbs' | 'nouns' | 'adjectives'; label: string }[] = [
    { key: 'verbs', label: 'Verbs' },
    { key: 'nouns', label: 'Nouns' },
    { key: 'adjectives', label: 'Adjectives' },
  ]

  return (
    <div className="bonita-font-wrapper" ref={ref}>
      <style>{styles}</style>
      <button
        className={`bonita-icon-btn ${anyOn ? 'active' : ''}`}
        onClick={() => setOpen(!open)}
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
              <span
                className="bonita-pos-dot"
                style={{ background: settings.posColors[item.key] }}
              />
              {item.label}
              <span className="bonita-pos-check">✓</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
