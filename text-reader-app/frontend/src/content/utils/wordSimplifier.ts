/**
 * @file content/utils/wordSimplifier.ts
 *
 * Composite reading-complexity scorer for single English words.
 *
 * A word's difficulty is estimated with a ridge-regression model fit against
 * the CompLex human-complexity dataset (see `eval/fitComplexityWeights.ts`):
 * a weighted sum of log(rarity), log(syllable), log(prefix), log(suffix),
 * log(cluster), and a raw abbreviation signal. This replaced the earlier
 * equal-weight product of the same five multipliers, which scored 0.449
 * Pearson / 0.538 Spearman on the CompLex TEST split versus 0.693 / 0.682
 * for the fitted model — see the eval run this was copied from for the
 * full comparison and worst-offender tables.
 *
 * This module has no DOM dependency and no dictionary of substitute words —
 * it is purely a scoring function over a word string and a frequency map.
 *
 * {@link wordRarity} is also the single source of truth for rarity used by
 * `phraseExtractor.ts` (via {@link scoreComplexity}) — there is no longer a
 * separate rarity curve in the keyword-scoring module, so the two can't
 * drift out of sync the way they previously did.
 *
 * @known-issue `difficultyOfTerm` in `phraseExtractor.ts` floors
 *   `scoreComplexity`'s result at `1.0`, a holdover from when this function
 *   always returned a ≥1.0 multiplier. The fitted model below is centered
 *   near its intercept (0.1611) for ordinary words, well under 1.0, so that
 *   floor now clamps nearly every word to the same difficulty and mutes the
 *   signal `scoreTerm` depends on. Needs a fix in `phraseExtractor.ts`
 *   (drop the floor, or rescale) — not addressed here since it's out of
 *   scope for this module.
 */

// ─── Complexity scoring ───────────────────────────────────────────────────────

/**
 * Minimum composite score a word must reach to be considered complex enough
 * to underline.
 *
 * - Lower (e.g. `low`) → more words underlined.
 * - Higher (e.g. `high`) → only the most obviously difficult vocabulary.
 *
 * @known-issue STALE. These were calibrated against the old equal-weight
 *   product, which returned scores roughly in [1, 4]. `scoreComplexity` now
 *   returns the fitted model's output, which sits on a scale much closer to
 *   the CompLex human 0–1 ratings (see `test_predictions.csv`'s `predicted`
 *   column — roughly 0.2–0.45 even for the worst misses). Left as-is
 *   pending recalibration against the new score distribution.
 */
export const COMPLEXITY_THRESHOLDS = {
  low: 0.25,
  medium: 0.3, // balanced
  high: 0.34, // strictest
} as const

export type ComplexityLevel = keyof typeof COMPLEXITY_THRESHOLDS

/**
 * The score above which a word gets the full popup (synonyms + definition).
 * Words between the tier threshold and this value get the lite popup
 * (≤2 synonyms, no definition, dashed underline).
 *
 * @known-issue STALE for the same reason as {@link COMPLEXITY_THRESHOLDS} —
 *   pending recalibration against the fitted model's output scale.
 */
export const HIGH_CONFIDENCE_THRESHOLD = 0.3

/**
 * Latinate / borrowed prefixes that signal academic or technical register,
 * paired with a complexity multiplier. Tested longest-first so that a more
 * specific prefix wins over a shorter one (e.g. "inter" before "in").
 *
 * Only the first matching prefix applies — no stacking with suffixes, though
 * the two multipliers are combined in {@link scoreComplexity} via the fitted
 * `logPrefix` / `logSuffix` weights.
 */
const MORPH_PREFIXES: ReadonlyArray<readonly [string, number]> = [
  // High signal — Greek/Latin combining forms rarely seen outside academia
  ['crypto', 1.4],
  ['pseudo', 1.35],
  ['proto', 1.35],
  ['macro', 1.3],
  ['micro', 1.3],
  ['ortho', 1.3],
  ['hetero', 1.3],
  ['homeo', 1.3],
  ['thermo', 1.3],
  ['electro', 1.3],
  // Medium signal — common in formal writing but learnable
  ['inter', 1.25],
  ['intra', 1.25],
  ['retro', 1.25],
  ['extra', 1.25],
  ['ultra', 1.25],
  ['hyper', 1.25],
  ['hypo', 1.25],
  ['anti', 1.2],
  ['auto', 1.2],
  ['semi', 1.2],
  ['poly', 1.2],
  ['mono', 1.2],
  ['omni', 1.2],
  // Low signal — appear in everyday words often enough to warrant restraint
  ['trans', 1.15],
  ['pre', 1.1],
  ['post', 1.1],
  ['sub', 1.1],
  ['super', 1.1],
  ['over', 1.05],
  ['under', 1.05],
] as const

