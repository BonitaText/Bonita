/**
 * @file utils/contentRoot.ts
 *
 * Single source of truth for how every reading-tool feature finds *where*
 * on the page to operate and *how* to walk that region.
 *
 * ## Why this file exists
 * Every feature used to carry its own copy of `getContentRoot()`,
 * `BLOCKED_TAGS`, and a hand-rolled `TreeWalker`. That duplication is what
 * caused two classes of silent bugs:
 *
 * 1. **Root-resolution bugs** (e.g. SparkNotes) — `getContentRoot()`
 *    matched an unrelated `#content`/`.content` element that happened to
 *    exist elsewhere on the page, starving every feature scoped to it of
 *    real article text. Nothing threw; the features just had nothing to do.
 * 2. **Block-discovery bugs** (e.g. Khan Academy) — features that needed
 *    "paragraph-shaped" containers (`querySelectorAll('p')`, or a bespoke
 *    "div with no block children" heuristic) found zero candidates on
 *    heavily componentized, `<p>`-free pages, and again exited silently.
 *
 * Consolidating root resolution and both traversal shapes here means a fix
 * to either bug class lands once, for every feature that uses it, instead
 * of being independently rediscovered and independently patched per file.
 *
 * A closely related third bug class — **source-mismatch bugs** — happens
 * when one feature scores/collects paragraphs from one traversal (e.g. a
 * `<p>`-only scrape) and a *different* feature later tries to act on those
 * same paragraphs via a broader traversal (this file's `BLOCK_TAGS`) by
 * text-matching between the two. On `<p>`-free pages the first traversal
 * finds nothing, so the match always fails even though the second
 * traversal would have found the right elements on its own. This isn't a
 * bug in this file, but it's the reason every feature should call
 * {@link collectBlockElements} / {@link walkTextNodes} directly to find
 * *and* act on the same elements, rather than collecting paragraphs one way
 * and re-finding them another way later. See `sentenceSplitter.ts` for the
 * feature this previously bit.
 *
 * A fourth bug class — **inline-wrapper dedup gaps** — happens when a
 * "paragraph" is nested inside another candidate block through a purely
 * inline element (`<span>`, `<a>`, etc.) rather than directly. See
 * {@link collectBlockElements}'s doc comment for the concrete case
 * (AP News's `.CarouselSlide-info-content` div) and how it's handled now.
 *
 * A fifth bug class — **stale body-fallback caching** — happens when
 * {@link getContentRoot} is first called before the article has rendered
 * (SPA navigation, lazy hydration), resolves to `document.body`, and then
 * keeps returning `document.body` forever because `document.body` is never
 * detached and so never trips the `document.contains()` self-check. See
 * {@link getContentRoot} for how the fallback is cached now.
 *
 * ## Two traversal patterns
 * Every reading-tool feature falls into one of two shapes. Pick whichever
 * matches what the feature actually does to the DOM — do not force one
 * pattern to imitate the other.
 *
 * - **Pattern A — {@link walkTextNodes}** (flat text-node walk). For
 *   features that annotate or wrap individual words/phrases *in place*
 *   without needing to know which paragraph a word belongs to, and without
 *   restructuring any element's children. Used by POS highlighting, word
 *   underlines, and the span-insertion step of phrase bolding.
 *
 * - **Pattern B — {@link walkBlocks}** / {@link collectBlockElements}
 *   (block-container walk). For features that need a paragraph-shaped
 *   *unit* — either because they replace that unit's contents wholesale
 *   (sentence splitting) or because they score/rank text within it before
 *   deciding what to annotate (phrase bolding's per-paragraph ranking).
 *
 * Some features are legitimately a hybrid of both (phrase bolding: Pattern B
 * to find and rank paragraphs, Pattern A nested inside each paragraph to
 * insert spans). That's expected — the primitives compose.
 *
 * **Important for anything that writes its own traversal inside a Pattern B
 * block** (as `sentenceSplitter.ts`'s `buildNormMap` does, with a bespoke
 * `TreeWalker` instead of going through {@link walkTextNodes}): Pattern B's
 * block-level checks are a *coarse* gate — they decide whether a block as a
 * whole is in-bounds, not whether every text node inside it is safe to
 * touch. A block can legitimately contain a nested widget/caption/credit
 * fragment that individually deserves exclusion even though the outer block
 * passed. {@link walkTextNodes} already re-applies {@link hasBlockedAncestor}
 * per text node for exactly this reason. Any custom walker built inside a
 * Pattern B block should do the same — {@link hasBlockedAncestor} is
 * exported for this purpose — rather than trusting the outer block-level
 * check alone.
 *
 * ## Adding a new feature
 * Ask: "does this feature own/replace a container's contents, or score
 * text per-paragraph?" → use Pattern B. "Does it just wrap or transform
 * individual words/spans without touching sibling structure?" → use
 * Pattern A. Either way, resolve the operating region via
 * {@link getContentRoot} (or accept an explicit `root` override, as
 * phrase bolding does when re-walking inside a single already-found block)
 * rather than writing a new selector list. And prefer collecting the
 * elements you're going to act on directly over collecting text
 * separately and re-finding the elements later by matching it — see the
 * source-mismatch note above.
 */

