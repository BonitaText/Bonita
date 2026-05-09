const MARKER_CLASS = 'bonita-split'
const ORIGINAL_ATTR = 'data-bonita-original'

const BLOCKED_TAGS = new Set([
  'script', 'style', 'noscript', 'textarea', 'input',
  'code', 'pre', 'nav', 'header', 'footer', 'aside',
  'button', 'table', 'select', 'svg',
])

function shouldSkip(el: Element): boolean {
  if (el.closest('#crxjs-app, .bonita-dock, .bonita-trigger')) return true

  let cursor: Element | null = el.parentElement
  while (cursor) {
    if (BLOCKED_TAGS.has(cursor.tagName.toLowerCase())) return true
    cursor = cursor.parentElement
  }
  return false
}

export function applySentenceSplit() {
  removeSentenceSplit()

  const elements = document.querySelectorAll('p')

  for (const el of Array.from(elements)) {
    if (shouldSkip(el)) continue
    if (el.classList.contains(MARKER_CLASS)) continue

    const text = el.textContent || ''
    if (text.trim().length < 80) continue // skip short paragraphs

    const sentences = (text.match(/[^.]+\.(?=\s|$)|[^.]+$/g) ?? [])
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && /[A-Za-z0-9]/.test(s))

    if (sentences.length < 2) continue // not worth splitting

    el.setAttribute(ORIGINAL_ATTR, el.innerHTML)
    el.classList.add(MARKER_CLASS)

    const wrapper = document.createElement('span')
    wrapper.style.cssText = 'display: block; margin: 8px 0;'

    for (const sentence of sentences) {
      const line = document.createElement('span')
      line.style.cssText = 'display: block; margin-bottom: 7px;'
      line.textContent = sentence
      wrapper.appendChild(line)
    }

    el.innerHTML = ''
    el.appendChild(wrapper)
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
