import { useEffect } from 'react'
import { useSettings } from './useSettings'

const FONT_MAP = {
  default: null,
  arial: 'Arial, sans-serif',
  verdana: 'Verdana, sans-serif',
  opendyslexic: '"OpenDyslexic", "OpenDyslexic Regular", sans-serif',
} as const

const STYLE_ID = 'bonita-font-override'

export function useFontApplier() {
  const { settings } = useSettings()

  useEffect(() => {
    document.getElementById(STYLE_ID)?.remove()

    const family = FONT_MAP[settings.font]
    if (!family) return

    const style = document.createElement('style')
    style.id = STYLE_ID

    // Only declare @font-face for OpenDyslexic — system fonts don't need it
    let fontFace = ''
    if (settings.font === 'opendyslexic') {
      const fontUrl = chrome.runtime.getURL('fonts/opendyslexic-latin-400-normal.woff2')
      fontFace = `
        @font-face {
          font-family: 'OpenDyslexic';
          src: url('${fontUrl}') format('woff2');
          font-weight: 400;
          font-style: normal;
          font-display: swap;
        }
      `
    }

    // FIX: :not([class^="bonita-"] *) is invalid in Chrome — complex selectors
    // inside :not() with descendant combinators are not supported.
    // Apply to everything, then restore Bonita UI with a second rule.
    style.textContent = `
      ${fontFace}

      body, body * {
        font-family: ${family} !important;
      }

      [data-bonita-root="true"],
      [data-bonita-root="true"] * {
        font-family: Inter, ui-sans-serif, system-ui, -apple-system,
                     BlinkMacSystemFont, "Segoe UI", sans-serif !important;
      }
    `

    document.head.appendChild(style)
  }, [settings.font])
}