// ─── Shared tag sets ────────────────────────────────────────────────────────

/**
 * Elements whose entire subtree must never be touched by any reading-tool
 * feature: interactive controls, code/script content, structural chrome,
 * tabular data, and media. Checked via {@link hasBlockedAncestor}.
 */
export const BLOCKED_TAGS = new Set([
  'script', 'style', 'noscript', 'textarea', 'input',
  'code', 'pre', 'nav', 'header', 'footer', 'aside',
  'button', 'table', 'select', 'svg',
])

/**
 * Tags considered valid prose containers for Pattern A's default ancestor
 * check. A text node must have at least one of these as an ancestor (and no
 * {@link BLOCKED_TAGS} ancestor) to be visited by {@link walkTextNodes}
 * with `requireAllowedAncestor` at its default of `true`.
 */
export const ALLOWED_TEXT_TAGS = new Set([
  'p', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'blockquote', 'article', 'main', 'section', 'div', 'span',
])

/**
 * Tags treated as "paragraph-shaped" by Pattern B. Deliberately broader
 * than `<p>` alone — this is what fixes the Khan-Academy-style failure
 * mode where body copy is div-based with no `<p>` tags at all. Excludes
 * inline elements (`<a>`, `<em>`, `<sup>`, …) by design, since those never
 * contain a full standalone sentence/paragraph on their own.
 */
export const BLOCK_TAGS = new Set([
  'p', 'div', 'li', 'td', 'th', 'blockquote', 'section',
  'article', 'main', 'header', 'footer', 'aside',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'dt', 'dd', 'figcaption',
])

// Pre-joined CSS selector strings for the sets above. Built once at module
// load rather than on every call — `hasBlockedAncestor` and
// `collectBlockElements` can run thousands of times per page (once per
// candidate element), and `[...set].join(',')` was previously rebuilt from
// scratch every single call, which shows up as real, avoidable latency on
// large/heavily-componentized pages (Khan Academy, SparkNotes, etc.).
const BLOCKED_SELECTOR = [...BLOCKED_TAGS].join(',')
const ALLOWED_TEXT_SELECTOR = [...ALLOWED_TEXT_TAGS].join(',')
const BLOCK_SELECTOR = [...BLOCK_TAGS].join(',')

/**
 * Class-name / attribute patterns that mark an element as "not article
 * body prose" even though it's a plain <div> — captions, credit lines,
 * carousels, video-player chrome, share bars, and comment/discussion
 * threads. None of these are catchable by tag name alone.
 *
 * `[aria-hidden="true"]` is included deliberately, not just the
 * `Carousel`/`carousel` class patterns: carousel/slider libraries (AP
 * News's Flickity-based photo/video carousel is the motivating case) mark
 * every *inactive* slide `aria-hidden="true"`, and that attribute is a far
 * more robust "this isn't visible/primary content" signal than any class
 * name — it still works if a different carousel library uses `Slider-`,
 * `Swiper-`, or no recognizable prefix at all. Prose content should never
 * legitimately be `aria-hidden`, so this has no real false-positive risk.
 */
const WIDGET_SELECTOR = [
  '[class*="caption" i]', '[class*="credit" i]', '[class*="cutline" i]',
  '[class*="Carousel"]', '[class*="carousel"]',
  '.jwplayer', '[class*="jw-"]',
  '.Page-actions', '.ActionBar', '[class*="ActionLink"]',
  '[class*="ReadMore"]',
  'template', 'bsp-carousel-read-more', 'bsp-jw-data-store',
  '[data-slidenumber]', '[data-openoverlay]',
  '[aria-hidden="true"]',
  '[data-testid="discussion-post"]', '[data-testid="discussion-list-item"]',
  '[role="tabpanel"]', '[class*="Page-byline"]', '[class*="Enhancement-item"]','[class*="ref-list js-splitview-ref-list"]','[class="graphic-wrap"]', 
  'textarea', 'form'
].join(',')

