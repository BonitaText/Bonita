import { Volume2 } from 'lucide-react'
import { useEffect, useRef } from 'react'
import IconToggle from './IconToggle'
import { useSettings } from '../hooks/useSettings'

const READABLE = 'p, li, h1, h2, h3, h4, h5, h6, td, blockquote'
const HIGHLIGHT_CLASS = 'bonita-tts-word'
const ACTIVE_CLASS = 'bonita-tts-active'

function wrapWords(el: HTMLElement) {
  const original = el.innerHTML
  el.dataset.bonitaOriginal = original
  const text = el.innerText.trim()
  const words = text.split(/(\s+)/)
  el.innerHTML = words
    .map((w) =>
      /\S/.test(w)
        ? `<span class="${HIGHLIGHT_CLASS}">${w}</span>`
        : w
    )
    .join('')
}

function restoreEl(el: HTMLElement) {
  if (el.dataset.bonitaOriginal !== undefined) {
    el.innerHTML = el.dataset.bonitaOriginal
    delete el.dataset.bonitaOriginal
  }
}

export default function TTSReader() {
  const { settings, updateSetting } = useSettings()
  const activeEl = useRef<HTMLElement | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  
  useEffect(() => {
    if (!settings.tts) {
      window.speechSynthesis?.cancel()
      if (timerRef.current) clearTimeout(timerRef.current)
      if (activeEl.current) restoreEl(activeEl.current)
      activeEl.current = null
      return
    }
    const style = document.createElement('style')
    style.id = 'bonita-tts-styles'
    style.textContent = `
      .bonita-tts-word {
        border-radius: 2px;
        transition: background 0.1s;
      }
      .bonita-tts-active {
        background: #e6a800;
        color: #000;
      }
    `
    const warmup = new SpeechSynthesisUtterance('')
    window.speechSynthesis.speak(warmup)
  document.head.appendChild(style)
    const handleEnter = (e: MouseEvent) => {
      const target = (e.target as HTMLElement).closest<HTMLElement>(READABLE)
      if (!target || target === activeEl.current) return

      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        window.speechSynthesis.cancel()
        if (activeEl.current) restoreEl(activeEl.current)

        activeEl.current = target
        wrapWords(target)

        const spans = Array.from(target.querySelectorAll<HTMLElement>(`.${HIGHLIGHT_CLASS}`))
        const text = spans.map((s) => s.textContent).join(' ')

        const utterance = new SpeechSynthesisUtterance(text)
        utterance.rate = 1.0
        utterance.pitch = 1
        //preset character map
        const charPositions: number[] = []
        let pos = 0
        spans.forEach((span) => {
          charPositions.push(pos)
          pos += (span.textContent?.length ?? 0) + 1 // +1 for the space
        })
        
        utterance.onboundary = (e) => {
          if (e.name !== 'word') return
          let idx = 0
          for (let i = 0; i < charPositions.length; i++) {
            if (charPositions[i] <= e.charIndex) idx = i
            else break
          }
          spans.forEach((s) => s.classList.remove(ACTIVE_CLASS))
          if (idx >= 0 && spans[idx]) spans[idx].classList.add(ACTIVE_CLASS)
        }

        utterance.onend = () => {
          if (activeEl.current === target) {
            restoreEl(target)
            activeEl.current = null
          }
        }
        utterance.onend = () => {
          clearInterval(resumeHack)
          if (activeEl.current === target) {
            restoreEl(target)
            activeEl.current = null
          }
        }

        window.speechSynthesis.speak(utterance)
      }, 400)
    }

    document.addEventListener('mouseover', handleEnter)
    return () => {
      document.removeEventListener('mouseover', handleEnter)
      if (timerRef.current) clearTimeout(timerRef.current)
      window.speechSynthesis.cancel()
      if (activeEl.current) restoreEl(activeEl.current)
      activeEl.current = null
    }
  }, [settings.tts])
  const resumeHack = setInterval(() => {
  if (!window.speechSynthesis.speaking) return
  window.speechSynthesis.pause()
  window.speechSynthesis.resume()
}, 1000)


  return (
    <IconToggle
      label={settings.tts ? 'Stop Speech' : 'Text to Speech'}
      icon={Volume2}
      enabled={settings.tts}
      onChange={(v) => updateSetting('tts', v)}
    />
  )
}
