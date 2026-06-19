import { BookOpen } from 'lucide-react'
import { useSettings } from '../hooks/useSettings'

interface WordSimplifyProps {
  open: boolean
  onOpen: () => void
}

const levels: { key: 'low' | 'medium' | 'high'; label: string; desc: string }[] = [
  { key: 'low',    label: 'Low',    desc: 'More words' },
  { key: 'medium', label: 'Medium', desc: 'Balanced'   },
  { key: 'high',   label: 'High',   desc: 'Fewer words' },
]

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