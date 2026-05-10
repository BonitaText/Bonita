const MARKER_CLASS = 'bonita-split'
const ORIGINAL_ATTR = 'data-bonita-original'

interface ParagraphScore {
  text: string
  action: 'none' | 'split' | 'llm'
}

const BLOCKED_TAGS = new Set([
  'script', 'style', 'noscript', 'textarea', 'input',
  'code', 'pre', 'nav', 'header', 'footer', 'aside',
  'button', 'table', 'select', 'svg',
])

const ABBREV_RE = /\b(Dr|Mr|Mrs|Ms|Prof|Fig|et al|vs|i\.e|e\.g|etc|Vol|No|pp|ed|eds|Rev|approx|Dept|Est|Min|Max|Avg|Ref|Sec|Eq|Suppl|approx)\./gi

function shouldSkip(el: Element): boolean {
  // FIX: '#crxjs-app' → '#bonita-root'
  if (el.closest('#bonita-root, .bonita-dock, .bonita-trigger')) return true
  let cursor: Element | null = el.parentElement
  while (cursor) {
    if (BLOCKED_TAGS.has(cursor.tagName.toLowerCase())) return true
    cursor = cursor.parentElement
  }
  return false
}

function splitIntoSentences(text: string): string[] {
  const masked = text.replace(ABBREV_RE, (m) => m.replace('.', '\x00'))
  const parts = masked
    .split(/(?<=[.!?])\s+(?=[A-Z])/)
    .map(s => s.replace(/\x00/g, '.').trim())
    .filter(s => s.length > 0 && /[A-Za-z0-9]/.test(s))
  return parts
}

function getContentRoot(): Element {
  const selectors = ['main', 'article', '[role="main"]', '#content', '.content']
  for (const sel of selectors) {
    const el = document.querySelector(sel)
    if (el) return el
  }
  return document.body
}

function getParagraphElements(root: Element): Element[] {
  const ps = Array.from(root.querySelectorAll('p'))
  if (ps.length >= 3) return ps

  const candidates = Array.from(root.querySelectorAll('div, section'))
    .filter(el => {
      const hasBlockChild = Array.from(el.children).some(child =>
        ['div', 'section', 'article', 'p', 'ul', 'ol', 'table'].includes(
          child.tagName.toLowerCase()
        )
      )
      if (hasBlockChild) return false
      const words = (el.textContent ?? '').trim().split(/\s+/).length
      return words >= 65
    })

  return ps.length > 0 ? [...ps, ...candidates] : candidates
}

export function applySentenceSplit(paragraphScores: ParagraphScore[]) {
  if (!Array.isArray(paragraphScores) || paragraphScores.length === 0) return
  removeSentenceSplit()

  const root = getContentRoot()
  const elements = getParagraphElements(root)

  for (const el of elements) {
    if (shouldSkip(el)) continue
    if (el.classList.contains(MARKER_CLASS)) continue

    const text = (el.textContent ?? '').trim()
    const score = paragraphScores.find(s => text.startsWith(s.text.slice(0, 80)))
    if (!score || (score.action !== 'split' && score.action !== 'llm')) continue

    const sentences = splitIntoSentences(text)
    if (sentences.length < 2) continue

    el.setAttribute(ORIGINAL_ATTR, el.innerHTML)
    el.classList.add(MARKER_CLASS)

    const ul = document.createElement('ul')
    ul.style.cssText = 'margin: 8px 0; padding-left: 1.5em; list-style: disc;'

    for (const sentence of sentences) {
      const li = document.createElement('li')
      li.style.cssText = 'margin-bottom: 6px; line-height: 1.6;'
      li.textContent = sentence
      ul.appendChild(li)
    }

    el.innerHTML = ''
    el.appendChild(ul)
  }
}

export function removeSentenceSplit() {
  const splits = document.querySelectorAll(`.${MARKER_CLASS}`)
  for (const el of Array.from(splits)) {
    const original = el.getAttribute(ORIGINAL_ATTR)
    if (original !== null) {
      el.innerHTML = original
      el.removeAttribute(ORIGINAL_ATTR)
    }
    el.classList.remove(MARKER_CLASS)
  }
}