/**
 * @file eval/runComplexityEval.ts
 *
 * Evaluates scoreComplexity() from wordSimplifier.ts against the CompLex
 * (SemEval-2021 Task 1) human-annotated gold standard, and compares it with:
 *
 *   - frequency-only baseline  (log of rank in englishFreq.json)
 *   - word-length baseline
 *
 * New in this version:
 *   1. Baselines on the same splits (Pearson / Spearman / per-subcorpus).
 *   2. Paired bootstrap CI for Spearman (YOURS minus frequency-only).
 *   3. Precision / recall AT YOUR REAL UNDERLINE THRESHOLDS: for each level in
 *      COMPLEXITY_THRESHOLDS, a word counts as "flagged" if raw score >= the
 *      threshold and it is not capitalised (same rule as wordUnderlines.ts).
 *      "Truly hard" = human complexity >= HUMAN_COMPLEX. The frequency-only
 *      baseline is then evaluated flagging the SAME NUMBER of words, so the
 *      comparison is at an equal underline rate.
 *
 * Run:
 *   ./eval/download-complex.sh
 *   npx tsx eval/runComplexityEval.ts
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { scoreComplexity, COMPLEXITY_THRESHOLDS } from '../src/content/utils/wordSimplifier'

import { mean, pearson, spearman, mae, rmse, linearFit } from './stats.ts'
import { bootstrapCI } from './evalUtils.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ── Config ───────────────────────────────────────────────────────────────

const FREQ_ASSET_PATH = path.resolve(__dirname, '../src/assets/englishFreq.json')

const DATA_DIR = path.resolve(__dirname, 'data')
const TRAIN_TSV = path.join(DATA_DIR, 'lcp_single_train.tsv')
const TEST_TSV = path.join(DATA_DIR, 'lcp_single_test.tsv')
const TRIAL_TSV = path.join(DATA_DIR, 'lcp_single_trial.tsv')

const WORST_N = 25

/**
 * Human score at/above which a word counts as "actually hard" for the
 * threshold analysis. 0.5 is a judgment call (CompLex mean is ~0.30).
 * Try 0.4 and 0.6 to see how sensitive the conclusion is.
 */
const HUMAN_COMPLEX = 0.4

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
  const [, ...rows] = lines
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

function isCapitalised(word: string): boolean {
  return word.length > 0 && word[0] >= 'A' && word[0] <= 'Z'
}

// ── Scorers ──────────────────────────────────────────────────────────────

type Scorer = (token: string) => number

function makeScorers(freq: Map<string, number>): Record<string, Scorer> {
  return {
    'YOURS scoreComplexity': t => scoreComplexity(t, freq),
    // Higher rank number = rarer = harder. Unknown words get the max rank.
    'frequency-only': t => Math.log((freq.get(t.toLowerCase()) ?? freq.size) + 1),
    'word length': t => t.length,
  }
}

function predictAll(rows: GoldRow[], scorers: Record<string, Scorer>): Record<string, number[]> {
  const out: Record<string, number[]> = {}
  for (const [name, fn] of Object.entries(scorers)) out[name] = rows.map(r => fn(r.token))
  return out
}

// ── Reporting ────────────────────────────────────────────────────────────

function report(label: string, yPredRaw: number[], yPredCalibrated: number[], yTrue: number[]) {
  console.log(`\n=== ${label} (n=${yTrue.length}) ===`)
  console.log(`Pearson r          : ${pearson(yPredRaw, yTrue).toFixed(3)}`)
  console.log(`Spearman r         : ${spearman(yPredRaw, yTrue).toFixed(3)}  <- primary metric`)
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

function csvField(v: string | number): string {
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

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
    [row.id, row.subcorpus, row.token, human.toFixed(4), raw.toFixed(4), calibrated.toFixed(4), error.toFixed(4)]
      .map(csvField)
      .join(','),
  )
  fs.writeFileSync(outPath, [header.join(','), ...lines].join('\n'), 'utf-8')
  console.log(`Wrote ${rows.length} rows -> ${outPath}`)
}

// ── New analyses ─────────────────────────────────────────────────────────

function compareScorers(preds: Record<string, number[]>, yTrue: number[]) {
  console.log('\n--- TEST: YOURS vs baselines ---')
  console.table(
    Object.entries(preds).map(([name, p]) => ({
      scorer: name,
      pearson: pearson(p, yTrue).toFixed(3),
      spearman: spearman(p, yTrue).toFixed(3),
    })),
  )

  const yours = preds['YOURS scoreComplexity']
  const freqOnly = preds['frequency-only']
  const n = yTrue.length
  const diff = spearman(yours, yTrue) - spearman(freqOnly, yTrue)
  const ci = bootstrapCI(
    n,
    idx => {
      const y = idx.map(i => yTrue[i])
      return spearman(idx.map(i => yours[i]), y) - spearman(idx.map(i => freqOnly[i]), y)
    },
    500,
    3,
  )
  console.log(
    `Spearman gain over frequency-only: ${diff.toFixed(3)}  95% CI [${ci.lo.toFixed(3)}, ${ci.hi.toFixed(3)}]` +
      (ci.lo > 0 ? '  -> your extra features help' : '  -> not clearly better than frequency alone'),
  )
}

function bySubcorpus(rows: GoldRow[], preds: Record<string, number[]>, yTrue: number[]) {
  console.log('\n--- Spearman by subcorpus (TEST) ---')
  const table: Record<string, string | number>[] = []
  for (const sub of ['bible', 'europarl', 'biomed']) {
    const idx = rows.map((r, i) => (r.subcorpus === sub ? i : -1)).filter(i => i >= 0)
    if (!idx.length) continue
    const row: Record<string, string | number> = { subcorpus: sub, n: idx.length }
    for (const [name, p] of Object.entries(preds)) {
      row[name] = spearman(idx.map(i => p[i]), idx.map(i => yTrue[i])).toFixed(3)
    }
    table.push(row)
  }
  console.table(table)
}

