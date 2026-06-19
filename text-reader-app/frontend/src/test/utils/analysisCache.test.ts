/**
 * Tests for analysisCache.ts
 *
 * getCachedData  — should return null until something sets the cache
 * fetchAnalysis  — should resolve to null (wraps the same cache)
 * getParagraphs  — main logic: DOM scraping, landmark preference, word count filter
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { getCachedData, fetchAnalysis, getParagraphs } from '../../content/utils/analysisCache'

/** Builds a string with the given number of space-separated words */
function makeParagraph(wordCount: number) {
  return 'word '.repeat(wordCount).trim()
}

// Reset the DOM before each test so tests don't affect each other
beforeEach(() => {
  document.body.innerHTML = ''
})

// ─── getCachedData ────────────────────────────────────────────────────────────

describe('getCachedData', () => {
  it('returns null by default', () => {
    expect(getCachedData()).toBeNull()
  })
})

// ─── fetchAnalysis ────────────────────────────────────────────────────────────

describe('fetchAnalysis', () => {
  it('resolves to null by default', async () => {
    await expect(fetchAnalysis()).resolves.toBeNull()
  })
})

// ─── getParagraphs ────────────────────────────────────────────────────────────

describe('getParagraphs', () => {
  // Word count filter
  it('returns empty array when no paragraphs exist', () => {
    expect(getParagraphs()).toEqual([])
  })

  it('filters out paragraphs with fewer than 18 words', () => {
    document.body.innerHTML = `<p>${makeParagraph(10)}</p>`
    expect(getParagraphs()).toEqual([])
  })

  it('includes paragraphs with exactly 18 words', () => {
    const text = makeParagraph(18)
    document.body.innerHTML = `<p>${text}</p>`
    expect(getParagraphs()).toEqual([text])
  })

  it('includes paragraphs with more than 18 words', () => {
    const text = makeParagraph(25)
    document.body.innerHTML = `<p>${text}</p>`
    expect(getParagraphs()).toEqual([text])
  })

  // Element type support
  it('includes li elements as well as p elements', () => {
    const text = makeParagraph(20)
    document.body.innerHTML = `<ul><li>${text}</li></ul>`
    expect(getParagraphs()).toEqual([text])
  })

  // Text cleanup
  it('trims whitespace from paragraph text', () => {
    const text = makeParagraph(20)
    document.body.innerHTML = `<p>   ${text}   </p>`
    expect(getParagraphs()).toEqual([text])
  })

  // Landmark preference — only content inside the landmark should be returned
  it('prefers <main> over body when present', () => {
    document.body.innerHTML = `
      <p>This paragraph is outside main and should be ignored</p>
      <main><p>${makeParagraph(20)}</p></main>
    `
    const results = getParagraphs()
    expect(results).toHaveLength(1)
    expect(results[0]).toBe(makeParagraph(20))
  })

  it('prefers <article> when no <main> is present', () => {
    document.body.innerHTML = `
      <p>This paragraph is outside article and should be ignored</p>
      <article><p>${makeParagraph(20)}</p></article>
    `
    const results = getParagraphs()
    expect(results).toHaveLength(1)
    expect(results[0]).toBe(makeParagraph(20))
  })

  it('falls back to body when no landmark elements are present', () => {
    const text = makeParagraph(20)
    document.body.innerHTML = `<p>${text}</p>`
    expect(getParagraphs()).toEqual([text])
  })
})