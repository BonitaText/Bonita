import nlp from 'compromise'

const MARKER_CLASS = 'bonita-pos-wrapper'

type POSTag = 'verbs' | 'nouns' | 'adjectives'

interface POSColors {
  verbs: string
  nouns: string
  adjectives: string
}

interface POSEnabled {
  verbs: boolean
  nouns: boolean
  adjectives: boolean
}

const ALLOWED_TEXT_TAGS = new Set([
  'p', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'blockquote', 'article', 'main', 'section', 'div', 'span',
])

const BLOCKED_TAGS = new Set([
  'script', 'style', 'noscript', 'textarea', 'input',
  'code', 'pre', 'nav', 'header', 'footer', 'aside',
  'button', 'table', 'select', 'svg',
])

function pickTag(tags: any, word: string, enabled: POSEnabled): POSTag | null {
  if (!tags) return null
  const has = (t: string) =>
    Array.isArray(tags) ? tags.includes(t) : Boolean(tags[t])

  // Skip closed-class / filler words (no semantic weight)
  if (has('Pronoun') || has('Determiner') || has('Conjunction')
      || has('Preposition') || has('Auxiliary') || has('Copula')
      || has('Modal') || has('Negative')) {
    return null
  }

  // Skip very short words — usually low-meaning
  if (word.replace(/[^a-zA-Z]/g, '').length < 4) return null

  if (enabled.verbs && has('Verb')) return 'verbs'
  if (enabled.adjectives && has('Adjective')) return 'adjectives'
  if (enabled.nouns && has('Noun')) return 'nouns'
  return null
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function shouldSkip(parent: Element | null): boolean {
  if (!parent) return true

  if (parent.closest('#crxjs-app, .bonita-dock, .bonita-trigger, .bonita-font-popup')) {
    return true
  }

  let inAllowed = false
  let cursor: Element | null = parent
  while (cursor) {
    const tag = cursor.tagName.toLowerCase()
    if (BLOCKED_TAGS.has(tag)) return true
    if (ALLOWED_TEXT_TAGS.has(tag)) inAllowed = true
    cursor = cursor.parentElement
  }
  return !inAllowed
}

export function applyPOSHighlight(colors: POSColors, enabled: POSEnabled) {
  removePOSHighlight()

  if (!enabled.verbs && !enabled.nouns && !enabled.adjectives) return

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      if (shouldSkip(node.parentElement)) return NodeFilter.FILTER_REJECT
      if (!node.textContent || node.textContent.trim().length < 30) return NodeFilter.FILTER_REJECT
      return NodeFilter.FILTER_ACCEPT
    },
  })

  const textNodes: Text[] = []
  let current: Node | null
  while ((current = walker.nextNode())) {
    textNodes.push(current as Text)
  }

  for (const textNode of textNodes) {
    const text = textNode.textContent || ''
    if (text.trim().length < 3) continue

    const doc = nlp(text)
    const sentences: any[] = doc.json({ terms: { text: true, tags: true, whitespace: true } })

    let html = ''
    let touched = false
    for (const sentence of sentences) {
      for (const term of sentence.terms || []) {
        const pre = escapeHtml(term.pre || '')
        const post = escapeHtml(term.post || '')
        const word = escapeHtml(term.text || '')
        const tag = pickTag(term.tags, term.text || '', enabled)
        if (tag) {
          html += `${pre}<span class="${MARKER_CLASS}" style="color:${colors[tag]} !important;font-weight:inherit;">${word}</span>${post}`
          touched = true
        } else {
          html += pre + word + post
        }
      }
    }

    if (!touched) continue

    const tmp = document.createElement('span')
    tmp.innerHTML = html
    const fragment = document.createDocumentFragment()
    while (tmp.firstChild) fragment.appendChild(tmp.firstChild)
    textNode.replaceWith(fragment)
  }
}

export function removePOSHighlight() {
  const wrappers = document.querySelectorAll(`.${MARKER_CLASS}`)
  const parents = new Set<Element>()
  wrappers.forEach((wrapper) => {
    if (wrapper.parentElement) parents.add(wrapper.parentElement)
    const text = wrapper.textContent || ''
    wrapper.replaceWith(document.createTextNode(text))
  })
  // Merge adjacent text nodes back into single text nodes (only on parents we touched,
  // so we don't accidentally normalize React-managed DOM)
  parents.forEach((p) => p.normalize())
}
