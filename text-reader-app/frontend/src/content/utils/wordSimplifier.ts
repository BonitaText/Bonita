import { simpleWords } from './simpleWordList'

const MARKER_CLASS = 'bonita-simplified'
const ORIGINAL_ATTR = 'data-original'

const BLOCKED_TAGS = new Set([
  'script', 'style', 'noscript', 'textarea', 'input',
  'code', 'pre', 'nav', 'header', 'footer', 'aside',
  'button', 'table', 'select', 'svg',
])

const lookup = new Map<string, string>(
  Object.entries(simpleWords).map(([k, v]) => [k.toLowerCase(), v])
)

function shouldSkip(parent: Element | null): boolean {
  if (!parent) return true
  if (parent.closest('#crxjs-app, .bonita-dock, .bonita-trigger, .bonita-font-popup')) return true

  let cursor: Element | null = parent
  while (cursor) {
    const tag = cursor.tagName.toLowerCase()
    if (BLOCKED_TAGS.has(tag)) return true
    if (cursor.classList.contains(MARKER_CLASS)) return true
    cursor = cursor.parentElement
  }
  return false
}

function preserveCase(original: string, replacement: string): string {
  if (original.length === 0) return replacement
  if (original === original.toUpperCase() && original.length > 1) {
    return replacement.toUpperCase()
  }
  if (original[0] === original[0].toUpperCase()) {
    return replacement[0].toUpperCase() + replacement.slice(1)
  }
  return replacement
}

// Short CVC words like "stop"/"run"/"hit" double the final consonant before -ing/-ed
function shouldDoubleFinalConsonant(word: string): boolean {
  if (word.length < 3 || word.length > 5) return false
  const consonant = /[bcdfghjklmnpqrstvz]/i
  const vowel = /[aeiou]/i
  const last = word[word.length - 1]
  const second = word[word.length - 2]
  const third = word[word.length - 3]
  if (!consonant.test(last)) return false
  if (!vowel.test(second)) return false
  if (vowel.test(third)) return false
  return true
}

// Re-inflect simple base word to match the suffix pattern of original
function inflectByPattern(base: string, originalSuffix: string): string {
  if (base.includes(' ')) return base // multi-word — don't inflect
  const doubled = base + base[base.length - 1]
  switch (originalSuffix) {
    case 'ing':
      if (base.endsWith('e')) return base.slice(0, -1) + 'ing'
      if (shouldDoubleFinalConsonant(base)) return doubled + 'ing'
      return base + 'ing'
    case 'ed':
    case 'd':
      if (base.endsWith('e')) return base + 'd'
      if (shouldDoubleFinalConsonant(base)) return doubled + 'ed'
      return base + 'ed'
    case 's':
    case 'es':
      return /(s|x|z|ch|sh)$/.test(base) ? base + 'es' : base + 's'
    case 'ies':
      return base.endsWith('y') ? base.slice(0, -1) + 'ies' : base + 's'
    default:
      return base
  }
}

// Try to find a simple replacement for `word`, including suffix variations.
// Returns null if no match.
function findSimpler(word: string): string | null {
  const lower = word.toLowerCase()

  // Direct match
  const direct = lookup.get(lower)
  if (direct) return direct

  // Try stemming: if word ends with a known suffix, look up the stem
  const variations: { striplen: number; addback: string; sfx: string }[] = [
    { striplen: 3, addback: '', sfx: 'ing' },
    { striplen: 3, addback: 'e', sfx: 'ing' },
    { striplen: 3, addback: 'y', sfx: 'ies' },
    { striplen: 2, addback: '', sfx: 'ed' },
    { striplen: 2, addback: 'e', sfx: 'ed' },
    { striplen: 2, addback: '', sfx: 'es' },
    { striplen: 1, addback: '', sfx: 'd' },
    { striplen: 1, addback: '', sfx: 's' },
  ]

  for (const v of variations) {
    if (!lower.endsWith(v.sfx)) continue
    if (lower.length < v.striplen + 2) continue
    const stem = lower.slice(0, -v.striplen) + v.addback
    const baseSimple = lookup.get(stem)
    if (baseSimple) return inflectByPattern(baseSimple, v.sfx)
  }

  return null
}

const WORD_RE = /\b[a-zA-Z]+\b/g

export function applyWordSimplification() {
  removeWordSimplification()

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      if (shouldSkip(node.parentElement)) return NodeFilter.FILTER_REJECT
      if (!node.textContent) return NodeFilter.FILTER_REJECT
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

    const fragment = document.createDocumentFragment()
    let lastIndex = 0
    let touched = false
    let match: RegExpExecArray | null
    WORD_RE.lastIndex = 0

    while ((match = WORD_RE.exec(text)) !== null) {
      const original = match[0]
      const simpler = findSimpler(original)
      if (!simpler) continue

      if (match.index > lastIndex) {
        fragment.appendChild(document.createTextNode(text.slice(lastIndex, match.index)))
      }

      const cased = preserveCase(original, simpler)
      const span = document.createElement('span')
      span.className = MARKER_CLASS
      span.setAttribute(ORIGINAL_ATTR, original)
      span.style.cssText = 'background: #fff3a8; border-radius: 3px; padding: 0 2px;'
      span.title = `Original: ${original}`
      span.textContent = cased
      fragment.appendChild(span)

      touched = true
      lastIndex = match.index + original.length
    }

    if (!touched) continue

    if (lastIndex < text.length) {
      fragment.appendChild(document.createTextNode(text.slice(lastIndex)))
    }

    textNode.replaceWith(fragment)
  }
}

export function removeWordSimplification() {
  const wrappers = document.querySelectorAll(`.${MARKER_CLASS}`)
  const parents = new Set<Element>()
  wrappers.forEach((wrapper) => {
    if (wrapper.parentElement) parents.add(wrapper.parentElement)
    const original = wrapper.getAttribute(ORIGINAL_ATTR) || wrapper.textContent || ''
    wrapper.replaceWith(document.createTextNode(original))
  })
  parents.forEach((p) => p.normalize())
}
