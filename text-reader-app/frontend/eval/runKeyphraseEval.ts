/**
 * @file eval/runKeyphraseEval.ts
 *
 * Evaluates extractKeywords() from phraseExtractor.ts against Inspec
 * (science abstracts) and DUC-2001 (news), both reader-assigned keyphrase
 * benchmarks, via the Hugging Face "midas" mirrors.
 *
 * Run:
 *   ./eval/download-keyphrases.sh
 *   npx tsx eval/runKeyphraseEval.ts
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import natural from 'natural'

import { extractKeywords } from '../src/content/utils/phraseExtractor'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.resolve(__dirname, 'data')

const K_VALUES = [5, 10, 15]
const OVERLAP_THRESHOLD = 0.5 // fraction of shared stems required for a partial match

interface GoldDoc {
  id: string
  tokens: string[]
  keyphrases: string[]
}

interface DatasetConfig {
  label: string
  file: string
}

const DATASETS: DatasetConfig[] = [
  { label: 'Inspec (science abstracts)', file: path.join(DATA_DIR, 'inspec_test.json') },
  { label: 'DUC-2001 (news)', file: path.join(DATA_DIR, 'duc2001_test.json') },
]

// ── Stemming / matching ─────────────────────────────────────────────────

function stemPhrase(phrase: string): string[] {
  return phrase.toLowerCase().split(/\s+/).filter(Boolean).map(w => natural.PorterStemmer.stem(w))
}

/**
 * Partial/stemmed match: true when the smaller stem set is at least
 * OVERLAP_THRESHOLD covered by the larger one. Lets a single predicted word
 * ("extraction") credit-match a multi-word gold phrase ("keyphrase
 * extraction") without requiring exact phrase alignment.
 */
function isPartialMatch(predStems: string[], goldStems: string[]): boolean {
  const a = new Set(predStems)
  const b = new Set(goldStems)
  if (a.size === 0 || b.size === 0) return false
  const shared = [...a].filter(s => b.has(s)).length
  return shared / Math.min(a.size, b.size) >= OVERLAP_THRESHOLD
}

// ── Per-document scoring ─────────────────────────────────────────────────

interface DocResult {
  id: string
  precision: Record<number, number>
  recall: Record<number, number>
  f1: Record<number, number>
}

function scoreDoc(id: string, predictedTerms: string[], goldKeyphrases: string[]): DocResult {
  const predStemmed = predictedTerms.map(stemPhrase)
  const goldStemmed = goldKeyphrases.map(stemPhrase)

  const precision: Record<number, number> = {}
  const recall: Record<number, number> = {}
  const f1: Record<number, number> = {}

  for (const k of K_VALUES) {
    const topK = predStemmed.slice(0, k)
    let hits = 0
    const coveredGold = new Set<number>()

    topK.forEach(predStems => {
      let matched = false
      goldStemmed.forEach((goldStems, gi) => {
        if (isPartialMatch(predStems, goldStems)) {
          matched = true
          coveredGold.add(gi)
        }
      })
      if (matched) hits++
    })

    const p = topK.length ? hits / topK.length : 0
    const r = goldStemmed.length ? coveredGold.size / goldStemmed.length : 0
    precision[k] = p
    recall[k] = r
    f1[k] = p + r > 0 ? (2 * p * r) / (p + r) : 0
  }

  return { id, precision, recall, f1 }
}

// ── Aggregation ──────────────────────────────────────────────────────────

function mean(nums: number[]): number {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0
}

function report(label: string, results: DocResult[]) {
  console.log(`\n=== ${label} (n=${results.length} docs) ===`)
  for (const k of K_VALUES) {
    const p = mean(results.map(r => r.precision[k]))
    const r = mean(results.map(r => r.recall[k]))
    const f = mean(results.map(r => r.f1[k]))
    console.log(`  @${k.toString().padStart(2)}  P=${p.toFixed(3)}  R=${r.toFixed(3)}  F1=${f.toFixed(3)}`)
  }
}

function worstDocs(docs: GoldDoc[], results: DocResult[], n: number, k: number) {
  const withF1 = docs.map((doc, i) => ({
    id: doc.id,
    goldKeyphrases: doc.keyphrases.length,
    f1: Number(results[i].f1[k].toFixed(3)),
  }))
  withF1.sort((a, b) => a.f1 - b.f1)
  console.log(`\n--- Worst ${n} docs by F1@${k} (for manual inspection) ---`)
  console.table(withF1.slice(0, n))
}

// ── Main ─────────────────────────────────────────────────────────────────

async function evalDataset(cfg: DatasetConfig) {
  if (!fs.existsSync(cfg.file)) {
    console.error(`Missing ${cfg.file} — run ./eval/download-keyphrases.sh first.`)
    return
  }

  const docs: GoldDoc[] = JSON.parse(fs.readFileSync(cfg.file, 'utf-8'))
  const results: DocResult[] = []

  for (const doc of docs) {
    // extractKeywords wants paragraph strings; the tokenized doc is treated
    // as a single paragraph. Note: reconstructed spacing around punctuation
    // won't perfectly match natural text (CoreNLP tokenizes "." as its own
    // token) — spot-check a few docs if results look off for isFalseCapital
    // or the science-pattern regexes, which assume normal punctuation.
    const paragraph = doc.tokens.join(' ')
    const extracted = await extractKeywords([paragraph])
    results.push(scoreDoc(doc.id, extracted.map(e => e.term), doc.keyphrases))
  }

  report(cfg.label, results)
  worstDocs(docs, results, 15, 10)
}

async function main() {
  for (const cfg of DATASETS) await evalDataset(cfg)
}

main()