const MARKER_CLASS = 'bonita-complex-word'

const BLOCKED_TAGS = new Set([
  'script', 'style', 'noscript', 'textarea', 'input',
  'code', 'pre', 'nav', 'header', 'footer', 'aside',
  'button', 'table', 'select', 'svg',
])

const WORD_RE = /\b[A-Za-z][A-Za-z'-]*\b/g

function shouldSkip(parent: Element | null): boolean {
  if (!parent) return true
  // FIX: '#crxjs-app' → '#bonita-root'
  if (parent.closest('#bonita-root, .bonita-dock, .bonita-trigger, .bonita-font-popup, .bonita-pos-popup')) return true
  if (parent.closest(`.${MARKER_CLASS}`)) return true
  let cursor: Element | null = parent
  while (cursor) {
    if (BLOCKED_TAGS.has(cursor.tagName.toLowerCase())) return true
    cursor = cursor.parentElement
  }
  return false
}

function getContentRoot(): Element {
  const selectors = ['main', 'article', '[role="main"]', '#content', '.content']
  for (const sel of selectors) {
    const el = document.querySelector(sel)
    if (el) return el
  }
  return document.body
}

export function applyWordUnderlines(complexWords: string[]) {
  removeWordUnderlines()
  if (complexWords.length === 0) return

  const wordSet = new Set(complexWords)
  const root = getContentRoot()

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      if (shouldSkip(node.parentElement)) return NodeFilter.FILTER_REJECT
      if (!/[A-Za-z]/.test(node.textContent ?? '')) return NodeFilter.FILTER_REJECT
      return NodeFilter.FILTER_ACCEPT
    },
  })

  const textNodes: Text[] = []
  let current: Node | null
  while ((current = walker.nextNode())) {
    textNodes.push(current as Text)
  }

  for (const textNode of textNodes) {
    const text = textNode.textContent ?? ''
    const fragment = document.createDocumentFragment()
    let lastIndex = 0
    let touched = false
    let match: RegExpExecArray | null
    WORD_RE.lastIndex = 0

    while ((match = WORD_RE.exec(text)) !== null) {
      const word = match[0]
      const key = word.toLowerCase()
      if (!wordSet.has(key)) continue

      if (match.index > lastIndex) {
        fragment.appendChild(document.createTextNode(text.slice(lastIndex, match.index)))
      }

      const span = document.createElement('span')
      span.className = MARKER_CLASS
      span.style.cssText = 'text-decoration: underline dotted #6f4fd8; cursor: pointer;'
      span.textContent = word
      span.dataset.word = word
      fragment.appendChild(span)

      touched = true
      lastIndex = match.index + word.length
    }

    if (!touched) continue
    if (lastIndex < text.length) {
      fragment.appendChild(document.createTextNode(text.slice(lastIndex)))
    }
    textNode.replaceWith(fragment)
  }
}

export function removeWordUnderlines() {
  const wrappers = document.querySelectorAll(`.${MARKER_CLASS}`)
  const parents = new Set<Element>()
  wrappers.forEach((wrapper) => {
    if (wrapper.parentElement) parents.add(wrapper.parentElement)
    wrapper.replaceWith(document.createTextNode(wrapper.textContent ?? ''))
  })
  parents.forEach((parent) => parent.normalize())
}