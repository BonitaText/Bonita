/**
 * @file eval/runKeyphraseEval.ts
 *
 * Evaluates extractKeywords() from phraseExtractor.ts against Inspec
 * (science abstracts) and DUC-2001 (news), and compares it with baselines
 * under the exact same documents, input text, matcher and k values:
 *
 *   random, frequency, first-occurrence, TextRank (words / phrases),
 *   YAKE (n=1 / n=3, if eval/data/yake_predictions.json exists).
 *
 * Two matching modes are reported:
 *   loose  - your original partial-stem-overlap matcher (>= 50% shared stems)
 *   strict - exact stemmed phrase match, the convention most papers use.
 * Compare against published numbers ONLY in strict mode.
 *
 * Changes vs the previous version:
 *   - docs with zero gold keyphrases are excluded
 *   - predictions are de-duplicated by stem before taking top-k
 *     (so "network"/"networks" can't fill two slots). Set DEDUP=false to
 *     reproduce your old numbers.
 *   - paired bootstrap CIs of F1@10 difference (YOURS minus each baseline)
 *
 * Run:
 *   ./eval/download-keyphrases.sh
 *   python eval/run_yake.py            # optional, for YAKE rows
 *   npx tsx eval/runKeyphraseEval.ts
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import natural from 'natural'

import { extractKeywords } from '../src/content/utils/phraseExtractor'
import {
  loadStopSet,
  randomRanking,
  frequencyRanking,
  positionRanking,
  textRankRanking,
  textRankPhraseRanking,
  loadExternal,
} from './keyphraseBaselines.ts'
import { bootstrapCI, hashString } from './evalUtils.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.resolve(__dirname, 'data')

const K_VALUES = [5, 10, 15]
const OVERLAP_THRESHOLD = 0.5
const DEDUP = true
const REF_METHOD = 'YOURS scoreTerm'

type MatchMode = 'loose' | 'strict'

interface GoldDoc {
  id: string
  tokens: string[]
  keyphrases: string[]
}

interface DatasetConfig {
  label: string
  key: string // file stem; must match the keys written by run_yake.py
  file: string
}

const DATASETS: DatasetConfig[] = [
  { label: 'Inspec (science abstracts)', key: 'inspec_test', file: path.join(DATA_DIR, 'inspec_test.json') },
  { label: 'DUC-2001 (news)', key: 'duc2001_test', file: path.join(DATA_DIR, 'duc2001_test.json') },
]

// ── Stemming / matching ─────────────────────────────────────────────────

function stemPhrase(phrase: string): string[] {
  return phrase.toLowerCase().split(/\s+/).filter(Boolean).map(w => natural.PorterStemmer.stem(w))
}

function isMatch(mode: MatchMode, predStems: string[], goldStems: string[]): boolean {
  if (predStems.length === 0 || goldStems.length === 0) return false
  if (mode === 'strict') return predStems.join(' ') === goldStems.join(' ')
  const a = new Set(predStems)
  const b = new Set(goldStems)
  const shared = [...a].filter(s => b.has(s)).length
  return shared / Math.min(a.size, b.size) >= OVERLAP_THRESHOLD
}

// ── Per-document scoring ─────────────────────────────────────────────────

interface DocResult {
  precision: Record<number, number>
  recall: Record<number, number>
  f1: Record<number, number>
}

function scoreDoc(preds: string[], gold: string[], mode: MatchMode): DocResult {
  const predStemmed: string[][] = []
  const seen = new Set<string>()
  for (const p of preds) {
    const stems = stemPhrase(p)
    const key = stems.join(' ')
    if (!key) continue
    if (DEDUP) {
      if (seen.has(key)) continue
      seen.add(key)
    }
    predStemmed.push(stems)
  }
  const goldStemmed = gold.map(stemPhrase)

  const precision: Record<number, number> = {}
  const recall: Record<number, number> = {}
  const f1: Record<number, number> = {}

  for (const k of K_VALUES) {
    const topK = predStemmed.slice(0, k)
    let hits = 0
    const coveredGold = new Set<number>()
    for (const predStems of topK) {
      let matched = false
      goldStemmed.forEach((goldStems, gi) => {
        if (isMatch(mode, predStems, goldStems)) {
          matched = true
          coveredGold.add(gi)
        }
      })
      if (matched) hits++
    }
    const p = topK.length ? hits / topK.length : 0
    const r = goldStemmed.length ? coveredGold.size / goldStemmed.length : 0
    precision[k] = p
    recall[k] = r
    f1[k] = p + r > 0 ? (2 * p * r) / (p + r) : 0
  }
  return { precision, recall, f1 }
}

// ── Aggregation ──────────────────────────────────────────────────────────

function mean(nums: number[]): number {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0
}

function reportMode(
  label: string,
  mode: MatchMode,
  docs: GoldDoc[],
  rankings: Record<string, string[][]>,
) {
  console.log(`\n=== ${label} | ${mode.toUpperCase()} matching | n=${docs.length} docs ===`)

  const perMethod: Record<string, DocResult[]> = {}
  for (const [name, ranks] of Object.entries(rankings)) {
    perMethod[name] = docs.map((d, i) => scoreDoc(ranks[i], d.keyphrases, mode))
  }

  const rows = Object.entries(perMethod).map(([name, res]) => ({
    method: name,
    'P@10': mean(res.map(r => r.precision[10])).toFixed(3),
    'R@10': mean(res.map(r => r.recall[10])).toFixed(3),
    'F1@5': mean(res.map(r => r.f1[5])).toFixed(3),
    'F1@10': mean(res.map(r => r.f1[10])).toFixed(3),
    'F1@15': mean(res.map(r => r.f1[15])).toFixed(3),
  }))
  console.table(rows)

  // Paired bootstrap: (YOURS - other) F1@10, resampling documents.
  const ref = perMethod[REF_METHOD]?.map(r => r.f1[10])
  if (ref) {
    console.log(`Paired bootstrap, F1@10 difference (${REF_METHOD} minus method), 95% CI:`)
    const out = Object.entries(perMethod)
      .filter(([name]) => name !== REF_METHOD)
      .map(([name, res]) => {
        const other = res.map(r => r.f1[10])
        const diff = mean(ref) - mean(other)
        const ci = bootstrapCI(docs.length, idx => mean(idx.map(i => ref[i] - other[i])), 1000, 7)
        const verdict = ci.lo > 0 ? 'YOURS better' : ci.hi < 0 ? 'YOURS worse' : 'no clear difference'
        return {
          vs: name,
          diff: diff.toFixed(3),
          ci95: `[${ci.lo.toFixed(3)}, ${ci.hi.toFixed(3)}]`,
          verdict,
        }
      })
    console.table(out)
  }
  return perMethod
}

function worstDocs(docs: GoldDoc[], results: DocResult[], n: number, k: number) {
  const rows = docs
    .map((doc, i) => ({
      id: doc.id,
      goldKeyphrases: doc.keyphrases.length,
      f1: Number(results[i].f1[k].toFixed(3)),
    }))
    .sort((a, b) => a.f1 - b.f1)
    .slice(0, n)
  console.log(`\n--- Worst ${n} docs by F1@${k}, ${REF_METHOD}, loose (for manual inspection) ---`)
  console.table(rows)
}

// ── Main ─────────────────────────────────────────────────────────────────

async function evalDataset(cfg: DatasetConfig) {
  if (!fs.existsSync(cfg.file)) {
    console.error(`Missing ${cfg.file} — run ./eval/download-keyphrases.sh first.`)
    return
  }

  const allDocs: GoldDoc[] = JSON.parse(fs.readFileSync(cfg.file, 'utf-8'))
  const docs = allDocs.filter(d => d.keyphrases.length > 0)
  console.log(`\n${cfg.label}: ${allDocs.length} docs, ${allDocs.length - docs.length} dropped (no gold keyphrases)`)

  const stops = loadStopSet()
  const external = loadExternal(cfg.key)
  if (Object.keys(external).length === 0) {
    console.log('  (no YAKE predictions found — run `python eval/run_yake.py` to include them)')
  }

  // Same input text for every method, exactly as before.
  const texts = docs.map(d => d.tokens.join(' '))

  const rankings: Record<string, string[][]> = {}
  rankings['random'] = docs.map((d, i) => randomRanking(texts[i], stops, hashString(d.id)))
  rankings['frequency'] = texts.map(t => frequencyRanking(t, stops))
  rankings['first-occurrence'] = texts.map(t => positionRanking(t, stops))
  rankings['textrank (words)'] = texts.map(t => textRankRanking(t, stops))
  rankings['textrank (phrases)'] = texts.map(t => textRankPhraseRanking(t, stops))
  for (const method of Object.keys(external)) {
    rankings[method] = docs.map(d => external[method][String(d.id)] ?? [])
  }

  const yours: string[][] = []
  for (const t of texts) yours.push((await extractKeywords([t])).map(e => e.term))
  rankings[REF_METHOD] = yours
  // Unigram-only view of your output: the fairest comparison against word-level baselines.
  rankings[`${REF_METHOD} (unigrams only)`] = yours.map(r => r.filter(t => !/\s/.test(t)))

  const looseResults = reportMode(cfg.label, 'loose', docs, rankings)
  reportMode(cfg.label, 'strict', docs, rankings)
  worstDocs(docs, looseResults[REF_METHOD], 15, 10)
}

async function main() {
  for (const cfg of DATASETS) await evalDataset(cfg)
}

main()