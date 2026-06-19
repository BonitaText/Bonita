/**
 * @file content/utils/wordSimplifier.ts
 *
 * Composite reading-complexity scorer for single English words.
 *
 * A word's difficulty is estimated as the product of several independent
 * signals — corpus rarity, syllable count, Latinate morphology, and rare
 * consonant clusters — rather than any single heuristic. The result is a
 * continuous score compared against {@link COMPLEXITY_THRESHOLDS} to decide
 * whether a word is "complex enough" to act on (currently: underline +
 * synonym/definition popup, see `wordUnderlines.ts`).
 *
 * This module has no DOM dependency and no dictionary of substitute words —
 * it is purely a scoring function over a word string and a frequency map.
 */

// ─── Complexity scoring ───────────────────────────────────────────────────────

/**
 * Minimum composite score a word must reach to be considered complex enough
 * to underline.
 *
 * - Lower (e.g. `low`) → more words underlined.
 * - Higher (e.g. `high`) → only the most obviously difficult vocabulary.
 */
export const COMPLEXITY_THRESHOLDS = {
  low: 1.3,
  medium: 1.6, // balanced
  high: 2, // strictest
} as const

export type ComplexityLevel = keyof typeof COMPLEXITY_THRESHOLDS

/**
 * The score above which a word gets the full popup (synonyms + definition).
 * Words between the tier threshold and this value get the lite popup
 * (≤2 synonyms, no definition, dashed underline).
 */
export const HIGH_CONFIDENCE_THRESHOLD = 1.5

/**
 * Latinate / borrowed prefixes that signal academic or technical register,
 * paired with a complexity multiplier. Tested longest-first so that a more
 * specific prefix wins over a shorter one (e.g. "inter" before "in").
 *
 * Only the first matching prefix applies — no stacking with suffixes, though
 * the two multipliers are multiplied together in {@link scoreComplexity}.
 */
const MORPH_PREFIXES: ReadonlyArray<readonly [string, number]> = [
  // High signal — Greek/Latin combining forms rarely seen outside academia
  ['psycho', 1.4],
  ['neuro', 1.4],
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
 * Returns a rarity multiplier for `word` based on its English frequency rank.
 * Mirrors the `rarityBonus` logic in `phraseExtractor.ts` so both modules
 * stay in sync if frequency bands are ever recalibrated.
 *
 * | Rank range    | Multiplier |
 * |---------------|------------|
 * | ≤ 1 000       | 1.0        |
 * | 1 001–5 000   | 1.2        |
 * | 5 001–10 000  | 1.3        |
 * | 10 001–20 000 | 1.6        |
 * | > 20 000      | 2.0        |
 * | Not in map    | 1.3        |
 *
 * @param word - Lower-case word to look up.
 * @param freq - English frequency rank map (`word → rank`) from
 *               `englishFreq.json`, loaded by the caller via `getFreqMap()`.
 * @returns Rarity multiplier in [1.0, 2.0].
 */
function rarityScore(word: string, freq: Map<string, number>): number {
  const rank = freq.get(word)
  if (rank === undefined) return 2
  if (rank <= 1_000) return 1.0
  if (rank <= 5_000) return 1.2
  if (rank <= 10_000) return 1.3
  if (rank <= 20_000) return 1.4
  return 1.5
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

/**
 * Computes the composite reading-complexity score for a single word.
 *
 * ```
 * score = rarityScore × syllableScore × morphScore × prefixScore × clusterScore
 * ```
 *
 * Each factor is independent and multiplicative:
 * - {@link rarityScore}   — how uncommon the word is in general English
 * - {@link syllableScore} — proxy for decoding difficulty
 * - {@link morphScore}    — Latinate/formal suffixes signal academic register
 * - {@link prefixScore}   — Latinate/Greek prefixes signal technical register
 * - {@link clusterScore}  — rare consonant clusters signal phonological opacity
 *
 * `pageFrequency` is intentionally absent — a complex word that appears many
 * times in a technical article is still complex for a general reader. MeSH,
 * NER, and pattern bonuses are also excluded because they rank topical
 * importance, not reading difficulty.
 *
 * Words shorter than 2 characters always return `0` (single letters and
 * punctuation fragments are never complex).
 *
 * @param word - Word to score, any casing — normalised to lower-case internally.
 * @param freq - English frequency rank map from `englishFreq.json`.
 * @returns Composite score ≥ 0. Compare against {@link COMPLEXITY_THRESHOLDS}.
 */
export function scoreComplexity(word: string, freq: Map<string, number>): number {
  const lower = word.toLowerCase()
  if (lower.length < 2) return 0
  return (
    rarityScore(lower, freq) *
    syllableScore(countSyllables(lower)) *
    morphScore(lower) *
    prefixScore(lower) *
    clusterScore(lower)
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
 * @param word  - Word to test, any casing.
 * @param freq  - English frequency rank map from `englishFreq.json`.
 * @param level - Complexity tier to test against. Defaults to `'medium'`.
 * @returns `true` if the word is complex enough to act on.
 */
export function isComplexWord(
  word: string,
  freq: Map<string, number>,
  level: ComplexityLevel = 'medium',
): boolean {
  const lower = word.toLowerCase()
  return scoreComplexity(lower, freq) >= COMPLEXITY_THRESHOLDS[level]
}