/**
 * @file eval/keyphraseBaselines.ts
 *
 * Simple, deterministic keyphrase baselines to compare against
 * extractKeywords(). Every function takes the same input your production
 * code gets (the joined document text) and returns a ranked list of terms,
 * best first.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mulberry32 } from './evalUtils.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** Loads the same stop-word list production uses. */
export function loadStopSet(): Set<string> {
  const p = path.resolve(__dirname, '../src/assets/stopWords.en.json')
  const data = JSON.parse(fs.readFileSync(p, 'utf-8')) as { stopWords: string[] }
  return new Set(data.stopWords.map(w => w.toLowerCase()))
}

/** Lowercased alphabetic tokens, length >= 3, stop words removed. */
function contentTokens(text: string, stops: Set<string>): string[] {
  return (text.toLowerCase().match(/[a-z][a-z'-]*/g) ?? []).filter(w => w.length >= 3 && !stops.has(w))
}

/** Floor: a random ordering of the unique content words. */
export function randomRanking(text: string, stops: Set<string>, seed: number): string[] {
  const uniq = [...new Set(contentTokens(text, stops))]
  const rand = mulberry32(seed)
  for (let i = uniq.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[uniq[i], uniq[j]] = [uniq[j], uniq[i]]
  }
  return uniq
}

/** Raw count after stop-word removal. Ties keep first-occurrence order. */
export function frequencyRanking(text: string, stops: Set<string>): string[] {
  const counts = new Map<string, number>()
  for (const w of contentTokens(text, stops)) counts.set(w, (counts.get(w) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([w]) => w)
}

/** Earlier first occurrence ranks higher. Strong on abstracts and news. */
export function positionRanking(text: string, stops: Set<string>): string[] {
  return [...new Set(contentTokens(text, stops))]
}

// ── TextRank ─────────────────────────────────────────────────────────────

function textRankWords(words: string[], window = 4, d = 0.85, iters = 30): Map<string, number> {
  const adj = new Map<string, Map<string, number>>()
  const link = (a: string, b: string) => {
    if (!adj.has(a)) adj.set(a, new Map())
    const m = adj.get(a)!
    m.set(b, (m.get(b) ?? 0) + 1)
  }
  for (let i = 0; i < words.length; i++) {
    for (let j = i + 1; j < Math.min(i + window, words.length); j++) {
      if (words[i] === words[j]) continue
      link(words[i], words[j])
      link(words[j], words[i])
    }
  }

  const outSum = new Map<string, number>()
  for (const [n, nbrs] of adj) outSum.set(n, [...nbrs.values()].reduce((a, b) => a + b, 0))

  let score = new Map<string, number>([...adj.keys()].map(k => [k, 1]))
  for (let it = 0; it < iters; it++) {
    const next = new Map<string, number>()
    for (const [node, nbrs] of adj) {
      let s = 0
      for (const [nbr, w] of nbrs) s += (w / outSum.get(nbr)!) * score.get(nbr)!
      next.set(node, 1 - d + d * s)
    }
    score = next
  }
  return score
}

/** TextRank, single words only. */
export function textRankRanking(text: string, stops: Set<string>): string[] {
  const scores = textRankWords(contentTokens(text, stops))
  return [...scores.entries()].sort((a, b) => b[1] - a[1]).map(([w]) => w)
}

/**
 * TextRank with the paper's phrase step: take the top third of words, then
 * merge runs of adjacent top words in the original text into phrases
 * (max 3 words). Phrase score = sum of word scores.
 */
export function textRankPhraseRanking(text: string, stops: Set<string>): string[] {
  const scores = textRankWords(contentTokens(text, stops))
  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1])
  const topN = Math.max(1, Math.ceil(ranked.length / 3))
  const top = new Set(ranked.slice(0, topN).map(([w]) => w))

  const raw = text.toLowerCase().match(/[a-z][a-z'-]*/g) ?? []
  const phrases = new Map<string, number>()
  let cur: string[] = []
  const flush = () => {
    if (cur.length > 0 && cur.length <= 3) {
      phrases.set(cur.join(' '), cur.reduce((a, w) => a + (scores.get(w) ?? 0), 0))
    }
    cur = []
  }
  for (const tok of raw) {
    if (top.has(tok)) cur.push(tok)
    else flush()
  }
  flush()

  return [...phrases.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p)
}

// ── External predictions (YAKE, exported from Python) ────────────────────

/** { methodName: { docId: rankedTerms[] } } for one dataset. */
export type ExternalPreds = Record<string, Record<string, string[]>>

/** Loads eval/data/yake_predictions.json (written by run_yake.py). Empty if missing. */
export function loadExternal(datasetKey: string): ExternalPreds {
  const p = path.resolve(__dirname, 'data/yake_predictions.json')
  if (!fs.existsSync(p)) return {}
  const all = JSON.parse(fs.readFileSync(p, 'utf-8')) as Record<string, ExternalPreds>
  return all[datasetKey] ?? {}
}