/**
 * Latinate / formal suffixes that reliably signal academic register, paired
 * with a complexity multiplier. Tested longest-first so that a more specific
 * suffix wins over a shorter one.
 *
 * Only the first matching suffix applies — no stacking.
 */
const MORPH_SUFFIXES: ReadonlyArray<readonly [string, number]> = [
  ['aceous', 1.35],
  ['iferous', 1.35],
  ['itious', 1.35],
  ['ology', 1.3],
  ['ography', 1.3],
  ['escence', 1.3],
  ['escent', 1.3],
  ['atory', 1.25],
  ['itive', 1.25],
  ['ative', 1.25],
  ['ulent', 1.25],
  ['ulous', 1.25],
  ['ivity', 1.2],
  ['uous', 1.2],
  ['eous', 1.2],
  ['ious', 1.2],
  ['ance', 1.15],
  ['ence', 1.15],
  ['ment', 1.15],
  ['ness', 1.1],
  ['ful', 1.1],
  ['less', 1.1],
] as const

/**
 * Rare consonant cluster patterns that signal phonological difficulty —
 * the spelling-to-sound mapping is opaque even for literate adult readers.
 *
 * Grouped by signal strength:
 *  - Medium (1.2–1.3): unusual but phonetically consistent or French-derived
 *  - Low (1.15): moderately unusual patterns
 *
 * Only the single highest-scoring matching pattern applies — no stacking.
 */
const RARE_CLUSTERS: ReadonlyArray<readonly [RegExp, number]> = [
  [/polis/, 1.25], // "metropolis"
  [/fect/, 1.2], // "prefectures"
  [/que(?:$)/, 1.25], // "unique", "clique" — silent -que ending
  [/ieu/, 1.25], // "lieutenant", "adieu"
  [/eau/, 1.25], // "bureau", "plateau" — French-derived
  [/oise|ois/, 1.3], // "bourgeoisie", "turquoise" — French vowel clusters
  [/ariat/, 1.2], // "proletariat", "commissariat" — latinate suffix
  [/ps/, 1.2], // "psychology", "psalm"
  [/stle/, 1.15], // "castle", "wrestle" — silent t
  [/ght/, 1.15], // "thought", "bright"
  [/xc/, 1.15], // "excerpt", "excel" — /ks/ cluster
] as const

/**
 * Estimates the syllable count of an English word using vowel-cluster
 * counting with a silent-e correction.
 *
 * Rules applied:
 * 1. Count contiguous vowel clusters as syllable nuclei.
 * 2. Subtract 1 if the word ends in a silent `e` (e.g. `"terminate"`).
 * 3. Clamp to a minimum of 1.
 *
 * @param word - Lower-case word to estimate. Must be non-empty.
 * @returns Estimated syllable count ≥ 1.
 */
export function countSyllables(word: string): number {
  // Use word.match() instead of a module-level regex with the g flag.
  // A regex literal with /g retains lastIndex between calls when used with
  // exec() — resetting it here (or using match()) keeps each call independent.
  const clusters = word.match(/[aeiouy]+/gi) ?? []
  let count = clusters.length
  if (word.endsWith('e') && count > 1) count -= 1
  return Math.max(1, count)
}

/**
 * Returns a rarity multiplier for `word` based on its English frequency
 * rank.
 *
 * This is the **single source of truth for rarity** in the codebase.
 * `phraseExtractor.ts` previously had its own separate `rarityBonus` with
 * different rank bands — that duplicate has been removed, and keyword
 * scoring now goes through {@link scoreComplexity} (which calls this
 * function) via `difficultyOfTerm`, so the two modules can't drift onto
 * different rarity curves again.
 *
 * | Rank range    | Multiplier |
 * |---------------|------------|
 * | ≤ 1 000       | 1.0        |
 * | 1 001–5 000   | 1.2        |
 * | 5 001–10 000  | 1.3        |
 * | 10 001–20 000 | 1.4        |
 * | > 20 000      | 1.6        |
 * | Not in map    | 1.8        |
 *
 * @param word - Lower-case word to look up.
 * @param freq - English frequency rank map (`word → rank`) from
 *               `englishFreq.json`, loaded by the caller via `getFreqMap()`.
 * @returns Rarity multiplier in [1.0, 1.8].
 */