/**
 * Minimum character count a `getContentRoot()` selector match must contain
 * (via `textContent`) to be trusted as the real article body. Guards
 * against selector collisions with unrelated small elements that happen to
 * share a common id/class like `#content` or `.content` (e.g. a widget or
 * single ad slot), which is what caused every content-root-scoped feature
 * to silently find nothing on SparkNotes.
 */
const MIN_ROOT_CHARS = 200

// ─── Root resolution ────────────────────────────────────────────────────────

/**
 * Landmark selectors tried by {@link getContentRoot}, in priority order.
 * First match that also clears {@link MIN_ROOT_CHARS} wins.
 */
const ROOT_SELECTORS = ['main', 'article', '[role="main"]', '#content', '.content']

/**
 * All of {@link ROOT_SELECTORS} joined into one selector, so a single native
 * `querySelector` can answer "does *any* landmark candidate exist right now?"
 * without running the per-selector resolution loop or reading `textContent`.
 * Used only to cheaply revalidate a cached `<body>` fallback.
 */
const ROOT_PROBE = ROOT_SELECTORS.join(',')

/** Cached result of the last {@link getContentRoot} resolution. */
let cachedRoot: Element | null = null

/**
 * `true` when {@link cachedRoot} is the `document.body` *fallback* rather
 * than a validated landmark. A fallback cache entry is only trustworthy
 * while the DOM hasn't changed in a way that could produce a landmark, so
 * it is revalidated on demand (see {@link getContentRoot}); a landmark
 * entry is validated by `document.contains()` alone.
 */
let cachedIsFallback = false

/**
 * `true` when the DOM has (potentially) changed since the cached `<body>`
 * fallback was last confirmed. Only meaningful while
 * {@link cachedIsFallback} is `true`; reset whenever the observer is
 * (re)started or stopped.
 */
let fallbackDirty = false

/**
 * Watches the document for changes that could turn a landmark candidate
 * into a valid content root, but only while the `<body>` fallback is
 * cached. Its callback merely raises {@link fallbackDirty}; the real work
 * happens lazily on the next {@link getContentRoot} call, which also drains
 * pending records synchronously via `takeRecords()` so it never depends on
 * microtask timing.
 */
let fallbackObserver: MutationObserver | null = null

/**
 * Starts (or restarts) watching the document for changes relevant to
 * landmark resolution. Observed changes:
 *  - `childList` / `subtree`: a landmark element was added.
 *  - `characterData`: a too-small candidate's text may have grown past
 *    {@link MIN_ROOT_CHARS}.
 *  - `attributes` (`id`, `class`, `role` only): an existing element may have
 *    become a candidate (`#content`, `.content`, `[role="main"]`).
 *
 * Any records queued before this call are discarded, since the caller has
 * just performed a full resolution that already reflects the current DOM.
 */
function watchForLandmarks(): void {
  fallbackObserver ??= new MutationObserver(() => { fallbackDirty = true })
  fallbackObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['id', 'class', 'role'],
  })
  fallbackObserver.takeRecords()
  fallbackDirty = false
}

/**
 * Stops watching and discards any queued mutation records. Called when a
 * real landmark is cached (a landmark entry never needs the observer) and
 * when the cache is explicitly invalidated.
 */
function stopWatchingForLandmarks(): void {
  fallbackObserver?.disconnect() // also discards queued records
  fallbackDirty = false
}

