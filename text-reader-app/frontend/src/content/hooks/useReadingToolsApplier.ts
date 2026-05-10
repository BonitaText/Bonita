import { useEffect } from 'react'
import { useSettings } from './useSettings'

const STYLE_ID = 'bonita-reading-tools-style'
const originalHtml = new WeakMap<HTMLElement, string>()

const simplifications: Record<string, string> = {
  utilize: 'use',
  facilitates: 'helps',
  facilitate: 'help',
  subsequently: 'then',
  commence: 'start',
  terminate: 'end',
  demonstrate: 'show',
  demonstrates: 'shows',
  numerous: 'many',
  sufficient: 'enough',
  approximately: 'about',
  assist: 'help',
  individuals: 'people',
  cognitive: 'thinking',
  accessibility: 'access',
  unstructured: 'not organized',
  substantial: 'large',
  retain: 'remember',
  engage: 'use',
}

const styles = `
  .bonita-processed {
    line-height: 1.78 !important;
    letter-spacing: 0 !important;
    transition: background 220ms ease, box-shadow 220ms ease, color 220ms ease;
  }

  .bonita-sentence {
    display: block;
    margin: 0 0 0.48em !important;
  }

  .bonita-keyword {
    font-weight: 800 !important;
    color: #3e236b !important;
  }

  .bonita-simple-word {
    border-bottom: 2px solid rgba(126, 91, 239, 0.38);
    background: rgba(249, 244, 232, 0.92);
    border-radius: 4px;
    padding: 0 0.08em;
    cursor: help;
  }

  .bonita-pos-verb {
    color: #5a35c7 !important;
    background: rgba(126, 91, 239, 0.12);
    border-radius: 4px;
    padding: 0 0.08em;
  }

  .bonita-pos-noun {
    color: #19151f !important;
    box-shadow: inset 0 -0.42em rgba(249, 244, 232, 0.95);
  }

  .bonita-pos-adjective {
    color: #7a4e12 !important;
    background: rgba(229, 211, 174, 0.58);
    border-radius: 4px;
    padding: 0 0.08em;
  }
`

const candidateSelector = [
  'article p',
  'main p',
  '[role="main"] p',
  '.content p',
  '.post p',
  '.entry-content p',
  'section p',
  'li',
].join(', ')

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')

const getWordKind = (word: string) => {
  const lower = word.toLowerCase()
  if (/(ing|ed|ize|ise|ate|ify|en)$/.test(lower)) return 'verb'
  if (/(ous|ive|al|ic|able|ible|ful|less)$/.test(lower)) return 'adjective'
  if (/^[A-Z][a-z]{3,}/.test(word) || /(tion|ment|ness|ity|ism|ship)$/.test(lower)) return 'noun'
  return null
}

const formatWord = (
  word: string,
  index: number,
  keywordBolding: boolean,
  wordSimplification: boolean,
  posHighlighting: boolean,
) => {
  let content = escapeHtml(word)
  const lower = word.toLowerCase()

  if (keywordBolding && index < 2 && word.length > 2) {
    content = `<span class="bonita-keyword">${content}</span>`
  }

  if (wordSimplification && simplifications[lower]) {
    content = `<span class="bonita-simple-word" title="Try: ${escapeHtml(simplifications[lower])}">${content}</span>`
  }

  const kind = posHighlighting ? getWordKind(word) : null
  if (kind) {
    content = `<span class="bonita-pos-${kind}">${content}</span>`
  }

  return content
}

const formatText = (
  text: string,
  keywordBolding: boolean,
  wordSimplification: boolean,
  posHighlighting: boolean,
) => {
  let wordIndex = 0

  return text.replace(/[A-Za-z][A-Za-z'-]*/g, (word) => {
    const formatted = formatWord(
      word,
      wordIndex,
      keywordBolding,
      wordSimplification,
      posHighlighting,
    )
    wordIndex += 1
    return formatted
  })
}

const formatBlock = (
  text: string,
  sentenceSplitting: boolean,
  keywordBolding: boolean,
  wordSimplification: boolean,
  posHighlighting: boolean,
) => {
  const sentences = text.match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g) ?? [text]

  if (!sentenceSplitting) {
    return formatText(text, keywordBolding, wordSimplification, posHighlighting)
  }

  return sentences
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .map((sentence) => (
      `<span class="bonita-sentence">${formatText(
        sentence,
        keywordBolding,
        wordSimplification,
        posHighlighting,
      )}</span>`
    ))
    .join('')
}

const getTargets = () =>
  Array.from(document.querySelectorAll<HTMLElement>(candidateSelector)).filter((element) => {
    if (element.closest('[data-bonita-root="true"]')) return false
    if (element.closest('nav, header, footer, aside, form, button, input, textarea')) return false
    const text = element.textContent?.replace(/\s+/g, ' ').trim() ?? ''
    return text.length >= 90 && text.split(/\s+/).length >= 16
  })

const restoreTargets = () => {
  for (const element of getTargets()) {
    const original = originalHtml.get(element)
    if (original !== undefined) {
      element.innerHTML = original
      element.classList.remove('bonita-processed')
    }
  }
}

export function useReadingToolsApplier() {
  const { settings } = useSettings()

  useEffect(() => {
    document.getElementById(STYLE_ID)?.remove()

    const shouldApply =
      settings.sentenceSplitting ||
      settings.keywordBolding ||
      settings.wordSimplification ||
      Object.values(settings.posEnabled).some(Boolean)

    restoreTargets()

    if (!shouldApply) return

    const style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = styles
    document.head.appendChild(style)

    for (const element of getTargets()) {
      if (!originalHtml.has(element)) {
        originalHtml.set(element, element.innerHTML)
      }

      const text = element.textContent?.replace(/\s+/g, ' ').trim()
      if (!text) continue

      element.innerHTML = formatBlock(
        text,
        settings.sentenceSplitting,
        settings.keywordBolding,
        settings.wordSimplification,
        Object.values(settings.posEnabled).some(Boolean),
      )
      element.classList.add('bonita-processed')
    }

    return () => {
      restoreTargets()
      document.getElementById(STYLE_ID)?.remove()
    }
  }, [
    settings.keywordBolding,
    settings.posEnabled,
    settings.sentenceSplitting,
    settings.wordSimplification,
  ])
}
