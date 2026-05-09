import nlp from 'compromise'

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

    const doc = nlp(text)
    const sentences = (doc.sentences().out('array') as string[])
      .map((s) => s.trim())
      .filter((s) => s.length > 0)

    // Break long sentences further by clauses, but merge clauses without
    // a verb into the next one so every bullet is a complete thought.
    const bullets: string[] = []
    for (const sentence of sentences) {
      if (sentence.length > 120) {
        const clauseDocs = nlp(sentence).clauses()
        const rawClauses: { text: string; hasVerb: boolean }[] = []
        clauseDocs.forEach((c: any) => {
          rawClauses.push({
            text: c.text().trim(),
            hasVerb: c.verbs().length > 0,
          })
        })

        const merged: string[] = []
        let buffer = ''
        for (const c of rawClauses) {
          buffer = buffer ? buffer + ' ' + c.text : c.text
          if (c.hasVerb) {
            merged.push(buffer)
            buffer = ''
          }
        }
        if (buffer) {
          if (merged.length > 0) merged[merged.length - 1] += ' ' + buffer
          else merged.push(buffer)
        }

        if (merged.length > 1) {
          bullets.push(...merged)
          continue
        }
      }
      bullets.push(sentence)
    }

    if (bullets.length < 2) continue // not worth splitting

    el.setAttribute(ORIGINAL_ATTR, el.innerHTML)
    el.classList.add(MARKER_CLASS)

    const list = document.createElement('ul')
    list.style.cssText = 'list-style-type: disc; padding-left: 24px; margin: 8px 0;'

    for (const bullet of bullets) {
      const li = document.createElement('li')
      li.style.cssText = 'margin-bottom: 6px;'
      li.textContent = bullet
      list.appendChild(li)
    }

    el.innerHTML = ''
    el.appendChild(list)
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
