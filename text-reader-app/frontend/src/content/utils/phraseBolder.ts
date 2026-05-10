const MARKER_CLASS = 'bonita-phrase-bold'

const BLOCKED_TAGS = new Set([
  'script', 'style', 'noscript', 'textarea', 'input',
  'code', 'pre', 'nav', 'header', 'footer', 'aside',
  'button', 'table', 'select', 'svg',
])

function shouldSkip(parent: Element | null): boolean {
  if (!parent) return true
  if (parent.closest('#bonita-root, .bonita-dock, .bonita-trigger, .bonita-font-popup, .bonita-pos-popup')) return true
  if (parent.closest(`.${MARKER_CLASS}`)) return true
  let cursor: Element | null = parent
  while (cursor) {
    if (BLOCKED_TAGS.has(cursor.tagName.toLowerCase())) return true
    cursor = cursor.parentElement
  }
  return false
}

function boldTextNode(textNode: Text, pattern: RegExp) {
  const text = textNode.textContent ?? ''
  const fragment = document.createDocumentFragment()
  const boldedTerms = new Set<string>()
  let lastIndex = 0
  let touched = false
  let match: RegExpExecArray | null

  pattern.lastIndex = 0
  while ((match = pattern.exec(text)) !== null) {
    const matched = match[0]
    const key = matched.toLowerCase()
    if (boldedTerms.has(key)) continue

    if (match.index > lastIndex) {
      fragment.appendChild(document.createTextNode(text.slice(lastIndex, match.index)))
    }

    const span = document.createElement('span')
    span.className = MARKER_CLASS
    span.style.cssText = 'font-weight: 800; color: #3e236b;'
    span.textContent = matched
    fragment.appendChild(span)

    touched = true
    boldedTerms.add(key)
    lastIndex = match.index + matched.length
  }

  if (!touched) return
  if (lastIndex < text.length) {
    fragment.appendChild(document.createTextNode(text.slice(lastIndex)))
  }
  textNode.replaceWith(fragment)
}

function getContentRoot(): Element {
  const selectors = ['main', 'article', '[role="main"]', '#content', '.content']
  for (const sel of selectors) {
    const el = document.querySelector(sel)
    if (el) return el
  }
  return document.body
}

export function applyPhraseBolding(boldTargets: string[]) {
  removePhraseBolding()
  if (boldTargets.length === 0) return

  const sorted = [...boldTargets].sort((a, b) => b.length - a.length)
  const escaped = sorted.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const parts = sorted.map((t, i) =>
    t.includes(' ') ? escaped[i] : `\\b${escaped[i]}\\b`
  )
  const pattern = new RegExp(`(${parts.join('|')})`, 'gi')

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
    boldTextNode(textNode, pattern)
  }
}

export function removePhraseBolding() {
  const wrappers = document.querySelectorAll(`.${MARKER_CLASS}`)
  const parents = new Set<Element>()
  wrappers.forEach((wrapper) => {
    if (wrapper.parentElement) parents.add(wrapper.parentElement)
    wrapper.replaceWith(document.createTextNode(wrapper.textContent ?? ''))
  })
  parents.forEach((parent) => parent.normalize())
}