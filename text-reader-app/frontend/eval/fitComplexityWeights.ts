/**
 * @file eval/fitComplexityWeights.ts
 *
 * Fits data-driven weights for scoreComplexity()'s sub-scores (rarity,
 * syllable count, prefix, suffix, consonant cluster) instead of the
 * hand-picked "multiply everything with an implicit exponent of 1" formula
 * currently in wordSimplifier.ts.
 *
 * Model (ridge regression):
 *
 *   human ≈ w0
 *         + w1·log(rarity)
 *         + w2·log(syllable)
 *         + w3·log(prefix)
 *         + w4·log(suffix)
 *         + w5·log(cluster)
 *         + w6·abbreviationSignal
 *
 * Fitting in log-space over the same five multiplicative sub-scores keeps
 * the model's shape close to the existing product formula — instead of
 * forcing every factor's exponent to exactly 1, the regression finds how
 * much each one should actually count, and the linear combination replaces
 * the separate post-hoc calibration step runComplexityEval.ts currently
 * does (slope/intercept are just w0 and an implicit overall scale here).
 *
 * `abbreviationSignal` is a new, non-logged feature — the fraction of a
 * token's letters that are uppercase, for short tokens — added because
 * scoreComplexity() currently zeroes out single-letter tokens like "P",
 * which the worst-offenders table shows humans rate as *highly* complex.
 * See the @known-issue note on scoreComplexity() in wordSimplifier.ts.
 * This script computes it from the raw CompLex token (case preserved),
 * separately from getComplexityFeatures(), which only sees the lowercased
 * word.
 *
 * Splits: fit on TRAIN, sweep the ridge lambda on TRIAL, report once on
 * TEST — same discipline as runComplexityEval.ts. TEST is touched exactly
 * once, at the end, after lambda is already chosen.
 *
 * Run:
 *   npx tsx eval/fitComplexityWeights.ts
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getComplexityFeatures } from '../src/content/utils/wordSimplifier'
import { pearson, spearman, mae, rmse } from './stats.ts'
import { ridgeRegression, predict, type Matrix, type Vector } from './linalg'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ADJUST to match the path your extension actually loads at runtime.
const FREQ_ASSET_PATH = path.resolve(__dirname, '../src/assets/englishFreq.json')

const DATA_DIR = path.resolve(__dirname, 'data')
const TRAIN_TSV = path.join(DATA_DIR, 'lcp_single_train.tsv')
const TEST_TSV = path.join(DATA_DIR, 'lcp_single_test.tsv')
const TRIAL_TSV = path.join(DATA_DIR, 'lcp_single_trial.tsv')

// Baseline numbers from the last runComplexityEval.ts run, printed at the
// end for an at-a-glance comparison. Update these if your baseline changes.
const BASELINE_TEST_PEARSON = 0.449
const BASELINE_TEST_SPEARMAN = 0.538

const LAMBDA_GRID = [0.001, 0.01, 0.03, 0.1, 0.3, 1, 3, 10]
const FEATURE_NAMES = [
  'intercept',
  'log_rarity',
  'log_syllable',
  'log_prefix',
  'log_suffix',
  'log_cluster',
  'abbreviation_signal',
]

const WORST_N = 25

// ── Types ────────────────────────────────────────────────────────────────

interface GoldRow {
  id: string
  subcorpus: string
  sentence: string
  token: string
  complexity: number
}

// ── Loading ──────────────────────────────────────────────────────────────
// Deliberately duplicated (not imported) from runComplexityEval.ts — it's
// ~15 stable lines, and keeping this script standalone means it can't be
// broken by unrelated edits to the other eval script.

function loadTsv(filePath: string): GoldRow[] {
  const lines = fs.readFileSync(filePath, 'utf-8').trim().split('\n')
  const [, ...rows] = lines // drop header
  return rows.map(line => {
    const [id, subcorpus, sentence, token, complexity] = line.split('\t')
    return { id, subcorpus, sentence, token, complexity: Number(complexity) }
  })
}

function loadFreqMap(assetPath: string): Map<string, number> {
  const raw = JSON.parse(fs.readFileSync(assetPath, 'utf-8')) as unknown[]
  const map = new Map<string, number>()
  raw.forEach((entry, index) => {
    const word = Array.isArray(entry) ? entry[0] : entry
    map.set(String(word).toLowerCase(), index)
  })
  return map
}

// ── Feature engineering ─────────────────────────────────────────────────

/**
 * Fraction of a token's letters that are uppercase, for tokens 6 letters
 * or shorter — a proxy for "this looks like an abbreviation" (P, ES, RT,
 * ADAMs, NL all score 0.5–1.0 here; ordinary lowercase words like "dross"
 * score 0). Longer tokens always get 0, since long ALL-CAPS runs are rarer
 * and not what the worst-offenders table flagged.
 *
 * Computed from the raw CompLex token, which preserves original case —
 * unlike the lowercased word getComplexityFeatures() operates on.
 */
function abbreviationSignal(rawToken: string): number {
  const letters = rawToken.replace(/[^A-Za-z]/g, '')
  if (!letters || letters.length > 6) return 0
  const upper = (letters.match(/[A-Z]/g) ?? []).length
  return upper / letters.length
}

/** log() with a floor so log(0) never happens, even for degenerate inputs. */
function safeLog(x: number): number {
  return Math.log(Math.max(x, 1e-6))
}

function buildDesignMatrix(rows: GoldRow[], freq: Map<string, number>): Matrix {
  return rows.map(row => {
    const f = getComplexityFeatures(row.token, freq)
    return [
      1, // intercept
      safeLog(f.rarity),
      safeLog(f.syllable),
      safeLog(f.prefix),
      safeLog(f.suffix),
      safeLog(f.cluster),
      abbreviationSignal(row.token),
    ]
  })
}

