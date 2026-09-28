/**
 * @file test/utils/contentRoot.test.ts
 *
 * Unit tests for contentRoot.ts — the shared root resolution, skip logic and
 * the two traversal patterns (walkTextNodes / collectBlockElements) used by
 * every reading-tool feature.
 *
 * DOM environment is provided by jsdom.
 *
 * ## Conventions
 *  • getContentRoot() caches its result at module level, so every test starts
 *    with invalidateContentRootCache() and an empty <body>.
 *  • collectBlockElements / walkTextNodes tests pass an explicit `root`
 *    wherever the default root isn't the thing being tested, so they don't
 *    depend on the 200-character landmark threshold.
 *  • Tests tagged [characterization] pin down current behaviour that is
 *    deliberate but easy to break by accident (see the notes on each).
 *  • Tests tagged [regression] guard a bug that is documented in the source
 *    or was found while writing this file.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  BLOCKED_TAGS,
  ALLOWED_TEXT_TAGS,
  BLOCK_TAGS,
  getContentRoot,
  invalidateContentRootCache,
  isBonitaUI,
  isCaptionOrCredit,
  hasBlockedAncestor,
  walkTextNodes,
  collectBlockElements,
  walkBlocks,
} from '../../content/utils/contentRoot'

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** `n` distinct whitespace-separated tokens: "w0 w1 w2 …". */
function words(n: number, seed = 'w'): string {
  return Array.from({ length: n }, (_, i) => `${seed}${i}`).join(' ')
}

/** A string of exactly `n` non-whitespace characters. */
function chars(n: number): string {
  return 'a'.repeat(n)
}

/** Comfortably over MIN_ROOT_CHARS (200): 80 words ≈ 310 characters. */
const LONG = words(80)

/** Appends a <div> containing `html` to <body> and returns it. */
function mount(html: string): HTMLElement {
  const div = document.createElement('div')
  div.innerHTML = html
  document.body.appendChild(div)
  return div
}

/** Appends a landmark element (e.g. 'main') containing `html` to <body>. */
function landmark(tag: string, html: string, attrs: Record<string, string> = {}): HTMLElement {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
  el.innerHTML = html
  document.body.appendChild(el)
  return el
}

/** Ids of the returned elements, for readable order assertions. */
const ids = (els: Element[]) => els.map(e => e.id)

beforeEach(() => {
  document.body.innerHTML = ''
  invalidateContentRootCache()
})

// ─────────────────────────────────────────────────────────────────────────────
// Shared tag sets
// ─────────────────────────────────────────────────────────────────────────────