/**
 * Resolves the best-guess content root for the current page.
 *
 * Tries semantic/landmark selectors in priority order, but — unlike the
 * naive version every feature used to implement independently — validates
 * each candidate against {@link MIN_ROOT_CHARS} before accepting it. A
 * selector match that resolves to a small, unrelated element (a sidebar
 * widget, a single ad slot, an empty landmark) is rejected and the search
 * continues, falling back to `document.body` if nothing qualifies.
 *
 * The result is cached across calls within the same page — resolving the
 * root re-runs `querySelector` and a `textContent` length check per
 * candidate selector, and this is called by nearly every reading-tool
 * feature on every analysis pass, so re-resolving from scratch each time
 * was pure waste on pages where the DOM isn't changing shape between
 * calls.
 *
 * **Landmark entries** are validated with `document.contains()` on every
 * read, so the cache self-invalidates if the cached element gets removed
 * (e.g. an SPA route change tears down and rebuilds the root). A landmark
 * entry is otherwise returned as-is: a higher-priority landmark appearing
 * later does not displace it.
 *
 * **The `<body>` fallback is cached too, but revalidated.** `document.body`
 * is never detached, so `document.contains()` can never invalidate it; a
 * fallback resolved before the article has rendered (SPA navigation, lazy
 * hydration) would otherwise stick forever and every feature would run
 * against `<body>` instead of the article. While the fallback is cached, a
 * `MutationObserver` records whether the DOM has changed in a way that
 * could produce a landmark (see {@link watchForLandmarks}). On each call:
 *  1. pending mutation records are drained synchronously with
 *     `takeRecords()` (so same-tick changes are seen immediately);
 *  2. if nothing changed since the fallback was last confirmed, the cached
 *     `<body>` is returned with **zero DOM queries**;
 *  3. if something changed, a single combined `querySelector`
 *     ({@link ROOT_PROBE}) checks whether any landmark candidate exists at
 *     all — if none, the cached `<body>` is still correct and returned;
 *     otherwise the full resolution below runs.
 *
 * The observer only runs while the fallback is cached and is disconnected
 * as soon as a real landmark resolves, so well-structured pages pay nothing
 * for it.
 *
 * Call {@link invalidateContentRootCache} explicitly before a fresh analysis
 * pass if you know the page content changed but the old root element is
 * still attached (e.g. its content was replaced in place) — the
 * `document.contains()` self-check only catches the case where the old
 * root was removed entirely.
 *
 * This is the single point of truth for "where is the article" — every
 * feature should call this (or accept an explicit `root` override) rather
 * than maintaining its own selector list.
 *
 * @returns The resolved root element. Always returns *something* —
 *   `document.body` in the worst case — so callers never need to null-check.
 */
export function getContentRoot(): Element {
  if (cachedRoot && document.contains(cachedRoot)) {
    // Landmark entry: contains() is the only validation it needs.
    if (!cachedIsFallback) return cachedRoot

    // Body-fallback entry: contains() is always true for <body>, so ask the
    // observer whether anything has changed. takeRecords() is synchronous and
    // returns mutations the observer callback hasn't been handed yet.
    if (!fallbackObserver || fallbackObserver.takeRecords().length) {
      fallbackDirty = true
    }
    if (!fallbackDirty) return cachedRoot // DOM quiet: zero queries

    // Something changed. One combined query tells us whether a landmark
    // candidate exists at all; if not, the fallback is still correct.
    fallbackDirty = false
    if (!document.querySelector(ROOT_PROBE)) return cachedRoot
  }

  for (const sel of ROOT_SELECTORS) {
    const el = document.querySelector(sel)
    if (el && (el.textContent ?? '').trim().length >= MIN_ROOT_CHARS) {
      cachedRoot = el
      cachedIsFallback = false
      stopWatchingForLandmarks()
      return el
    }
  }

  cachedRoot = document.body
  cachedIsFallback = true
  watchForLandmarks()
  return document.body
}

/**
 * Clears the cached {@link getContentRoot} result, forcing the next call to
 * re-resolve from scratch. Call this before a fresh analysis pass if the
 * page's content was replaced in place (same root element, new children) —
 * the `document.contains()` self-check in {@link getContentRoot} only
 * catches the case where the old root was removed entirely.
 *
 * Also resets the `<body>`-fallback bookkeeping and disconnects the
 * fallback mutation observer (it is restarted on the next call if that call
 * resolves to the fallback again).
 */
export function invalidateContentRootCache(): void {
  cachedRoot = null
  cachedIsFallback = false
  stopWatchingForLandmarks()
}

// ─── Shared skip logic ──────────────────────────────────────────────────────

/**
 * Returns `true` if `el` is inside the extension's own UI chrome (the
 * dock, trigger button, font popup, POS popup, etc.) and must never be
 * treated as page content.
 *
 * @param el - Element to test, or `null` (treated as "skip").
 */
