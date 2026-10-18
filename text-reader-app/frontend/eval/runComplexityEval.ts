/**
 * @file eval/runComplexityEval.ts
 *
 * Evaluates scoreComplexity() from wordSimplifier.ts against the CompLex 2.0
 * (SemEval-2021 Task 1) human-annotated gold standard.
 *
 * Run:
 *   ./eval/download-complex.sh      # once, to fetch the TSVs
 *   npx tsx eval/runComplexityEval.ts
 *
 * This file lives OUTSIDE src/ on purpose — see the README in this folder
 * for why.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// ── ADJUST THIS IMPORT to point at your real file ──────────────────────────
// wordSimplifier.ts has no DOM dependency and takes freq as a plain argument,
// so it can be imported directly into a Node script with no mocking needed.
import { scoreComplexity } from '../src/content/utils/wordSimplifier'

import { mean, pearson, spearman, mae, rmse, linearFit } from './stats.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ── Config ───────────────────────────────────────────────────────────────

// ADJUST THIS to the real path of the asset your extension loads at runtime.
const FREQ_ASSET_PATH = path.resolve(__dirname, '../src/assets/englishFreq.json')

const DATA_DIR = path.resolve(__dirname, 'data')
const TRAIN_TSV = path.join(DATA_DIR, 'lcp_single_train.tsv')
const TEST_TSV = path.join(DATA_DIR, 'lcp_single_test.tsv')
const TRIAL_TSV = path.join(DATA_DIR, 'lcp_single_trial.tsv')

const WORST_N = 25 // how many biggest misses to print for manual inspection

// ── Types ────────────────────────────────────────────────────────────────

interface GoldRow {
  id: string
  subcorpus: string
  sentence: string
  token: string
  complexity: number
}

// ── Loading ──────────────────────────────────────────────────────────────

function loadTsv(filePath: string): GoldRow[] {
  const lines = fs.readFileSync(filePath, 'utf-8').trim().split('\n')
  const [, ...rows] = lines // drop header
  return rows.map(line => {
    const [id, subcorpus, sentence, token, complexity] = line.split('\t')
    return { id, subcorpus, sentence, token, complexity: Number(complexity) }
  })
}

/**
 * Mirrors getFreqMap() from phraseExtractor.ts (word -> rank, by array index)
 * but reads the JSON straight off disk instead of using a dynamic import, to
 * dodge ESM "import assertions" friction when running under tsx/ts-node.
 * Handles both `["the", "of", ...]` and `[["the", 123], ["of", 98], ...]` shapes.
 */
function loadFreqMap(assetPath: string): Map<string, number> {
  const raw = JSON.parse(fs.readFileSync(assetPath, 'utf-8')) as unknown[]
  const map = new Map<string, number>()
  raw.forEach((entry, index) => {
    const word = Array.isArray(entry) ? entry[0] : entry
    map.set(String(word).toLowerCase(), index)
  })
  return map
}

// ── Core eval ────────────────────────────────────────────────────────────

function predict(rows: GoldRow[], freq: Map<string, number>) {
  const yTrue = rows.map(r => r.complexity)
  const yPredRaw = rows.map(r => scoreComplexity(r.token, freq))
  return { yTrue, yPredRaw }
}

function report(label: string, yPredRaw: number[], yPredCalibrated: number[], yTrue: number[]) {
  console.log(`\n=== ${label} (n=${yTrue.length}) ===`)
  console.log(`Pearson r          : ${pearson(yPredRaw, yTrue).toFixed(3)}`)
  console.log(`Spearman r         : ${spearman(yPredRaw, yTrue).toFixed(3)}  <- primary metric`)
  console.log(`MAE  (raw score)   : ${mae(yPredRaw, yTrue).toFixed(3)}  (not comparable to 0-1 scale, ignore)`)
  console.log(`MAE  (calibrated)  : ${mae(yPredCalibrated, yTrue).toFixed(3)}`)
  console.log(`RMSE (calibrated)  : ${rmse(yPredCalibrated, yTrue).toFixed(3)}`)
}

function worstOffenders(rows: GoldRow[], yPredCalibrated: number[], yTrue: number[], n: number) {
  const withError = rows
    .map((row, i) => ({
      token: row.token,
      subcorpus: row.subcorpus,
      human: Number(yTrue[i].toFixed(3)),
      predicted: Number(yPredCalibrated[i].toFixed(3)),
      error: Number(Math.abs(yPredCalibrated[i] - yTrue[i]).toFixed(3)),
    }))
    .sort((a, b) => b.error - a.error)
    .slice(0, n)

  console.log(`\n--- Top ${n} worst misses (for manual heuristic debugging) ---`)
  console.table(withError)
}

// ── CSV export ───────────────────────────────────────────────────────────

