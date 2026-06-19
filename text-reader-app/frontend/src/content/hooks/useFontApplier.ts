/**
 * @file hooks/useFontApplier.ts
 *
 * Exports {@link useFontApplier}, a React hook that injects a `<style>` tag
 * overriding the page's font with whichever typeface the user has selected in
 * Bonita settings.
 *
 * The hook targets `body` and all descendants so every element inherits the
 * override, then immediately re-asserts the Bonita UI's own Inter stack via a
 * higher-specificity `[data-bonita-root]` rule so the panel's appearance is
 * never altered.
 *
 * OpenDyslexic is the only non-system font in the map and therefore the only
 * one that requires an `@font-face` declaration; the URL is resolved at
 * runtime via `chrome.runtime.getURL` so it works in any Chrome extension
 * environment regardless of manifest path.
 */

import { useEffect } from 'react'
import { useSettings } from './useSettings'

// ─── Font map ─────────────────────────────────────────────────────────────────

/**
 * Maps each font setting value to its CSS `font-family` string.
 *
 * `null` means "no override" — the site's own styles are left untouched.
 */
const FONT_MAP = {
  default: null,
  arial: 'Arial, sans-serif',
  verdana: 'Verdana, sans-serif',
  opendyslexic: '"OpenDyslexic", "OpenDyslexic Regular", sans-serif',
} as const

/** `id` attribute of the `<style>` element this hook manages. */
const STYLE_ID = 'bonita-font-override'

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Applies a page-wide font override driven by {@link BonitaSettings.font}.
 *
 * Behaviour by font value:
 * - `"default"` — removes any previously injected override style and returns
 *   without adding a new one.
 * - `"arial"` / `"verdana"` — injects a `<style>` that sets `font-family`
 *   on `body *` to the corresponding system stack.
 * - `"opendyslexic"` — as above, but also prepends an `@font-face` block
 *   that loads the bundled WOFF2 file via `chrome.runtime.getURL`.
 *
 * In all cases the Bonita panel (`[data-bonita-root="true"]`) is exempted from
 * the override via a second CSS rule that restores the Inter/system-ui stack.
 *
 * The injected `<style>` is removed both on cleanup (dep change or unmount)
 * and at the top of each effect run to prevent duplicate tags.
 *
 * @example
 * ```tsx
 * // Inside the Bonita content-script root component:
 * function BonitoRoot() {
 *   useFontApplier()   // ← manages font override for the whole page
 *   return <Panel />
 * }
 * ```
 */
export function useFontApplier() {
  const { settings } = useSettings()

  useEffect(() => {
    document.getElementById(STYLE_ID)?.remove()

    const family = FONT_MAP[settings.font]
    if (!family) return () => document.getElementById(STYLE_ID)?.remove()

    const style = document.createElement('style')
    style.id = STYLE_ID

    // Only declare @font-face for OpenDyslexic — system fonts don't need it
    let fontFace = ''
    if (settings.font === 'opendyslexic') {
      const fontUrl = chrome.runtime.getURL('fonts/opendyslexic-latin-400-normal.woff2')
      fontFace = `
        @font-face {
          font-family: 'OpenDyslexic';
          src: url('${fontUrl}') format('woff2');
          font-weight: 400;
          font-style: normal;
          font-display: swap;
        }
      `
    }

    // Apply to everything, then restore Bonita UI with a second rule.
    // Note: :not([class^="bonita-"] *) is invalid in Chrome — complex
    // selectors inside :not() with descendant combinators are unsupported.
    style.textContent = `
      ${fontFace}

      body, body * {
        font-family: ${family} !important;
      }

      [data-bonita-root="true"],
      [data-bonita-root="true"] * {
        font-family: Inter, ui-sans-serif, system-ui, -apple-system,
                     BlinkMacSystemFont, "Segoe UI", sans-serif !important;
      }
    `

    document.head.appendChild(style)
    return () => document.getElementById(STYLE_ID)?.remove()
  }, [settings.font])
}