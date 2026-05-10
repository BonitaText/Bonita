const MARKER_CLASS = 'bonita-phrase-bold'

const BLOCKED_TAGS = new Set([
  'script', 'style', 'noscript', 'textarea', 'input',
  'code', 'pre', 'nav', 'header', 'footer', 'aside',
  'button', 'table', 'select', 'svg',
])

const WORD_RE = /\b[A-Za-z][A-Za-z'-]*\b/g
const MIN_PARAGRAPH_WORDS = 18
const MAX_BOLDED_TERMS = 3

const STOP_WORDS = new Set([
  'about', 'above', 'after', 'again', 'against', 'also', 'although', 'always',
  'among', 'and', 'another', 'because', 'been', 'before', 'being', 'between',
  'both', 'but', 'can', 'could', 'does', 'done', 'during', 'each', 'either',
  'even', 'every', 'from', 'had', 'has', 'have', 'having', 'here', 'into',
  'just', 'like', 'many', 'may', 'more', 'most', 'much', 'must', 'not',
  'often', 'only', 'other', 'over', 'same', 'should', 'some', 'such', 'than',
  'that', 'the', 'their', 'them', 'then', 'there', 'these', 'they', 'this',
  'those', 'through', 'under', 'using', 'very', 'was', 'were', 'when', 'where',
  'which', 'while', 'will', 'with', 'within', 'without', 'would', 'your',
])

const IMPORTANT_SUFFIX = /(tion|sion|ment|ness|ity|ism|ship|ability|ibility|ing|ive|ous|able|ible|al|ic)$/i

function shouldSkip(parent: Element | null): boolean {
  if (!parent) return true
  if (parent.closest('#crxjs-app, .bonita-dock, .bonita-trigger, .bonita-font-popup, .bonita-pos-popup')) return true
  if (parent.closest(`.${MARKER_CLASS}`)) return true

  let cursor: Element | null = parent
  while (cursor) {
    const tag = cursor.tagName.toLowerCase()
    if (BLOCKED_TAGS.has(tag)) return true
    cursor = cursor.parentElement
  }
  return false
}

function isCandidate(word: string) {
  const normalized = word.toLowerCase().replace(/^'+|'+$/g, '')
  if (normalized.length < 6) return false
  if (STOP_WORDS.has(normalized)) return false
  return IMPORTANT_SUFFIX.test(normalized) || normalized.length >= 9
}

function getImportantTerms(text: string) {
  const counts = new Map<string, { count: number; first: number; original: string }>()
  let match: RegExpExecArray | null
  WORD_RE.lastIndex = 0

  while ((match = WORD_RE.exec(text)) !== null) {
    const word = match[0]
    const key = word.toLowerCase()
    if (!isCandidate(word)) continue

    const current = counts.get(key)
    if (current) {
      current.count += 1
    } else {
      counts.set(key, { count: 1, first: match.index, original: word })
    }
  }

  return new Set(
    Array.from(counts.entries())
      .sort((a, b) => {
        const aScore = a[1].count * 100 + Math.min(a[0].length, 14) - a[1].first / 1000
        const bScore = b[1].count * 100 + Math.min(b[0].length, 14) - b[1].first / 1000
        return bScore - aScore
      })
      .slice(0, MAX_BOLDED_TERMS)
      .map(([key]) => key),
  )
}

export function applyPhraseBolding() {
  removePhraseBolding()

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      if (shouldSkip(node.parentElement)) return NodeFilter.FILTER_REJECT
      const text = node.textContent ?? ''
      if (!/[A-Za-z]/.test(text)) return NodeFilter.FILTER_REJECT
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
    const wordCount = text.match(WORD_RE)?.length ?? 0
    if (wordCount < MIN_PARAGRAPH_WORDS) continue

    const importantTerms = getImportantTerms(text)
    if (importantTerms.size === 0) continue

    const fragment = document.createDocumentFragment()
    let lastIndex = 0
    const boldedTerms = new Set<string>()
    let touched = false
    let match: RegExpExecArray | null
    WORD_RE.lastIndex = 0

    while ((match = WORD_RE.exec(text)) !== null) {
      const word = match[0]
      const key = word.toLowerCase()
      if (!importantTerms.has(key) || boldedTerms.has(key)) continue

      if (match.index > lastIndex) {
        fragment.appendChild(document.createTextNode(text.slice(lastIndex, match.index)))
      }

      const span = document.createElement('span')
      span.className = MARKER_CLASS
      span.style.cssText = 'font-weight: 800; color: #3e236b;'
      span.textContent = word
      fragment.appendChild(span)

      touched = true
      boldedTerms.add(key)
      lastIndex = match.index + word.length
    }

    if (!touched) continue

    if (lastIndex < text.length) {
      fragment.appendChild(document.createTextNode(text.slice(lastIndex)))
    }

    textNode.replaceWith(fragment)
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