export function isBonitaUI(el: Element | null): boolean {
  if (!el) return true
  return !!el.closest(
    '#bonita-root, .bonita-dock, .bonita-trigger, .bonita-font-popup, .bonita-pos-popup',
  )
}

/**
 * Returns `true` when `el` sits inside a `<figure>` — i.e. it's an image
 * caption or photo credit line, not independent body prose.
 *
 * Deliberately **not** part of {@link BLOCKED_TAGS}: annotation-only
 * features (phrase bolding, word underlines) are still fine painting spans
 * onto a caption's text — a reader does read captions, and a complex word
 * inside one is still worth flagging. What's wrong is treating a caption as
 * its own independent *paragraph* to score, rank, or restructure —
 * `figcaption` stayed in {@link BLOCK_TAGS} for that reason (a caption is
 * genuinely block-shaped), but features that read semantic meaning *from*
 * a whole paragraph (keyword extraction's candidate list, sentence
 * splitting's split/no-split decision) should skip it. Concretely: this is
 * what stops a wire-photo credit line ("AP Photo/John Smith") from being
 * scored as a dense paragraph and split into its own bullet list, or
 * treated as one of the page's representative paragraphs for keyword
 * extraction.
 *
 * @param el - Candidate block element.
 */
export function isCaptionOrCredit(el: Element): boolean {
  if (el.closest('figure, figcaption')) return true
  return !!el.closest(WIDGET_SELECTOR)
}


/**
 * Returns `true` if `el` (or any ancestor, **inclusive of `el` itself**)
 * has a tag name in {@link BLOCKED_TAGS} or matches {@link WIDGET_SELECTOR}.
 *
 * Implemented with the native `Element.closest()` against pre-joined
 * selectors rather than a hand-rolled `while (cursor) { cursor =
 * cursor.parentElement }` loop. `closest()` is implemented natively in the
 * browser and is substantially faster than walking the ancestor chain in
 * JS one tag-name comparison at a time — this function runs once per
 * candidate element across every feature in this file, so on large pages
 * the difference is real, measurable latency rather than a micro-optimization.
 *
 * `closest()` starts its match check at `el` itself, not at its parent —
 * callers must pass the actual element they're deciding about, not
 * `el.parentElement`. An earlier version of {@link collectBlockElements}
 * passed `el.parentElement` here, which meant a block element that was
 * *itself* widget-classed — e.g. a `.CarouselSlide-info-content` div, a
 * `.ReadMore` toggle, a caption `<p>` — slipped through whenever its
 * immediate parent happened not to repeat that class. That's what let
 * reading-tool features reach into AP News's photo/video carousel markup
 * and corrupt it. `collectBlockElements` now correctly passes `el` itself.
 *
 * Exported (not just used internally) so that features which build their
 * own bespoke traversal *inside* an already-selected Pattern B block —
 * `sentenceSplitter.ts`'s `buildNormMap`, for instance, which walks with a
 * raw `TreeWalker` rather than going through {@link walkTextNodes} — can
 * apply the same per-text-node exclusion that {@link walkTextNodes} gets
 * for free. Without that, a block-level check that lets a container through
 * (or that a nested-candidate/dedup edge case slips past) leaves every text
 * node inside it, including nested widget fragments, completely unfiltered
 * during that custom walk.
 *
 * @param el - Element to test (checked inclusively, then its ancestors).
 */
export function hasBlockedAncestor(el: Element | null): boolean {
  if (!el) return false
  return !!(el.closest(BLOCKED_SELECTOR) || el.closest(WIDGET_SELECTOR))
}

// ─── Pattern A: flat text-node walk ─────────────────────────────────────────

/**
 * Options for {@link walkTextNodes}.
 */
export interface WalkTextNodesOptions {
  /**
   * Region to walk. Defaults to {@link getContentRoot}. Pass an explicit
   * element to scope the walk to a single already-found block — e.g.
   * phrase bolding re-walking inside one paragraph after ranking terms
   * within it.
   */
  root?: Element
  /**
   * Minimum trimmed `textContent` length for a text node to be visited.
   * Use this to filter out short labels/button text that would otherwise
   * generate noisy matches. Defaults to `0` (no minimum).
   */
  minLength?: number
  /**
   * When `true` (default), a text node is only visited if it has an
   * {@link ALLOWED_TEXT_TAGS} ancestor. Set to `false` for features that
   * intentionally want every non-blocked text node regardless of
   * container semantics.
   */
  requireAllowedAncestor?: boolean
}