describe('shared tag sets', () => {
  it('BLOCKED_TAGS contains code, chrome, tabular and media elements', () => {
    for (const tag of ['script', 'style', 'code', 'pre', 'nav', 'header', 'footer', 'aside', 'table', 'button', 'svg']) {
      expect(BLOCKED_TAGS.has(tag)).toBe(true)
    }
  })

  it('BLOCKED_TAGS does not block blockquote or figure (they are handled elsewhere)', () => {
    expect(BLOCKED_TAGS.has('blockquote')).toBe(false)
    expect(BLOCKED_TAGS.has('figure')).toBe(false)
  })

  it('BLOCK_TAGS is broader than <p> (div-based pages) and includes figcaption', () => {
    for (const tag of ['p', 'div', 'li', 'blockquote', 'section', 'article', 'figcaption']) {
      expect(BLOCK_TAGS.has(tag)).toBe(true)
    }
  })

  it('BLOCK_TAGS excludes inline elements', () => {
    for (const tag of ['a', 'span', 'em', 'strong', 'sup']) {
      expect(BLOCK_TAGS.has(tag)).toBe(false)
    }
  })

  it('ALLOWED_TEXT_TAGS covers prose containers', () => {
    for (const tag of ['p', 'li', 'h1', 'blockquote', 'div', 'span']) {
      expect(ALLOWED_TEXT_TAGS.has(tag)).toBe(true)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// getContentRoot
// ─────────────────────────────────────────────────────────────────────────────

describe('getContentRoot — selector priority', () => {
  it('prefers <main> over every other landmark', () => {
    landmark('article', LONG)
    landmark('div', LONG, { role: 'main' })
    landmark('div', LONG, { id: 'content' })
    const main = landmark('main', LONG)
    expect(getContentRoot()).toBe(main)
  })

  it('uses <article> when there is no <main>', () => {
    const article = landmark('article', LONG)
    landmark('div', LONG, { role: 'main' })
    expect(getContentRoot()).toBe(article)
  })

  it('uses [role="main"] when there is no <main> or <article>', () => {
    const el = landmark('div', LONG, { role: 'main' })
    landmark('div', LONG, { id: 'content' })
    expect(getContentRoot()).toBe(el)
  })

  it('uses #content when no semantic landmark exists', () => {
    const el = landmark('div', LONG, { id: 'content' })
    landmark('div', LONG, { class: 'content' })
    expect(getContentRoot()).toBe(el)
  })

  it('uses .content as the last selector before the body fallback', () => {
    const el = landmark('div', LONG, { class: 'content' })
    expect(getContentRoot()).toBe(el)
  })

  it('falls back to document.body when nothing matches', () => {
    mount(`<p>${LONG}</p>`)
    expect(getContentRoot()).toBe(document.body)
  })

  it('always returns an element, even on an empty page', () => {
    expect(getContentRoot()).toBe(document.body)
  })
})

describe('getContentRoot — MIN_ROOT_CHARS validation (200 chars)', () => {
  it('rejects a landmark with too little text and falls back to the body', () => {
    landmark('main', 'tiny')
    expect(getContentRoot()).toBe(document.body)
  })

  it('accepts a landmark with exactly 200 characters of text', () => {
    const main = landmark('main', chars(200))
    expect(getContentRoot()).toBe(main)
  })

  it('rejects a landmark with 199 characters of text', () => {
    landmark('main', chars(199))
    expect(getContentRoot()).toBe(document.body)
  })

  it('measures trimmed text, so surrounding whitespace does not count', () => {
    landmark('main', `      ${chars(150)}      `)
    expect(getContentRoot()).toBe(document.body)
  })

  it('skips a too-small higher-priority landmark and continues to the next selector', () => {
    landmark('main', 'tiny')
    const article = landmark('article', LONG)
    expect(getContentRoot()).toBe(article)
  })

  it('[regression] ignores a small unrelated #content widget in favour of a real .content body (SparkNotes)', () => {
    landmark('div', 'ad slot', { id: 'content' })
    const real = landmark('div', LONG, { class: 'content' })
    expect(getContentRoot()).toBe(real)
  })
})

describe('getContentRoot — caching', () => {
  it('returns the same element on repeated calls', () => {
    const main = landmark('main', LONG)
    expect(getContentRoot()).toBe(main)
    expect(getContentRoot()).toBe(main)
  })

  it('keeps returning the cached root even if a higher-priority landmark appears later', () => {
    const article = landmark('article', LONG)
    expect(getContentRoot()).toBe(article)

    landmark('main', LONG)
    expect(getContentRoot()).toBe(article)
  })

  it('invalidateContentRootCache() forces a fresh resolution', () => {
    const article = landmark('article', LONG)
    expect(getContentRoot()).toBe(article)

    const main = landmark('main', LONG)
    invalidateContentRootCache()
    expect(getContentRoot()).toBe(main)
  })

  it('self-invalidates when the cached root is removed from the document', () => {
    const article = landmark('article', LONG)
    expect(getContentRoot()).toBe(article)

    article.remove()
    const main = landmark('main', LONG)
    expect(getContentRoot()).toBe(main)
  })

  /**
   * [regression] document.body is never detached, so caching it defeats the
   * document.contains() self-check: a fallback resolved before the article
   * has rendered (SPA navigation, lazy hydration) would stick forever, and
   * every later feature would run against <body> instead of the article.
   *
   * FAILS until getContentRoot() stops caching the body fallback, i.e. the
   * final `cachedRoot = document.body` is removed and it just returns
   * document.body.
   */
  it('[regression] does not permanently cache the <body> fallback', () => {
    mount('<p>loading…</p>')
    expect(getContentRoot()).toBe(document.body)

    const main = landmark('main', LONG)
    expect(getContentRoot()).toBe(main)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// isBonitaUI
// ─────────────────────────────────────────────────────────────────────────────

describe('isBonitaUI', () => {
  it('treats null as "skip"', () => {
    expect(isBonitaUI(null)).toBe(true)
  })

  it.each([
    ['#bonita-root', '<div id="bonita-root"><p id="t">x</p></div>'],
    ['.bonita-dock', '<div class="bonita-dock"><p id="t">x</p></div>'],
    ['.bonita-trigger', '<div class="bonita-trigger"><span id="t">x</span></div>'],
    ['.bonita-font-popup', '<div class="bonita-font-popup"><span id="t">x</span></div>'],
    ['.bonita-pos-popup', '<div class="bonita-pos-popup"><span id="t">x</span></div>'],
  ])('returns true for a descendant of %s', (_label, html) => {
    mount(html)
    expect(isBonitaUI(document.getElementById('t'))).toBe(true)
  })

  it('returns true for the chrome element itself', () => {
    mount('<div id="t" class="bonita-dock"></div>')
    expect(isBonitaUI(document.getElementById('t'))).toBe(true)
  })

  it('returns false for ordinary page content', () => {
    mount('<p id="t">hello</p>')
    expect(isBonitaUI(document.getElementById('t'))).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// isCaptionOrCredit
// ─────────────────────────────────────────────────────────────────────────────

describe('isCaptionOrCredit', () => {
  it.each([
    ['inside a <figure>', '<figure><p id="t">x</p></figure>'],
    ['inside a <figcaption>', '<figure><figcaption><span id="t">x</span></figcaption></figure>'],
    ['class contains "caption"', '<p id="t" class="photo-caption">x</p>'],
    ['class contains "Caption" (case-insensitive)', '<p id="t" class="ImageCaption">x</p>'],
    ['class contains "credit"', '<p id="t" class="byline-credit">x</p>'],
    ['class contains "cutline"', '<p id="t" class="cutline">x</p>'],
    ['class contains "Carousel"', '<div id="t" class="CarouselSlide-info-content">x</div>'],
    ['class contains "carousel"', '<div id="t" class="news-carousel">x</div>'],
    ['inside .jwplayer', '<div class="jwplayer"><span id="t">x</span></div>'],
    ['aria-hidden="true"', '<div id="t" aria-hidden="true">x</div>'],
    ['inside a <form>', '<form><p id="t">x</p></form>'],
    ['inside a tabpanel', '<div role="tabpanel"><p id="t">x</p></div>'],
    ['inside a discussion post', '<div data-testid="discussion-post"><p id="t">x</p></div>'],
  ])('returns true when %s', (_label, html) => {
    mount(html)
    expect(isCaptionOrCredit(document.getElementById('t')!)).toBe(true)
  })

  it('returns false for a plain body paragraph', () => {
    mount('<p id="t">plain prose</p>')
    expect(isCaptionOrCredit(document.getElementById('t')!)).toBe(false)
  })

  it('returns false for aria-hidden="false"', () => {
    mount('<p id="t" aria-hidden="false">visible prose</p>')
    expect(isCaptionOrCredit(document.getElementById('t')!)).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// hasBlockedAncestor
// ─────────────────────────────────────────────────────────────────────────────

describe('hasBlockedAncestor', () => {
  it('returns false for null', () => {
    expect(hasBlockedAncestor(null)).toBe(false)
  })

  it.each([...BLOCKED_TAGS])('returns true for a child of <%s>', (tag) => {
    const parent = document.createElement(tag)
    const child = document.createElement('span')
    parent.appendChild(child)
    document.body.appendChild(parent)
    expect(hasBlockedAncestor(child)).toBe(true)
  })

  it.each([...BLOCKED_TAGS])('is inclusive: returns true for <%s> itself', (tag) => {
    const el = document.createElement(tag)
    document.body.appendChild(el)
    expect(hasBlockedAncestor(el)).toBe(true)
  })

  it('returns true for an element inside a widget-classed ancestor', () => {
    mount('<div class="photo-caption"><span id="t">x</span></div>')
    expect(hasBlockedAncestor(document.getElementById('t'))).toBe(true)
  })

  it('[regression] returns true for an element that is itself widget-classed, even if its parent is not', () => {
    mount('<div><p id="t" class="CarouselSlide-info-content">x</p></div>')
    expect(hasBlockedAncestor(document.getElementById('t'))).toBe(true)
  })

  it('returns false for ordinary prose', () => {
    mount('<section><p id="t">x</p></section>')
    expect(hasBlockedAncestor(document.getElementById('t'))).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// walkTextNodes (Pattern A)
// ─────────────────────────────────────────────────────────────────────────────

describe('walkTextNodes', () => {
  /** Collects the text of every visited node. */
  function collect(opts?: Parameters<typeof walkTextNodes>[1]): string[] {
    const seen: string[] = []
    walkTextNodes(n => seen.push(n.textContent ?? ''), opts)
    return seen
  }

  it('visits text nodes in document order', () => {
    const root = mount('<p>one</p><p>two</p><p>three</p>')
    expect(collect({ root })).toEqual(['one', 'two', 'three'])
  })

  it('defaults to the resolved content root', () => {
    document.body.innerHTML = `<p>outside text</p><main><p>${LONG}</p></main>`
    const seen = collect()
    expect(seen).toHaveLength(1)
    expect(seen[0].startsWith('w0')).toBe(true)
  })

  it('honours an explicit root override', () => {
    document.body.innerHTML = `<main><p>${LONG}</p></main><div id="other"><p>other text</p></div>`
    const root = document.getElementById('other')!
    expect(collect({ root })).toEqual(['other text'])
  })

  it('skips blocked tags, widget markup, aria-hidden content and Bonita UI', () => {
    const root = mount(
      '<p>keep</p>' +
      '<script>dropScript</script>' +
      '<nav><a>dropNav</a></nav>' +
      '<pre><code>dropCode</code></pre>' +
      '<p aria-hidden="true">dropHidden</p>' +
      '<div class="photo-caption">dropCaption</div>' +
      '<div class="bonita-dock"><span>dropUI</span></div>',
    )
    expect(collect({ root })).toEqual(['keep'])
  })

  it('requires an allowed prose ancestor by default', () => {
    document.body.innerHTML = '<label>plain label</label><p>para</p>'
    expect(collect({ root: document.body })).toEqual(['para'])
  })

  it('visits every non-blocked node when requireAllowedAncestor is false', () => {
    document.body.innerHTML = '<label>plain label</label><p>para</p>'
    expect(collect({ root: document.body, requireAllowedAncestor: false })).toEqual(['plain label', 'para'])
  })

  it('skips text nodes shorter than minLength (measured on trimmed text)', () => {
    const root = mount('<p>hi</p><p>long enough text</p>')
    expect(collect({ root, minLength: 5 })).toEqual(['long enough text'])
  })

  it('skips whitespace-only nodes when minLength is 1', () => {
    const root = mount('<p>   </p><p>x</p>')
    expect(collect({ root, minLength: 1 })).toEqual(['x'])
  })

  it('is safe against visitors that replace the node being visited', () => {
    const root = mount('<p>a1</p><p>b2</p><p>c3</p>')
    const seen: string[] = []

    walkTextNodes(
      (node) => {
        seen.push(node.textContent ?? '')
        const b = document.createElement('b')
        b.textContent = node.textContent
        node.replaceWith(b)
      },
      { root },
    )

    expect(seen).toEqual(['a1', 'b2', 'c3'])
    expect(root.querySelectorAll('b')).toHaveLength(3)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// collectBlockElements (Pattern B)
// ─────────────────────────────────────────────────────────────────────────────

describe('collectBlockElements — discovery', () => {
  it('finds <p> elements under the root', () => {
    const root = mount(`<p id="a">${words(10)}</p><p id="b">${words(10)}</p>`)
    expect(ids(collectBlockElements({ root }))).toEqual(['a', 'b'])
  })

  it('finds div-based paragraphs on <p>-free pages (Khan Academy)', () => {
    const root = mount(`<div><div><div id="a">${words(30)}</div></div></div>`)
    expect(ids(collectBlockElements({ root }))).toEqual(['a'])
  })

  it('includes list items, headings and figcaptions', () => {
    const root = mount(
      `<ul><li id="li">${words(5)}</li></ul>` +
      `<h2 id="h">${words(5)}</h2>` +
      `<figure><figcaption id="fc">${words(5)}</figcaption></figure>`,
    )
    expect(ids(collectBlockElements({ root }))).toEqual(['li', 'h', 'fc'])
  })

  it('returns elements in document order', () => {
    const root = mount(
      `<p id="a">${words(5)}</p>` +
      `<section><p id="b">${words(5)}</p></section>` +
      `<p id="c">${words(5)}</p>`,
    )
    expect(ids(collectBlockElements({ root }))).toEqual(['a', 'b', 'c'])
  })

  it('returns an empty array when nothing qualifies', () => {
    const root = mount('<span>inline only</span>')
    expect(collectBlockElements({ root })).toEqual([])
  })

  it('defaults to the resolved content root', () => {
    document.body.innerHTML = `<p id="outside">${words(30, 'o')}</p><main><p id="inside">${LONG}</p></main>`
    expect(ids(collectBlockElements())).toEqual(['inside'])
  })

  it('falls back to searching the whole body when no landmark qualifies', () => {
    document.body.innerHTML = `<p id="a">${words(30)}</p>`
    expect(ids(collectBlockElements())).toEqual(['a'])
  })

  it('honours an explicit root and ignores blocks outside it', () => {
    document.body.innerHTML = `<div id="r"><p id="in">${words(10)}</p></div><p id="out">${words(10)}</p>`
    const root = document.getElementById('r')!
    expect(ids(collectBlockElements({ root }))).toEqual(['in'])
  })
})

describe('collectBlockElements — minWords', () => {
  it('excludes blocks below the word floor', () => {
    const root = mount(`<p id="short">${words(5)}</p><p id="long">${words(30)}</p>`)
    expect(ids(collectBlockElements({ root, minWords: 20 }))).toEqual(['long'])
  })

  it('includes a block with exactly minWords words', () => {
    const root = mount(`<p id="a">${words(20)}</p>`)
    expect(ids(collectBlockElements({ root, minWords: 20 }))).toEqual(['a'])
  })

  it('excludes a block with minWords - 1 words', () => {
    const root = mount(`<p id="a">${words(19)}</p>`)
    expect(collectBlockElements({ root, minWords: 20 })).toEqual([])
  })

  it('applies no floor by default', () => {
    const root = mount('<p id="a">tiny</p>')
    expect(ids(collectBlockElements({ root }))).toEqual(['a'])
  })

  /**
   * [characterization] The word floor is applied BEFORE nesting dedup. A
   * wrapper whose combined text clears the floor therefore survives as the
   * "innermost" candidate when each of its children individually falls below
   * it. Change the order of those two steps and this test will tell you.
   */
  it('[characterization] a wrapper survives when only its combined text clears minWords', () => {
    const root = mount(
      `<div id="wrap"><p id="a">${words(10)}</p><p id="b">${words(10, 'x')}</p></div>`,
    )
    expect(ids(collectBlockElements({ root, minWords: 15 }))).toEqual(['wrap'])
  })
})

describe('collectBlockElements — nesting dedup (innermost wins)', () => {
  it('drops a <div> that wraps a <p>, keeping the <p>', () => {
    const root = mount(`<div id="outer"><p id="inner">${words(10)}</p></div>`)
    expect(ids(collectBlockElements({ root }))).toEqual(['inner'])
  })

  it('keeps only the innermost block of a 3-deep wrapper chain', () => {
    const root = mount(
      `<div id="a"><div id="b"><div id="c">${words(30)}</div></div></div>`,
    )
    expect(ids(collectBlockElements({ root }))).toEqual(['c'])
  })

  it('[regression] drops the container, not the content (inverted-direction bug)', () => {
    const root = mount(
      `<div id="a"><div id="b"><p id="c">${words(10)}</p></div></div>`,
    )
    const result = ids(collectBlockElements({ root }))
    expect(result).toEqual(['c'])
    expect(result).not.toContain('a')
  })

  it('[regression] sees through inline wrappers between two blocks (AP News span gap)', () => {
    const root = mount(
      `<div id="outer"><span><span><p id="inner">${words(10)}</p></span></span></div>`,
    )
    expect(ids(collectBlockElements({ root }))).toEqual(['inner'])
  })

  it('keeps every sibling paragraph and drops their shared container', () => {
    const root = mount(
      `<div id="wrap"><p id="a">${words(10)}</p><p id="b">${words(10, 'x')}</p></div>`,
    )
    expect(ids(collectBlockElements({ root }))).toEqual(['a', 'b'])
  })

  it('treats a <blockquote> as a container of its inner <p>', () => {
    const root = mount(`<blockquote id="bq"><p id="p">${words(10)}</p></blockquote>`)
    expect(ids(collectBlockElements({ root }))).toEqual(['p'])
  })

  /**
   * [characterization] A wrapper's OWN text (text nodes that sit directly in
   * the container next to a nested block) is not returned as a block: the
   * wrapper is discarded and only the nested block survives.
   */
  it('[characterization] a wrapper is dropped even when it has its own text next to a nested block', () => {
    const root = mount(
      `<div id="wrap">Lead-in text before the paragraph. <p id="p">${words(10)}</p></div>`,
    )
    expect(ids(collectBlockElements({ root }))).toEqual(['p'])
  })
})

describe('collectBlockElements — exclusions', () => {
  it.each([
    ['<nav>', `<nav><p>${words(10)}</p></nav>`],
    ['<aside>', `<aside><p>${words(10)}</p></aside>`],
    ['<header>', `<header><p>${words(10)}</p></header>`],
    ['<footer>', `<footer><p>${words(10)}</p></footer>`],
    ['<pre>', `<pre><div>${words(10)}</div></pre>`],
    ['<table>', `<table><tbody><tr><td>${words(10)}</td></tr></tbody></table>`],
    ['<form>', `<form><p>${words(10)}</p></form>`],
  ])('excludes blocks inside %s', (_label, html) => {
    const root = mount(html)
    expect(collectBlockElements({ root })).toEqual([])
  })

  it('excludes Bonita UI chrome', () => {
    const root = mount(
      `<div class="bonita-dock"><p>${words(10)}</p></div>` +
      `<div id="bonita-root"><p>${words(10)}</p></div>`,
    )
    expect(collectBlockElements({ root })).toEqual([])
  })

  it('excludes aria-hidden blocks (inactive carousel slides)', () => {
    const root = mount(
      `<div aria-hidden="true">${words(10)}</div>` +
      `<p id="real">${words(10)}</p>`,
    )
    expect(ids(collectBlockElements({ root }))).toEqual(['real'])
  })

  it('[regression] excludes a block that is itself widget-classed, checked on the element and not its parent', () => {
    const root = mount(`<div class="CarouselSlide-info-content">${words(30)}</div>`)
    expect(collectBlockElements({ root })).toEqual([])
  })

  it('[regression] excludes a widget-classed <p> even when its parent carries no widget class', () => {
    const root = mount(
      `<div id="wrap">` +
        `<p id="real">${words(10)}</p>` +
        `<p id="cap" class="photo-caption">${words(10, 'c')}</p>` +
      `</div>`,
    )
    expect(ids(collectBlockElements({ root }))).toEqual(['real'])
  })

  /**
   * [characterization] collectBlockElements does NOT filter <figure>/
   * <figcaption> (annotation features are allowed to touch captions);
   * callers that read meaning from a paragraph must additionally check
   * isCaptionOrCredit.
   */
  it('[characterization] returns a <figcaption>, which isCaptionOrCredit then flags', () => {
    const root = mount(`<figure><figcaption id="fc">${words(10)}</figcaption></figure>`)
    const result = collectBlockElements({ root })
    expect(ids(result)).toEqual(['fc'])
    expect(isCaptionOrCredit(result[0])).toBe(true)
  })

  /**
   * [characterization] A block excluded as a widget does not stop its parent
   * from qualifying as a block in its own right. When the parent's other
   * children are not blocks, the parent is returned and includes the
   * widget's text. Callers relying on caption exclusion should combine
   * this with isCaptionOrCredit on the returned element.
   */
  it('[characterization] a parent whose only block child is excluded becomes the block itself', () => {
    const root = mount(
      `<div id="wrap"><p class="photo-caption">${words(10)}</p></div>`,
    )
    expect(ids(collectBlockElements({ root }))).toEqual(['wrap'])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// walkBlocks
// ─────────────────────────────────────────────────────────────────────────────

describe('walkBlocks', () => {
  it('invokes the visitor once per block, in document order', () => {
    const root = mount(`<p id="a">${words(5)}</p><p id="b">${words(5)}</p><p id="c">${words(5)}</p>`)
    const visit = vi.fn()

    walkBlocks(visit, { root })

    expect(visit).toHaveBeenCalledTimes(3)
    expect(visit.mock.calls.map(([el]) => (el as Element).id)).toEqual(['a', 'b', 'c'])
  })

  it('visits exactly the elements collectBlockElements returns', () => {
    const root = mount(`<div><p id="a">${words(30)}</p></div><p id="b">${words(5)}</p>`)
    const opts = { root, minWords: 20 }
    const visited: Element[] = []

    walkBlocks(el => visited.push(el), opts)

    expect(visited).toEqual(collectBlockElements(opts))
    expect(ids(visited)).toEqual(['a'])
  })

  it('does not call the visitor when there are no blocks', () => {
    const root = mount('<span>inline</span>')
    const visit = vi.fn()
    walkBlocks(visit, { root })
    expect(visit).not.toHaveBeenCalled()
  })
})