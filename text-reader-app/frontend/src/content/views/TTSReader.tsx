import { Volume2 } from 'lucide-react'
import { useEffect, useRef } from 'react'
import IconToggle from './IconToggle'
import { useSettings } from '../hooks/useSettings'

const READABLE = 'p, li, h1, h2, h3, h4, h5, h6, td, blockquote'
const HIGHLIGHT_CLASS = 'bonita-tts-word'
const ACTIVE_CLASS = 'bonita-tts-active'
const STYLE_ID = 'bonita-tts-styles'

/**
 * Wraps each whitespace-delimited word in `el` with a `<span>` so individual
 * words can be highlighted during speech. The element's original innerHTML is
 * saved to `data-bonita-original` so it can be fully restored later.
 *
 * @param el - The readable element whose text should be word-wrapped.
 */
function wrapWords(el: HTMLElement): void {
  el.dataset.bonitaOriginal = el.innerHTML
  const text = el.textContent?.trim() ?? ''
  const words = text.split(/(\s+)/)
  el.innerHTML = words
    .map((w) =>
      /\S/.test(w)
        ? `<span class="${HIGHLIGHT_CLASS}">${w}</span>`
        : w
    )
    .join('')
}

/**
 * Restores an element previously processed by {@link wrapWords} to its
 * original innerHTML. No-ops if the element was never wrapped.
 *
 * @param el - The element to restore.
 */
function restoreEl(el: HTMLElement): void {
  if (el.dataset.bonitaOriginal !== undefined) {
    el.innerHTML = el.dataset.bonitaOriginal
    delete el.dataset.bonitaOriginal
  }
}

/**
 * TTSReader
 *
 * Renders the Text-to-Speech toggle button and manages all TTS behaviour.
 *
 * ## How it works
 * When TTS is enabled the component listens for `mouseover` events on the
 * document. Hovering a readable element (paragraph, heading, list item, etc.)
 * for 400 ms triggers speech synthesis for that element's text content.
 * Each word is wrapped in a `<span>` and highlighted in sync with the
 * `onboundary` event so the currently spoken word is always visually marked.
 *
 * ## Resume hack
 * Chrome's Web Speech API silently pauses long utterances after ~15 s. A
 * 1-second interval calls `pause()`/`resume()` to keep synthesis alive. The
 * interval is created inside the effect and torn down in the same cleanup
 * function so it never outlives an active TTS session.
 *
 * ## Cleanup
 * Disabling TTS (or unmounting) cancels any in-progress speech, clears the
 * hover timer, restores any word-wrapped element, and removes the injected
 * stylesheet.
 */
export default function TTSReader() {
  const { settings, updateSetting } = useSettings()

  /** The element currently being read aloud, or `null` if idle. */
  const activeEl = useRef<HTMLElement | null>(null)

  /** Debounce timer for the 400 ms hover delay. */
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  /** Chrome resume-hack interval handle. */
  const resumeHackRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    // ── Teardown path ──────────────────────────────────────────────────────
    if (!settings.tts) {
      window.speechSynthesis?.cancel()
      if (timerRef.current) clearTimeout(timerRef.current)
      if (resumeHackRef.current) clearInterval(resumeHackRef.current)
      if (activeEl.current) restoreEl(activeEl.current)
      activeEl.current = null
      document.getElementById(STYLE_ID)?.remove()
      return
    }

    // ── Setup path ─────────────────────────────────────────────────────────

    // Inject word-highlight styles.
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement('style')
      style.id = STYLE_ID
      style.textContent = `
        .${HIGHLIGHT_CLASS} {
          border-radius: 2px;
          transition: background 0.1s;
        }
        .${ACTIVE_CLASS} {
          background: #e6a800;
          color: #000;
        }
      `
      document.head.appendChild(style)
    }

    // Warm up the speech engine (fixes first-utterance silence on some browsers).
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(''))

    // Start the Chrome resume hack. Pausing then immediately resuming every
    // second prevents the engine from silently stalling on long passages.
    resumeHackRef.current = setInterval(() => {
      if (!window.speechSynthesis.speaking) return
      window.speechSynthesis.pause()
      window.speechSynthesis.resume()
    }, 1000)

    /**
     * Fired on every `mouseover`. Debounces by 400 ms before starting speech
     * so brief mouse movements don't trigger unwanted utterances.
     *
     * @param e - The native mouseover event.
     */
    const handleEnter = (e: MouseEvent) => {
      const target = (e.target as HTMLElement).closest<HTMLElement>(READABLE)
      if (!target || target === activeEl.current) return

      if (timerRef.current) clearTimeout(timerRef.current)

      timerRef.current = setTimeout(() => {
        window.speechSynthesis.cancel()
        if (activeEl.current) restoreEl(activeEl.current)

        activeEl.current = target
        wrapWords(target)

        const spans = Array.from(
          target.querySelectorAll<HTMLElement>(`.${HIGHLIGHT_CLASS}`)
        )
        const text = spans.map((s) => s.textContent).join(' ')

        // Pre-compute the character offset of each word span so `onboundary`
        // can map a charIndex back to a span index in O(n) without searching.
        const charPositions: number[] = []
        let pos = 0
        for (const span of spans) {
          charPositions.push(pos)
          pos += (span.textContent?.length ?? 0) + 1 // +1 for the joining space
        }

        const utterance = new SpeechSynthesisUtterance(text)
        utterance.rate = 1.0
        utterance.pitch = 1

        /**
         * Highlights the word span whose character range contains `charIndex`.
         */
        utterance.onboundary = (ev) => {
          if (ev.name !== 'word') return
          let idx = 0
          for (let i = 0; i < charPositions.length; i++) {
            if (charPositions[i] <= ev.charIndex) idx = i
            else break
          }
          spans.forEach((s) => s.classList.remove(ACTIVE_CLASS))
          spans[idx]?.classList.add(ACTIVE_CLASS)
        }

        /** Restores the element once the utterance finishes naturally. */
        utterance.onend = () => {
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
      if (resumeHackRef.current) clearInterval(resumeHackRef.current)
      window.speechSynthesis.cancel()
      if (activeEl.current) restoreEl(activeEl.current)
      activeEl.current = null
      document.getElementById(STYLE_ID)?.remove()
    }
  }, [settings.tts])

  return (
    <IconToggle
      label={settings.tts ? 'Stop Speech' : 'Text to Speech'}
      icon={Volume2}
      enabled={settings.tts ?? false}
      onChange={(v) => updateSetting('tts', v)}
    />
  )
}