/**
 * Walks every eligible text node under `opts.root` (default: the resolved
 * content root) and invokes `visit` for each one, in document order.
 *
 * This is Pattern A: use it for features that annotate or transform
 * individual words/spans *in place*, without restructuring the DOM or
 * needing paragraph-level context. Skips {@link BLOCKED_TAGS} subtrees and
 * the extension's own UI chrome automatically.
 *
 * Text nodes are collected into an array before any `visit` call so that
 * mutations performed by `visit` (e.g. replacing a node with a fragment)
 * never interfere with the walk itself — the same defensive pattern the
 * original per-feature implementations used.
 *
 * @param visit - Callback invoked once per eligible text node.
 * @param opts  - See {@link WalkTextNodesOptions}.
 */
export function walkTextNodes(
  visit: (node: Text) => void,
  opts: WalkTextNodesOptions = {},
): void {
  const root = opts.root ?? getContentRoot()
  const minLength = opts.minLength ?? 0
  const requireAllowed = opts.requireAllowedAncestor ?? true

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = (node as Text).parentElement
      if (isBonitaUI(parent) || hasBlockedAncestor(parent)) {
        return NodeFilter.FILTER_REJECT
      }
      if (requireAllowed && !parent?.closest(ALLOWED_TEXT_SELECTOR)) {
        return NodeFilter.FILTER_REJECT
      }
      if ((node.textContent ?? '').trim().length < minLength) {
        return NodeFilter.FILTER_REJECT
      }
      return NodeFilter.FILTER_ACCEPT
    },
  })

  const nodes: Text[] = []
  let n: Node | null
  while ((n = walker.nextNode())) nodes.push(n as Text)
  for (const node of nodes) visit(node)
}

// ─── Pattern B: block-container walk ────────────────────────────────────────

/**
 * Options for {@link collectBlockElements} and {@link walkBlocks}.
 */
export interface WalkBlocksOptions {
  /**
   * Region to search within. Defaults to {@link getContentRoot}.
   */
  root?: Element
  /**
   * Minimum word count (via `textContent`) a candidate block must contain
   * to be included. Use this the way `sentenceSplitter`'s original div/
   * section fallback did — e.g. `65` — to avoid treating short layout
   * divs as paragraphs. Defaults to `0` (no minimum).
   */
  minWords?: number
}