function prf(flagged: boolean[], truth: boolean[]) {
  let tp = 0
  let fp = 0
  let fn = 0
  flagged.forEach((f, i) => {
    if (f && truth[i]) tp++
    else if (f && !truth[i]) fp++
    else if (!f && truth[i]) fn++
  })
  const p = tp + fp ? tp / (tp + fp) : 0
  const r = tp + fn ? tp / (tp + fn) : 0
  const f1 = p + r ? (2 * p * r) / (p + r) : 0
  return { p, r, f1 }
}

/**
 * What users actually experience: of the words that get underlined, how many
 * are truly hard (precision), and how many hard words get underlined (recall)?
 * Baseline flags the same number of words, chosen by frequency rank.
 */
function thresholdAnalysis(
  rows: GoldRow[],
  yoursRaw: number[],
  freqScores: number[],
  yTrue: number[],
) {
  const truth = yTrue.map(y => y >= HUMAN_COMPLEX)
  const eligible = rows.map(r => !isCapitalised(r.token)) // production never underlines capitalised words
  const baseRate = truth.filter((t, i) => t && eligible[i]).length / eligible.filter(Boolean).length

  console.log(
    `\n--- Precision/recall at your underline thresholds (TEST) ---\n` +
      `"Hard" = human >= ${HUMAN_COMPLEX}. ${eligible.filter(e => !e).length} capitalised tokens excluded, ` +
      `as in production. Base rate of hard words among eligible: ${(baseRate * 100).toFixed(1)}%`,
  )

  const eligibleIdx = rows.map((_, i) => i).filter(i => eligible[i])
  const table = Object.entries(COMPLEXITY_THRESHOLDS as Record<string, number>).map(([level, thr]) => {
    const flagged = yoursRaw.map((s, i) => eligible[i] && s >= thr)
    const k = flagged.filter(Boolean).length
    const yours = prf(flagged, truth)

    // Frequency-only, flagging the same number of words.
    const topByFreq = [...eligibleIdx].sort((a, b) => freqScores[b] - freqScores[a]).slice(0, k)
    const baseFlag = rows.map(() => false)
    topByFreq.forEach(i => (baseFlag[i] = true))
    const base = prf(baseFlag, truth)

    return {
      level,
      threshold: Number(thr.toFixed(3)),
      flagged: k,
      'flag%': ((k / eligibleIdx.length) * 100).toFixed(1),
      'P yours': yours.p.toFixed(3),
      'R yours': yours.r.toFixed(3),
      'F1 yours': yours.f1.toFixed(3),
      'P freq': base.p.toFixed(3),
      'R freq': base.r.toFixed(3),
      'F1 freq': base.f1.toFixed(3),
    }
  })
  console.table(table)
}

// ── Main ─────────────────────────────────────────────────────────────────

function main() {
  if (!fs.existsSync(TRAIN_TSV) || !fs.existsSync(TEST_TSV)) {
    console.error(`Missing data files. Run ./eval/download-complex.sh first (expected files in ${DATA_DIR}).`)
    process.exit(1)
  }

  const freq = loadFreqMap(FREQ_ASSET_PATH)
  const scorers = makeScorers(freq)

  const trainRows = loadTsv(TRAIN_TSV)
  const testRows = loadTsv(TEST_TSV)
  const trialRows = fs.existsSync(TRIAL_TSV) ? loadTsv(TRIAL_TSV) : []

  // 1. Calibrate on TRAIN only (this only affects MAE/RMSE, not correlations).
  const trainPreds = predictAll(trainRows, scorers)
  const trainRaw = trainPreds['YOURS scoreComplexity']
  const trainTrue = trainRows.map(r => r.complexity)
  const { slope, intercept } = linearFit(trainRaw, trainTrue)
  console.log(`Calibration fit on train split: score' = ${slope.toFixed(4)} * raw + ${intercept.toFixed(4)}`)
  console.log(`(Train raw score mean=${mean(trainRaw).toFixed(2)}, human mean=${mean(trainTrue).toFixed(2)})`)
  writeCsv(
    path.join(DATA_DIR, 'train_predictions.csv'),
    trainRows,
    trainRaw,
    trainRaw.map(p => slope * p + intercept),
    trainTrue,
  )

  // 2. TRIAL
  if (trialRows.length) {
    const preds = predictAll(trialRows, scorers)
    const raw = preds['YOURS scoreComplexity']
    const yTrue = trialRows.map(r => r.complexity)
    const cal = raw.map(p => slope * p + intercept)
    report('TRIAL split (YOURS)', raw, cal, yTrue)
    writeCsv(path.join(DATA_DIR, 'trial_predictions.csv'), trialRows, raw, cal, yTrue)
  }

  // 3. TEST
  const testPreds = predictAll(testRows, scorers)
  const testRaw = testPreds['YOURS scoreComplexity']
  const testTrue = testRows.map(r => r.complexity)
  const testCal = testRaw.map(p => slope * p + intercept)
  report('TEST split (YOURS)', testRaw, testCal, testTrue)
  worstOffenders(testRows, testCal, testTrue, WORST_N)
  writeCsv(path.join(DATA_DIR, 'test_predictions.csv'), testRows, testRaw, testCal, testTrue)

  // 4. New: baselines, per-subcorpus, thresholds
  compareScorers(testPreds, testTrue)
  bySubcorpus(testRows, testPreds, testTrue)
  thresholdAnalysis(testRows, testRaw, testPreds['frequency-only'], testTrue)
}

main()