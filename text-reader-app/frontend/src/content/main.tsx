import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './views/App.tsx'

const container = document.createElement('div')
container.id = 'bonita-root'

// style the outer container
container.style.cssText = `
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 2147483647;
  pointer-events: none;
`

// shadow DOM isolates your styles from the page
const shadow = container.attachShadow({ mode: 'open' })

const mountPoint = document.createElement('div')
mountPoint.id = 'bonita-mount'
mountPoint.style.cssText = `
  width: 100%;
  height: 100%;
  pointer-events: none;
`

shadow.appendChild(mountPoint)
document.body.appendChild(container)

createRoot(mountPoint).render(
  <StrictMode>
    <App />
  </StrictMode>,
)