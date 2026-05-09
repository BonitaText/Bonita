import { useState } from 'react'
import { useFontApplier } from '../hooks/useFontApplier'
import { useLineFocusApplier } from '../hooks/useLineFocusApplier'
import { useReadingToolsApplier } from '../hooks/useReadingToolsApplier'
import PhraseBolding from './PhraseBolding'
import POSHighlight from './POSHighlight'
import SentenceSplitting from './SentenceSplitting'
import WordSimplify from './WordSimplify'
import FontSelector from './FontSelector'
import LineFocusToggle from './LineFocusToggle'
import TTSReader from './TTSReader'

const styles = `
  :root {
    --bonita-purple: #6f4fd8;
    --bonita-purple-dark: #2d2148;
    --bonita-cream: #f7f0df;
    --bonita-white: #fffdf8;
    --bonita-grey: #716b7b;
    --bonita-black: #17131f;
  }

  .bonita-trigger {
    position: fixed;
    bottom: 24px;
    right: 24px;
    width: 58px;
    height: 58px;
    border-radius: 18px;
    background:
      radial-gradient(circle at 28% 24%, rgba(255, 253, 248, 0.44), transparent 28px),
      linear-gradient(145deg, #8061ee, #4b2fa2);
    border: 1px solid rgba(255, 253, 248, 0.42);
    cursor: pointer;
    pointer-events: auto;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 18px 44px rgba(45, 33, 72, 0.36);
    z-index: 2147483647;
    transition: transform 0.22s ease, box-shadow 0.22s ease, filter 0.22s ease;
    color: white;
    font-weight: 900;
    font-size: 20px;
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }

  .bonita-trigger:hover {
    transform: translateY(-3px) scale(1.04);
    box-shadow: 0 22px 54px rgba(45, 33, 72, 0.44);
    filter: saturate(1.08);
  }

  .bonita-trigger.open {
    border-radius: 50%;
    transform: rotate(8deg);
  }

  .bonita-trigger-mark {
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    border-radius: 12px;
    background: rgba(255, 253, 248, 0.16);
    box-shadow: inset 0 0 0 1px rgba(255, 253, 248, 0.18);
  }

  .bonita-dock {
    position: fixed;
    bottom: 94px;
    right: 24px;
    min-width: 72px;
    background:
      linear-gradient(180deg, rgba(255, 253, 248, 0.96), rgba(247, 240, 223, 0.94));
    border: 1px solid rgba(111, 79, 216, 0.20);
    border-radius: 26px;
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    box-shadow: 0 20px 58px rgba(23, 19, 31, 0.22);
    z-index: 2147483646;
    pointer-events: auto;
    opacity: 0;
    transform: translateY(12px) scale(0.88);
    transform-origin: bottom right;
    transition: transform 0.22s ease, opacity 0.18s ease;
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    backdrop-filter: blur(18px);
  }

  .bonita-dock.open {
    opacity: 1;
    transform: translateY(0) scale(1);
  }

  .bonita-dock-header {
    display: grid;
    gap: 1px;
    padding: 7px 8px 9px;
    border-bottom: 1px solid rgba(111, 79, 216, 0.15);
    text-align: center;
  }

  .bonita-dock-header strong {
    color: var(--bonita-purple-dark);
    font-size: 12px;
    letter-spacing: 0;
  }

  .bonita-dock-header span {
    color: var(--bonita-grey);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .bonita-icon-btn {
    width: 48px;
    height: 48px;
    border-radius: 16px;
    border: none;
    background: rgba(255, 253, 248, 0.72);
    color: var(--bonita-grey);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.18s ease, color 0.18s ease, transform 0.18s ease, box-shadow 0.18s ease;
    position: relative;
    padding: 0;
  }

  .bonita-icon-btn:hover {
    background: #f7f0df;
    color: var(--bonita-purple);
    transform: translateX(-2px);
  }

  .bonita-icon-btn.active {
    background: linear-gradient(145deg, #7f5df0, #5634b8);
    color: white;
    box-shadow: 0 12px 26px rgba(111, 79, 216, 0.30);
  }

  .bonita-icon-btn::before {
    content: attr(data-tooltip);
    position: absolute;
    right: 100%;
    top: 50%;
    transform: translateY(-50%);
    margin-right: 10px;
    background: var(--bonita-black);
    color: var(--bonita-white);
    padding: 7px 11px;
    border-radius: 10px;
    font-size: 12px;
    font-weight: 700;
    white-space: nowrap;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.15s ease, transform 0.15s ease;
    box-shadow: 0 12px 28px rgba(23, 19, 31, 0.22);
  }

  .bonita-icon-btn:hover::before {
    opacity: 1;
    transform: translateY(-50%) translateX(-2px);
  }

  .bonita-font-wrapper {
    position: relative;
  }

  .bonita-font-popup {
    position: absolute;
    right: calc(100% + 12px);
    top: 0;
    background: var(--bonita-white);
    border: 1px solid rgba(111, 79, 216, 0.18);
    border-radius: 16px;
    padding: 8px;
    box-shadow: 0 18px 44px rgba(23, 19, 31, 0.18);
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 160px;
    animation: bonita-pop 180ms ease both;
  }

  .bonita-font-option {
    border: none;
    background: transparent;
    padding: 10px 12px;
    border-radius: 10px;
    cursor: pointer;
    font-size: 13px;
    color: var(--bonita-black);
    text-align: left;
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    transition: background 0.16s ease, color 0.16s ease;
  }

  .bonita-font-option:hover { background: #f7f0df; }

  .bonita-font-option.selected {
    background: var(--bonita-purple);
    color: white;
  }

  @keyframes bonita-pop {
    from {
      opacity: 0;
      transform: translateX(6px) scale(0.98);
    }
    to {
      opacity: 1;
      transform: translateX(0) scale(1);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .bonita-trigger,
    .bonita-dock,
    .bonita-icon-btn,
    .bonita-font-popup {
      transition: none !important;
      animation: none !important;
    }
  }
`

function App() {
  const [open, setOpen] = useState(false)
  useFontApplier()
  useReadingToolsApplier()
  useLineFocusApplier()

  return (
    <>
      <style>{styles}</style>

      <button
        className={`bonita-trigger ${open ? 'open' : ''}`}
        onClick={() => setOpen(!open)}
        title="Open Bonita"
        data-bonita-root="true"
      >
        <span className="bonita-trigger-mark">B</span>
      </button>

      <div className={`bonita-dock ${open ? 'open' : ''}`} data-bonita-root="true">
        <div className="bonita-dock-header">
          <strong>Bonita</strong>
          <span>Reading tools</span>
        </div>
        <SentenceSplitting />
        <PhraseBolding />
        <POSHighlight />
        <WordSimplify />
        <LineFocusToggle />
        <TTSReader />
        <FontSelector />
      </div>
    </>
  )
}

export default App
