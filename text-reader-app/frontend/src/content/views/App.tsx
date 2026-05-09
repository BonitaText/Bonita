import { useState, useRef } from 'react'
import { useFontApplier } from '../hooks/useFontApplier'
import { usePOSHighlighter } from '../hooks/usePOSHighlighter'
import { useSentenceSplitter } from '../hooks/useSentenceSplitter'
import { useWordSimplifier } from '../hooks/useWordSimplifier'
import PhraseBolding from './PhraseBolding'
import POSHighlight from './POSHighlight'
import SentenceSplitting from './SentenceSplitting'
import WordSimplify from './WordSimplify'
import FontSelector from './FontSelector'

const TRIGGER_SIZE = 48
const DEFAULT_MARGIN = 24
const DRAG_THRESHOLD = 5

const styles = `
  .bonita-trigger {
    position: fixed;
    width: 48px;
    height: 48px;
    border-radius: 50%;
    background: #9678D3;
    border: none;
    cursor: grab;
    pointer-events: auto;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 2px 12px rgba(0,0,0,0.2);
    z-index: 2147483647;
    color: white;
    font-weight: bold;
    font-size: 18px;
    font-family: sans-serif;
    user-select: none;
    transition: transform 0.15s;
  }

  .bonita-trigger:active { cursor: grabbing; }
  .bonita-trigger:hover { transform: scale(1.08); }

  .bonita-dock {
    position: fixed;
    background: white;
    border-radius: 28px;
    padding: 6px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    box-shadow: 0 6px 20px rgba(0,0,0,0.15);
    z-index: 2147483646;
    pointer-events: auto;
    transform: scale(0);
    transform-origin: bottom right;
    transition: transform 0.18s ease;
    font-family: sans-serif;
  }

  .bonita-dock.open { transform: scale(1); }

  .bonita-icon-btn {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    border: none;
    background: transparent;
    color: #555;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.15s, color 0.15s;
    position: relative;
    padding: 0;
  }

  .bonita-icon-btn:hover {
    background: #f3f0fa;
    color: #9678D3;
  }

  .bonita-icon-btn.active {
    background: #9678D3;
    color: white;
  }

  .bonita-icon-btn::before {
    content: attr(data-tooltip);
    position: absolute;
    right: 100%;
    top: 50%;
    transform: translateY(-50%);
    margin-right: 10px;
    background: #1a1a1a;
    color: white;
    padding: 4px 10px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 500;
    white-space: nowrap;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.15s;
  }

  .bonita-icon-btn:hover::before { opacity: 1; }

  .bonita-font-wrapper {
    position: relative;
  }

  .bonita-font-popup {
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
    min-width: 140px;
  }

  .bonita-font-option {
    border: none;
    background: transparent;
    padding: 8px 12px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 13px;
    color: #1a1a1a;
    text-align: left;
    font-family: sans-serif;
  }

  .bonita-font-option:hover { background: #f3f0fa; }

  .bonita-font-option.selected {
    background: #9678D3;
    color: white;
  }
`

function App() {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState(() => ({
    left: window.innerWidth - TRIGGER_SIZE - DEFAULT_MARGIN,
    top: window.innerHeight - TRIGGER_SIZE - DEFAULT_MARGIN,
  }))

  const dragStateRef = useRef({
    originLeft: 0,
    originTop: 0,
    startX: 0,
    startY: 0,
    moved: false,
  })

  useFontApplier()
  usePOSHighlighter()
  useSentenceSplitter()
  useWordSimplifier()

  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    dragStateRef.current = {
      originLeft: pos.left,
      originTop: pos.top,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
    }

    const onMove = (ev: MouseEvent) => {
      const s = dragStateRef.current
      const dx = ev.clientX - s.startX
      const dy = ev.clientY - s.startY
      if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
        s.moved = true
      }
      if (s.moved) {
        setPos({
          left: Math.max(0, Math.min(window.innerWidth - TRIGGER_SIZE, s.originLeft + dx)),
          top: Math.max(0, Math.min(window.innerHeight - TRIGGER_SIZE, s.originTop + dy)),
        })
      }
    }

    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      if (!dragStateRef.current.moved) {
        setOpen((o) => !o)
      }
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  // Dock positioned right-aligned with B, sitting above it
  const dockRight = window.innerWidth - (pos.left + TRIGGER_SIZE)
  const dockBottom = window.innerHeight - pos.top + 12

  return (
    <>
      <style>{styles}</style>

      <button
        className="bonita-trigger"
        style={{ left: pos.left, top: pos.top }}
        onMouseDown={onMouseDown}
        title="Bonita (drag to move)"
      >
        B
      </button>

      <div
        className={`bonita-dock ${open ? 'open' : ''}`}
        style={{ right: dockRight, bottom: dockBottom }}
      >
        <SentenceSplitting />
        <PhraseBolding />
        <POSHighlight />
        <WordSimplify />
        <FontSelector />
      </div>
    </>
  )
}

export default App
