import { useState } from 'react'
import { useFontApplier } from '../hooks/useFontApplier'
import PhraseBolding from './PhraseBolding'
import POSHighlight from './POSHighlight'
import SentenceSplitting from './SentenceSplitting'
import WordSimplify from './WordSimplify'
import FontSelector from './FontSelector'

const styles = `
  .bonita-trigger {
    position: fixed;
    bottom: 24px;
    right: 24px;
    width: 48px;
    height: 48px;
    border-radius: 50%;
    background: #5243AA;
    border: none;
    cursor: pointer;
    pointer-events: auto;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 2px 12px rgba(0,0,0,0.2);
    z-index: 2147483647;
    transition: transform 0.2s;
    color: white;
    font-weight: bold;
    font-size: 18px;
    font-family: sans-serif;
  }

  .bonita-trigger:hover { transform: scale(1.08); }

  .bonita-dock {
    position: fixed;
    bottom: 84px;
    right: 24px;
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
    color: #5243AA;
  }

  .bonita-icon-btn.active {
    background: #5243AA;
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
    background: #5243AA;
    color: white;
  }
`

function App() {
  const [open, setOpen] = useState(false)
  useFontApplier()

  return (
    <>
      <style>{styles}</style>

      <button
        className="bonita-trigger"
        onClick={() => setOpen(!open)}
        title="Open Bonita"
      >
        B
      </button>

      <div className={`bonita-dock ${open ? 'open' : ''}`}>
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