export function wordRarity(word: string, freq: Map<string, number>): number {
  const rank = freq.get(word.toLowerCase())
  if (rank === undefined) return 1.8 // unknown word — likely technical, not auto-maxed
  if (rank <= 1_000) return 1.0
  if (rank <= 5_000) return 1.2
  if (rank <= 10_000) return 1.3
  if (rank <= 20_000) return 1.4
  return 1.6
}

/**
 * Returns a syllable-complexity multiplier. Based loosely on Flesch-Kincaid
 * syllable weighting: more syllables → harder to read. The scale is gentle so
 * syllable count alone cannot push a common word past the threshold.
 *
 * | Syllables | Multiplier |
 * |-----------|------------|
 * | 1         | 1.0        |
 * | 2         | 1.1        |
 * | 3         | 1.3        |
 * | 4+        | 1.4        |
 *
 * @param syllables - Estimated syllable count from {@link countSyllables}.
 * @returns Multiplier in [1.0, 1.4].
 */
function syllableScore(syllables: number): number {
  if (syllables <= 1) return 1.0
  if (syllables === 2) return 1.1
  if (syllables === 3) return 1.3
  return 1.4
}

/**
 * Returns a morphological complexity multiplier by testing `word` against
 * {@link MORPH_SUFFIXES} (longest-first). Only the first matching suffix
 * applies — no stacking.
 *
 * @param word - Lower-case word to test.
 * @returns Multiplier in [1.0, 1.35]; `1.0` when no suffix matches.
 */
function morphScore(word: string): number {
  for (const [suffix, multiplier] of MORPH_SUFFIXES) {
    if (word.endsWith(suffix)) return multiplier
  }
  return 1.0
}

/**
 * Returns a morphological complexity multiplier by testing `word` against
 * {@link MORPH_PREFIXES} (longest-first). Only the first matching prefix
 * applies — no stacking.
 *
 * @param word - Lower-case word to test.
 * @returns Multiplier in [1.0, 1.4]; `1.0` when no prefix matches.
 */
function prefixScore(word: string): number {
  for (const [prefix, multiplier] of MORPH_PREFIXES) {
    if (word.startsWith(prefix)) return multiplier
  }
  return 1.0
}

/**
 * Returns a consonant-cluster difficulty multiplier.
 * Only the single highest-scoring pattern applies (no stacking).
 *
 * @param word - Lower-case word to test.
 * @returns Multiplier in [1.0, 1.3]; `1.0` when no pattern matches.
 */
function clusterScore(word: string): number {
  let best = 1.0
  for (const [pattern, multiplier] of RARE_CLUSTERS) {
    if (pattern.test(word) && multiplier > best) best = multiplier
  }
  return best
}

/** The five independent sub-scores {@link scoreComplexity} combines. */
export interface ComplexityFeatures {
  rarity: number
  syllable: number
  prefix: number
  suffix: number
  cluster: number
}

/**
 * Returns the five sub-scores behind {@link scoreComplexity} individually,
 * without combining them. Exists so fitting scripts (see
 * `eval/fitComplexityWeights.ts`) can learn a weighted combination from
 * data — which is now what {@link scoreComplexity} itself uses, via
 * {@link FITTED_WEIGHTS}, in place of the original equal-weight product.
 *
 * @param word - Word to score, any casing — normalised to lower-case internally.
 * @param freq - English frequency rank map from `englishFreq.json`.
 */
export function getComplexityFeatures(word: string, freq: Map<string, number>): ComplexityFeatures {
  const lower = word.toLowerCase()
  return {
    rarity: wordRarity(lower, freq),
    syllable: syllableScore(countSyllables(lower)),
    prefix: prefixScore(lower),
    suffix: morphScore(lower),
    cluster: clusterScore(lower),
  }
}

/**
 * Fraction of a token's letters that are uppercase, for tokens 6 letters or
 * shorter — a proxy for "this looks like an abbreviation" (`P`, `ES`, `RT`,
 * `NL` all score 0.5–1.0 here; ordinary lowercase words like `dross` score
 * 0). Longer tokens always get 0.
 *
 * Copied verbatim from `eval/fitComplexityWeights.ts` (same name, same
 * behavior) so the feature computed at scoring time matches the one the
 * weights below were fit against. Must run on the **original-case** word,
 * before it's lowercased for the other four features — that's why
 * {@link scoreComplexity} computes this from its raw `word` parameter
 * rather than from {@link getComplexityFeatures}, which only sees lowercase.
 *
 * @param rawWord - Word as originally cased (not lower-cased).
 * @returns Value in [0, 1]; `0` for tokens with no letters or >6 letters.
 */
