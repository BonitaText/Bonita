/**
 * @file eval/evalUtils.ts
 *
 * Small shared helpers for the eval scripts: a seeded RNG (so "random"
 * baselines and bootstraps are reproducible), a string hash, and a generic
 * bootstrap confidence interval.
 */

/** Deterministic PRNG. Same seed -> same sequence. Returns floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed | 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Simple string -> int hash, used to derive a per-document RNG seed. */
export function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/**
 * Bootstrap a statistic over `n` items. `stat` receives an array of resampled
 * indices (with replacement) and returns a number. Returns the 95% percentile
 * interval. Use it for *paired* comparisons by having `stat` compute the
 * difference between two methods on the same resampled indices.
 */
export function bootstrapCI(
  n: number,
  stat: (idx: number[]) => number,
  iters = 1000,
  seed = 1,
): { lo: number; hi: number } {
  const rand = mulberry32(seed)
  const vals: number[] = []
  for (let it = 0; it < iters; it++) {
    const idx = Array.from({ length: n }, () => Math.floor(rand() * n))
    vals.push(stat(idx))
  }
  vals.sort((a, b) => a - b)
  return { lo: vals[Math.floor(0.025 * iters)], hi: vals[Math.min(iters - 1, Math.floor(0.975 * iters))] }
}