/**
 * Finds every "paragraph-shaped" element under `opts.root`.
 *
 * Deliberately matches the broad {@link BLOCK_TAGS} set rather than `<p>`
 * alone — this is what fixes the Khan-Academy-class bug where body copy is
 * entirely div-based with no `<p>` tags.
 *
 * Each candidate is excluded via {@link hasBlockedAncestor} called on
 * **the candidate itself**, not its parent. This matters for widget markup
 * like AP News's photo/video carousel: `.CarouselSlide-info-content`,
 * `.ReadMore` toggles, and caption `<p>` tags are block-shaped divs/
 * paragraphs that would otherwise pass every other check, and their *own*
 * class is what marks them as non-prose — checking only the parent's
 * ancestor chain (an earlier bug here) missed exactly this case whenever
 * the immediate parent didn't happen to repeat the widget class.
 *
 * To avoid double-counting nested containers (e.g. `<div><p>…</p></div>`,
 * or Khan Academy's Perseus renderer, which wraps every real paragraph in
 * several layers of plain `<div>`), a candidate is dropped if **any other
 * candidate is nested anywhere inside it**, at any depth, through any kind
 * of wrapper (inline or block) — only the innermost text-bearing candidate
 * in a nesting chain survives. This is checked against the candidate set
 * (post-filtering), not against direct children and not against raw
 * {@link BLOCK_TAGS} membership. That distinction matters concretely:
 *
 * ```html
 * <div class="CarouselSlide-info-content">
 *   <span class="CarouselSlide-slideCount">1 of 7</span>
 *   <span class="CarouselSlide-infoDescription">
 *     <p>The move came after…</p>
 *   </span>
 * </div>
 * ```
 *
 * An earlier version of this dedup only inspected an element's *direct*
 * children for a {@link BLOCK_TAGS} member. `<span>` isn't in
 * `BLOCK_TAGS`, so it was invisible to that check — the outer `div`'s
 * direct children are both `<span>`s, so the div was (wrongly) treated as
 * "innermost" and returned as its own candidate, *in addition to* the
 * nested `<p>` two levels down (which independently qualified too, for
 * the same reason). Any inline wrapper (`<span>`, `<a>`, `<em>`, …)
 * between two block elements defeated the old dedup the same way.
 *
 * @known-issue-fixed An intermediate version of this dedup walked the
 *   check in the wrong direction: it walked *up* from each candidate and
 *   dropped it if an *ancestor* was also a candidate. For a nesting chain
 *   `A > B > C` where all three independently qualify — e.g. Khan
 *   Academy's stacked Perseus wrapper divs, whose concatenated text easily
 *   clears the word-count floor even though each is just a container for
 *   several real paragraphs — that inverted check keeps `A` (nothing above
 *   it qualifies) and drops `B` and `C`, the opposite of "innermost wins."
 *   The effect was severe: whole containers full of unrelated paragraphs,
 *   headers, and figures got treated as one splittable/scorable block, and
 *   on AP News the caption's containing widget div (which also held the
 *   byline) got kept instead of the caption `<p>` itself, pulling the
 *   author name into the split. The version below walks the check in the
 *   correct direction: for each candidate, walk *up* its ancestor chain and
 *   mark any ancestor found in the candidate set as a *container* — i.e.
 *   something to discard — while the original inner candidate itself is
 *   left untouched. This prunes wrapping containers, not their contents,
 *   which is what "only the innermost survives" actually requires.
 *
 * This double-candidacy was also the root cause of a caption-corruption
 * bug in `sentenceSplitter.ts`: with both the outer div and the inner
 * `<p>` in the result set, a bespoke internal traversal that only trusted
 * the *outer* block being caption-classified — but that itself relied on
 * this function's filtering — could still process text spanning both
 * nested candidates inconsistently. Returning exactly one, innermost
 * element per nesting chain removes that ambiguity at the source.
 *
 * **This is the canonical list of "paragraphs" on the page.** Any feature
 * that needs to score or rank paragraph text and then later act on those
 * same paragraphs should call this once and keep the `Element` references,
 * rather than collecting text separately (e.g. a `<p>`-only scrape) and
 * re-finding the elements afterward by text-matching — that split is what
 * caused `sentenceSplitter.ts` to silently do nothing on `<p>`-free pages
 * even after this function itself was fixed to look beyond `<p>`.
 *
 * @param opts - See {@link WalkBlocksOptions}.
 * @returns Array of block elements, in document order. May be empty.
 */
export function collectBlockElements(opts: WalkBlocksOptions = {}): Element[] {
  const root = opts.root ?? getContentRoot()
  const minWords = opts.minWords ?? 0

  const candidates = Array.from(root.querySelectorAll(BLOCK_SELECTOR)).filter((el) => {
    if (isBonitaUI(el) || hasBlockedAncestor(el)) return false

    if (minWords > 0) {
      const words = (el.textContent ?? '').trim().split(/\s+/).filter(Boolean).length
      if (words < minWords) return false
    }

    return true
  })

  const candidateSet = new Set(candidates)

  // Walk up from each candidate; any ancestor found in the set is a
  // *container* wrapping a real candidate, so the container gets marked
  // for removal — not the candidate we started from. This prunes outer
  // wrappers while leaving innermost content untouched, which is the
  // inverse of (and fix for) the earlier buggy direction — see the
  // @known-issue-fixed note above.
  const containers = new Set<Element>()
  for (const el of candidates) {
    let cursor = el.parentElement
    while (cursor) {
      if (candidateSet.has(cursor)) containers.add(cursor)
      cursor = cursor.parentElement
    }
  }

  return candidates.filter((el) => !containers.has(el))
}

/**
 * Convenience wrapper around {@link collectBlockElements} that invokes
 * `visit` for each discovered block, in document order.
 *
 * This is Pattern B: use it for features that need a paragraph-level unit
 * — either to replace its contents wholesale (sentence splitting) or to
 * score/rank text within it before deciding what to annotate (phrase
 * bolding's per-paragraph ranking).
 *
 * @param visit - Callback invoked once per discovered block element.
 * @param opts  - See {@link WalkBlocksOptions}.
 */
export function walkBlocks(
  visit: (block: Element) => void,
  opts: WalkBlocksOptions = {},
): void {
  for (const block of collectBlockElements(opts)) visit(block)
}