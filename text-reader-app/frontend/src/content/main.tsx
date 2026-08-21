;(async () => {
  if (window !== window.top) return

  const { StrictMode } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { default: App } = await import('./views/App.tsx')
  const { SettingsProvider } = await import('./providers/SettingsProvider.tsx')

  // Host element lives in the real page DOM, but only as an attachment
  // point — `all: initial` strips anything the page might inherit down
  // into it (font, color, line-height, etc.) before it can cascade.
  const host = document.createElement('div')
  host.id = 'bonita-shadow-host'
  host.style.all = 'initial'
  host.style.position = 'fixed'
  host.style.top = '0'
  host.style.left = '0'
  host.style.zIndex = '2147483647'
  document.body.appendChild(host)

  // mode: 'open' so devtools can still inspect it — no reason to hide it,
  // and 'closed' just makes debugging harder.
  const shadowRoot = host.attachShadow({ mode: 'open' })

  // Your original container, now mounted inside the shadow root instead of
  // document.body. Everything CSS-wise from here down is fully isolated
  // from the host page in both directions.
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

  shadowRoot.appendChild(container)

  createRoot(container).render(
    <StrictMode>
      <SettingsProvider>
        <App />
      </SettingsProvider>
    </StrictMode>,
  )
})()