// ── Reporting ────────────────────────────────────────────────────────────

function report(label: string, yPred: Vector, yTrue: Vector) {
  console.log(`\n=== ${label} (n=${yTrue.length}) ===`)
  console.log(`Pearson r  : ${pearson(yPred, yTrue).toFixed(3)}`)
  console.log(`Spearman r : ${spearman(yPred, yTrue).toFixed(3)}`)
  console.log(`MAE        : ${mae(yPred, yTrue).toFixed(3)}`)
  console.log(`RMSE       : ${rmse(yPred, yTrue).toFixed(3)}`)
}

function worstOffenders(rows: GoldRow[], yPred: Vector, yTrue: Vector, n: number) {
  const withError = rows
    .map((row, i) => ({
      token: row.token,
      subcorpus: row.subcorpus,
      human: Number(yTrue[i].toFixed(3)),
      predicted: Number(yPred[i].toFixed(3)),
      error: Number(Math.abs(yPred[i] - yTrue[i]).toFixed(3)),
    }))
    .sort((a, b) => b.error - a.error)
    .slice(0, n)

  console.log(`\n--- Top ${n} worst misses (fitted model) ---`)
  console.table(withError)
}

// ── Main ─────────────────────────────────────────────────────────────────

function main() {
  if (!fs.existsSync(TRAIN_TSV) || !fs.existsSync(TEST_TSV) || !fs.existsSync(TRIAL_TSV)) {
    console.error(`Missing data files in ${DATA_DIR}. Run ./eval/download-complex.sh first.`)
    process.exit(1)
  }

  const freq = loadFreqMap(FREQ_ASSET_PATH)
  const trainRows = loadTsv(TRAIN_TSV)
  const trialRows = loadTsv(TRIAL_TSV)
  const testRows = loadTsv(TEST_TSV)

  const XTrain = buildDesignMatrix(trainRows, freq)
  const yTrain = trainRows.map(r => r.complexity)
  const XTrial = buildDesignMatrix(trialRows, freq)
  const yTrial = trialRows.map(r => r.complexity)
  const XTest = buildDesignMatrix(testRows, freq)
  const yTest = testRows.map(r => r.complexity)

  // ── Sweep lambda on TRAIN→TRIAL, selecting on Spearman (the primary metric) ──
  console.log('--- Ridge lambda sweep (fit on TRAIN, selected on TRIAL Spearman) ---')
  let bestLambda = LAMBDA_GRID[0]
  let bestSpearman = -Infinity
  let bestWeights: Vector = []

  for (const lambda of LAMBDA_GRID) {
    const w = ridgeRegression(XTrain, yTrain, lambda)
    const trialPred = predict(XTrial, w)
    const s = spearman(trialPred, yTrial)
    const p = pearson(trialPred, yTrial)
    console.log(`  lambda=${lambda.toString().padStart(6)}  trial spearman=${s.toFixed(3)}  trial pearson=${p.toFixed(3)}`)
    if (s > bestSpearman) {
      bestSpearman = s
      bestLambda = lambda
      bestWeights = w
    }
  }
  console.log(`\nSelected lambda=${bestLambda} (best TRIAL spearman=${bestSpearman.toFixed(3)})`)

  console.log('\n--- Fitted weights ---')
  bestWeights.forEach((w, i) => console.log(`  ${FEATURE_NAMES[i].padEnd(20)} ${w.toFixed(4)}`))

  // ── Report once on TEST ─────────────────────────────────────────────────
  const testPred = predict(XTest, bestWeights)
  report('TEST split — fitted model', testPred, yTest)
  worstOffenders(testRows, testPred, yTest, WORST_N)

  console.log('\n--- Spearman by subcorpus (TEST, fitted model) ---')
  for (const sub of ['bible', 'europarl', 'biomed']) {
    const idx = testRows.map((r, i) => (r.subcorpus === sub ? i : -1)).filter(i => i >= 0)
    if (!idx.length) continue
    const subPred = idx.map(i => testPred[i])
    const subTrue = idx.map(i => yTest[i])
    console.log(`  ${sub.padEnd(10)} n=${idx.length.toString().padStart(4)}  spearman=${spearman(subPred, subTrue).toFixed(3)}`)
  }

  const testPearson = pearson(testPred, yTest)
  const testSpearman = spearman(testPred, yTest)
  console.log(`
--- vs. hand-tuned baseline (last runComplexityEval.ts run) ---
  Pearson  : ${testPearson.toFixed(3)}  (baseline ${BASELINE_TEST_PEARSON.toFixed(3)}, Δ ${(testPearson - BASELINE_TEST_PEARSON >= 0 ? '+' : '')}${(testPearson - BASELINE_TEST_PEARSON).toFixed(3)})
  Spearman : ${testSpearman.toFixed(3)}  (baseline ${BASELINE_TEST_SPEARMAN.toFixed(3)}, Δ ${(testSpearman - BASELINE_TEST_SPEARMAN >= 0 ? '+' : '')}${(testSpearman - BASELINE_TEST_SPEARMAN).toFixed(3)})

If this beats baseline, hardcode the weights above into scoreComplexity()
as a weighted log-sum in place of the current equal-weight product. If
abbreviation_signal came out with a large positive weight, that's the
regression independently confirming the single-letter-token bug is worth
fixing properly (see the @known-issue note in wordSimplifier.ts) rather
than just being patched over by this one feature.
`)
}

main()