function csvField(v: string | number): string {
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * Writes one row per gold example: id, subcorpus, token, human score, your
 * raw multiplicative score, the calibrated (0-1 scaled) score, and the
 * absolute error. Sorted worst-error-first so it's immediately useful to
 * open in a spreadsheet for manual heuristic debugging.
 */
function writeCsv(
  outPath: string,
  rows: GoldRow[],
  yPredRaw: number[],
  yPredCalibrated: number[],
  yTrue: number[],
) {
  const header = ['id', 'subcorpus', 'token', 'human', 'predicted_raw', 'predicted_calibrated', 'error']

  const withError = rows.map((row, i) => ({
    row,
    raw: yPredRaw[i],
    calibrated: yPredCalibrated[i],
    human: yTrue[i],
    error: Math.abs(yPredCalibrated[i] - yTrue[i]),
  }))
  withError.sort((a, b) => b.error - a.error)

  const lines = withError.map(({ row, raw, calibrated, human, error }) =>
    [
      row.id,
      row.subcorpus,
      row.token,
      human.toFixed(4),
      raw.toFixed(4),
      calibrated.toFixed(4),
      error.toFixed(4),
    ].map(csvField).join(','),
  )

  fs.writeFileSync(outPath, [header.join(','), ...lines].join('\n'), 'utf-8')
  console.log(`Wrote ${rows.length} rows -> ${outPath}`)
}

// ── Main ─────────────────────────────────────────────────────────────────

function main() {
  if (!fs.existsSync(TRAIN_TSV) || !fs.existsSync(TEST_TSV)) {
    console.error(
      `Missing data files. Run ./eval/download-complex.sh first (expected files in ${DATA_DIR}).`,
    )
    process.exit(1)
  }

  const freq = loadFreqMap(FREQ_ASSET_PATH)

  const trainRows = loadTsv(TRAIN_TSV)
  const testRows = loadTsv(TEST_TSV)
  const trialRows = fs.existsSync(TRIAL_TSV) ? loadTsv(TRIAL_TSV) : []

  // 1. Calibrate: fit a linear mapping from your raw multiplicative score
  //    onto the human 0-1 scale, using TRAIN only (never fit on test).
  const { yPredRaw: trainPredRaw, yTrue: trainTrue } = predict(trainRows, freq)
  const { slope, intercept } = linearFit(trainPredRaw, trainTrue)
  console.log(`Calibration fit on train split: score' = ${slope.toFixed(4)} * raw + ${intercept.toFixed(4)}`)
  console.log(`(Train raw score mean=${mean(trainPredRaw).toFixed(2)}, human mean=${mean(trainTrue).toFixed(2)})`)

  // Note: comparing predictions on TRAIN just shows the best-case fit of the
  // linear rescale above — it's not a generalization number. Still useful
  // for eyeballing where the heuristic and human judgment diverge.
  const trainPredCalibrated = trainPredRaw.map(p => slope * p + intercept)
  writeCsv(path.join(DATA_DIR, 'train_predictions.csv'), trainRows, trainPredRaw, trainPredCalibrated, trainTrue)

  // 2. Evaluate on TRIAL (small, fast, good for quick iteration loops).
  if (trialRows.length) {
    const { yPredRaw, yTrue } = predict(trialRows, freq)
    const yPredCalibrated = yPredRaw.map(p => slope * p + intercept)
    report('TRIAL split', yPredRaw, yPredCalibrated, yTrue)
    writeCsv(path.join(DATA_DIR, 'trial_predictions.csv'), trialRows, yPredRaw, yPredCalibrated, yTrue)
  }

  // 3. Evaluate on TEST (held-out, this is the number you report/track over time).
  const { yPredRaw: testPredRaw, yTrue: testTrue } = predict(testRows, freq)
  const testPredCalibrated = testPredRaw.map(p => slope * p + intercept)
  report('TEST split', testPredRaw, testPredCalibrated, testTrue)
  worstOffenders(testRows, testPredCalibrated, testTrue, WORST_N)
  writeCsv(path.join(DATA_DIR, 'test_predictions.csv'), testRows, testPredRaw, testPredCalibrated, testTrue)

  // 4. Break down Spearman by subcorpus — bible/europarl/biomed have very
  //    different vocabularies, and your MeSH/science-pattern signals only
  //    apply in biomed text, so performance likely differs a lot by domain.
  console.log('\n--- Spearman by subcorpus (TEST) ---')
  for (const sub of ['bible', 'europarl', 'biomed']) {
    const idx = testRows.map((r, i) => (r.subcorpus === sub ? i : -1)).filter(i => i >= 0)
    if (!idx.length) continue
    const subPred = idx.map(i => testPredRaw[i])
    const subTrue = idx.map(i => testTrue[i])
    console.log(`  ${sub.padEnd(10)} n=${idx.length.toString().padStart(4)}  spearman=${spearman(subPred, subTrue).toFixed(3)}`)
  }
}

main()