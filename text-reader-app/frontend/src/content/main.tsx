;(async () => {
  if (window !== window.top) return

  const { StrictMode } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { default: App } = await import('./views/App.tsx')
  const { SettingsProvider } = await import('./providers/SettingsProvider.tsx')  

  const container = document.createElement('div')
  container.id = 'bonita-root'
  container.setAttribute('data-bonita-root', 'true')

  container.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    z-index: 2147483647;
    pointer-events: none;
  `

  document.body.appendChild(container)

  createRoot(container).render(
    <StrictMode>
      <SettingsProvider> 
        <App />
      </SettingsProvider>  
    </StrictMode>,
  )
})()