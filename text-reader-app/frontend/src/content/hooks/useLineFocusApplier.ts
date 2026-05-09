import { useEffect } from 'react'
import { useSettings } from './useSettings'

const ROOT_ID = 'bonita-line-focus-root'

const createLayer = (className: string) => {
  const layer = document.createElement('div')
  layer.className = className
  return layer
}

export function useLineFocusApplier() {
  const { settings } = useSettings()

  useEffect(() => {
    document.getElementById(ROOT_ID)?.remove()
    if (!settings.lineFocus) return

    const root = document.createElement('div')
    root.id = ROOT_ID
    root.setAttribute('data-bonita-root', 'true')
    root.innerHTML = `
      <style>
        #${ROOT_ID} .bonita-focus-layer {
          position: fixed;
          left: 0;
          right: 0;
          z-index: 2147483644;
          pointer-events: none;
          background: rgba(18, 14, 24, 0.20);
          backdrop-filter: blur(0.6px);
          transition: height 120ms ease, top 120ms ease;
        }

        #${ROOT_ID} .bonita-focus-band {
          position: fixed;
          left: 10px;
          right: 10px;
          height: 54px;
          z-index: 2147483645;
          pointer-events: none;
          border: 1px solid rgba(126, 91, 239, 0.42);
          border-radius: 12px;
          background: rgba(249, 244, 232, 0.18);
          box-shadow: 0 12px 30px rgba(39, 26, 58, 0.10);
          transition: top 120ms ease;
        }
      </style>
    `

    const top = createLayer('bonita-focus-layer')
    const bottom = createLayer('bonita-focus-layer')
    const band = createLayer('bonita-focus-band')
    root.append(top, bottom, band)
    document.body.appendChild(root)

    const update = (y: number) => {
      const bandTop = Math.max(0, y - 27)
      top.style.top = '0'
      top.style.height = `${bandTop}px`
      band.style.top = `${bandTop}px`
      bottom.style.top = `${bandTop + 54}px`
      bottom.style.height = `${Math.max(0, window.innerHeight - bandTop - 54)}px`
    }

    const onMouseMove = (event: MouseEvent) => update(event.clientY)
    update(window.innerHeight / 2)
    window.addEventListener('mousemove', onMouseMove)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      root.remove()
    }
  }, [settings.lineFocus])
}
