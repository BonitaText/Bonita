/**
 * @file utils/paragraphScorer.ts
 *
 * Ports the Python paragraph_complexity_from_doc() logic to the frontend.
 *
 * Dependencies:
 *   "compromise": "^14.x"
 *
 * Scoring mirrors nlp.py exactly:
 *   base score  = Flesch Reading Ease
 *   penalty     = avg word length > 6      →  − (len − 6) × 4
 *   penalty     = avg sentence length > 20 →  − (len − 20) × 1.5
 *   penalty     = syllable density > 2     →  − (density − 2) × 8
 *
 *   FUTURE IMPLEMENTATION: score < 40  → action "llm"   (very dense)
 *   score < 60  → action "split" (moderate complexity)
 *   score ≥ 60  → action "none"  (readable, leave alone)
 */

import nlp from 'compromise'
import type { ParagraphScore } from './analysisCache'

export type { ParagraphScore }

// ---------------------------------------------------------------------------
// Syllable counter — mirrors the Python implementation in nlp.py exactly
// ---------------------------------------------------------------------------

const STRIP_PUNCT_RE = /[.,!?()]/g

export function countSyllables(word: string): number {
  const clean = word.toLowerCase().replace(STRIP_PUNCT_RE, '')
  if (!clean) return 1

  const VOWELS = new Set(['a', 'e', 'i', 'o', 'u', 'y'])
  let count = 0
  let prevVowel = false

  for (const ch of clean) {
    const isVowel = VOWELS.has(ch)
    if (isVowel && !prevVowel) count++
    prevVowel = isVowel
  }

  return Math.max(1, count)
}

// ---------------------------------------------------------------------------
// Sentence splitter — compromise replaces the old abbreviation regex
// ---------------------------------------------------------------------------

/**
 * Merges any fragment that starts with a lowercase letter back onto the
 * previous sentence. This catches cases where compromise splits at an
 * abbreviation period (e.g. "U.S.", "Dr.", "St.") and the continuation
 * word is lowercase — a real new sentence is always capitalised.
 */
function mergeOrphanedFragments(sentences: string[]): string[] {
  const result: string[] = []
  for (const s of sentences) {
    const firstChar = s[0]
    if (result.length > 0 && firstChar && /[a-z]/.test(firstChar)) {
      result[result.length - 1] += ' ' + s
    } else {
      result.push(s)
    }
  }
  return result
}

export function splitSentences(text: string): string[] {
  const raw = (nlp(text).sentences().out('array') as string[])
    .map((s: string) => s.trim())
    .filter((s: string) => s.length > 0)

  const sentences = mergeOrphanedFragments(raw)
  return sentences.length > 0 ? sentences : [text.trim()].filter(Boolean)
}

// ---------------------------------------------------------------------------
// Flesch Reading Ease
// ---------------------------------------------------------------------------

function fleschScore(words: string[], sentences: string[]): number {
  if (!words.length || !sentences.length) return 100

  const syllables = words.reduce((acc, w) => acc + countSyllables(w), 0)
  const raw =
    206.835 -
    1.015 * (words.length / sentences.length) -
    84.6 * (syllables / words.length)

  return Math.round(Math.max(0, Math.min(100, raw)) * 100) / 100
}

// ---------------------------------------------------------------------------
// Main scoring function — mirrors paragraph_complexity_from_doc()
// ---------------------------------------------------------------------------

interface ScoredParagraph extends ParagraphScore {
  _debug?: {
    flesch: number
    score: number
    avgWordLen: number
    avgSentLen: number
    syllableDensity: number
    sentenceCount: number
  }
}

export function scoreParagraph(text: string): ScoredParagraph {
  const trimmed = text.trim()
  const sentences = splitSentences(trimmed)
  const words = trimmed.split(/\s+/).filter(w => w.length > 0)

  if (!words.length || !sentences.length) {
    return { text: trimmed, action: 'none' }
  }

  const syllables = words.reduce((acc, w) => acc + countSyllables(w), 0)
  const fk = fleschScore(words, sentences)

  const avgWordLen =
    words.reduce((acc, w) => acc + w.replace(STRIP_PUNCT_RE, '').length, 0) /
    words.length

  const avgSentLen = words.length / sentences.length
  const syllableDensity = syllables / words.length

  let score = fk
  if (avgWordLen > 6) score -= (avgWordLen - 6) * 4
  if (avgSentLen > 20) score -= (avgSentLen - 20) * 1.5
  if (syllableDensity > 2) score -= (syllableDensity - 2) * 8
  score = Math.round(Math.max(0, Math.min(100, score)) * 100) / 100


  // TO BE IMPLEMENTED IN THE FUTURE
  const action: ParagraphScore['action'] =
    score < 40 ? 'llm' : score < 60 ? 'split' : 'none'

  return {
    text: trimmed,
    action,
    _debug: {
      flesch: fk,
      score,
      avgWordLen: Math.round(avgWordLen * 100) / 100,
      avgSentLen: Math.round(avgSentLen * 100) / 100,
      syllableDensity: Math.round(syllableDensity * 100) / 100,
      sentenceCount: sentences.length,
    },
  }
}

export function scoreParagraphs(paragraphs: string[]): ParagraphScore[] {
  return paragraphs.map(scoreParagraph)
}