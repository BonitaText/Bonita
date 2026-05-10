import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './views/App.tsx'

const container = document.createElement('div')
container.id = 'bonita-root'
container.setAttribute('data-bonita-root', 'true')

// Keep pointer-events none on the shell; App enables them on trigger/dock
container.style.cssText = `
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 2147483647;
  pointer-events: none;
`

// Mount React directly into document — NO shadow DOM.
// Shadow DOM isolates styles which breaks font injection and causes
// shouldSkip() selector mismatches across the boundary.
document.body.appendChild(container)

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