function abbreviationSignal(rawWord: string): number {
  const letters = rawWord.replace(/[^A-Za-z]/g, '')
  if (!letters || letters.length > 6) return 0
  const upper = (letters.match(/[A-Z]/g) ?? []).length
  return upper / letters.length
}

/** `log()` with a floor so `log(0)` never happens, even for degenerate inputs. */
function safeLog(x: number): number {
  return Math.log(Math.max(x, 1e-6))
}

/**
 * Ridge-regression weights fit against the CompLex human-complexity
 * dataset (`eval/fitComplexityWeights.ts`, lambda=3, selected on TRIAL
 * Spearman). TEST performance: Pearson r=0.693, Spearman r=0.682 — versus
 * 0.449 / 0.538 for the previous equal-weight product this replaces.
 *
 * Do not hand-edit these — regenerate by rerunning the fitting script
 * against updated data and pasting its "Fitted weights" output here.
 */
const FITTED_WEIGHTS = {
  intercept: 0.1611,
  logRarity: 0.4220,
  logSyllable: 0.0878,
  logPrefix: 0.0574,
  logSuffix: -0.0546,
  logCluster: -0.0165,
  abbreviationSignal: 0.2530,
} as const

/**
 * Computes the composite reading-complexity score for a single word.
 *
 * ```
 * score = w0
 *       + w1 · log(rarity)
 *       + w2 · log(syllable)
 *       + w3 · log(prefix)
 *       + w4 · log(suffix)
 *       + w5 · log(cluster)
 *       + w6 · abbreviationSignal
 * ```
 * using {@link FITTED_WEIGHTS}. This replaced a hand-picked equal-weight
 * product of the same five multiplicative sub-scores (see
 * {@link getComplexityFeatures}) — the ridge fit found how much each
 * factor should actually count instead of assuming an exponent of 1 for
 * all of them, and added {@link abbreviationSignal} as a sixth feature to
 * fix single-letter tokens (see the removed-guard note below).
 *
 * Each of the five logged factors is independent:
 * - {@link wordRarity}    — how uncommon the word is in general English
 * - {@link syllableScore} — proxy for decoding difficulty
 * - {@link morphScore}    — Latinate/formal suffixes signal academic register
 * - {@link prefixScore}   — Latinate/Greek prefixes signal technical register
 * - {@link clusterScore}  — rare consonant clusters signal phonological opacity
 *
 *
 * @param word - Word to score, any casing — original casing matters for
 *               {@link abbreviationSignal}; lower-cased internally for the
 *               other five features.
 * @param freq - English frequency rank map from `englishFreq.json`.
 * @returns Composite score. Compare against {@link COMPLEXITY_THRESHOLDS}
 *   (pending recalibration — see that constant's doc comment).
 */
export function scoreComplexity(word: string, freq: Map<string, number>): number {
  if (!/[a-zA-Z]/.test(word)) return 0 // no letters — punctuation/digit fragment

  const lower = word.toLowerCase()
  const f = getComplexityFeatures(lower, freq)
  const abbrev = abbreviationSignal(word) // needs original casing, not `lower`

  return (
    FITTED_WEIGHTS.intercept +
    FITTED_WEIGHTS.logRarity * safeLog(f.rarity) +
    FITTED_WEIGHTS.logSyllable * safeLog(f.syllable) +
    FITTED_WEIGHTS.logPrefix * safeLog(f.prefix) +
    FITTED_WEIGHTS.logSuffix * safeLog(f.suffix) +
    FITTED_WEIGHTS.logCluster * safeLog(f.cluster) +
    FITTED_WEIGHTS.abbreviationSignal * abbrev
  )
}

/**
 * Returns `true` when `word` should be treated as complex for a general
 * reader — i.e. {@link scoreComplexity} meets or exceeds the threshold for
 * `level`.
 *
 * This is the single decision function used by the underline pass
 * (`applyWordUnderlines` in `wordUnderlines.ts`).
 *
 * @param word  - Word to test, any casing — pass the word as it appears in
 *                the source text; don't pre-lowercase it, since casing now
 *                feeds {@link scoreComplexity}'s abbreviation signal.
 * @param freq  - English frequency rank map from `englishFreq.json`.
 * @param level - Complexity tier to test against. Defaults to `'medium'`.
 * @returns `true` if the word is complex enough to act on.
 */
export function isComplexWord(
  word: string,
  freq: Map<string, number>,
  level: ComplexityLevel = 'medium',
): boolean {
  return scoreComplexity(word, freq) >= COMPLEXITY_THRESHOLDS[level]
}