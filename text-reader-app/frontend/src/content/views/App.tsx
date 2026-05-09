import { useState } from 'react'

const styles = `
  * { box-sizing: border-box; margin: 0; padding: 0; }

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
  }

  .bonita-trigger:hover { transform: scale(1.08); }

  .bonita-trigger svg {
    width: 24px;
    height: 24px;
    fill: white;
  }

  .bonita-panel {
    position: fixed;
    top: 0;
    right: 0;
    width: 420px;
    height: 100vh;
    background: white;
    border-left: 1px solid #e2e2e2;
    pointer-events: auto;
    display: flex;
    flex-direction: column;
    z-index: 2147483646;
    transform: translateX(100%);
    transition: transform 0.3s ease;
    font-family: sans-serif;
  }

  .bonita-panel.open { transform: translateX(0); }

  .bonita-panel-header {
    padding: 16px 20px;
    border-bottom: 1px solid #e2e2e2;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .bonita-panel-header h2 {
    font-size: 16px;
    font-weight: 600;
    color: #1a1a1a;
  }

  .bonita-close {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 20px;
    color: #666;
    pointer-events: auto;
    line-height: 1;
  }

  .bonita-panel-body {
    padding: 20px;
    flex: 1;
    overflow-y: auto;
    color: #333;
    font-size: 15px;
    line-height: 1.6;
  }
`

function App() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <style>{styles}</style>

      <button
        className="bonita-trigger"
        onClick={() => setOpen(!open)}
        title="Open Bonita"
      >
        {/* B icon for Bonita */}
        <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <text x="5" y="18" fontSize="16" fontWeight="bold" fill="white">B</text>
        </svg>
      </button>

      <div className={`bonita-panel ${open ? 'open' : ''}`}>
        <div className="bonita-panel-header">
          <h2>Bonita</h2>
          <button className="bonita-close" onClick={() => setOpen(false)}>✕</button>
        </div>
        <div className="bonita-panel-body">
          {/* restructured content will go here */}
          <p>Panel ready. Processing coming soon.</p>
        </div>
      </div>
    </>
  )
}

export default App