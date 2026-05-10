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
    const fontUrl = chrome.runtime.getURL('fonts/opendyslexic-latin-400-normal.woff2')

    style.textContent = `
      @font-face {
        font-family: 'OpenDyslexic';
        src: url('${fontUrl}') format('woff2');
        font-weight: 400;
        font-style: normal;
      }

      body, body *:not([class^="bonita-"]):not([class^="bonita-"] *) {
        font-family: ${family} !important;
      }
    `
    document.head.appendChild(style)
  }, [settings.font])
}
