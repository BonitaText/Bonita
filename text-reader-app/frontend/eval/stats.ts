/**
 * @file eval/stats.ts
 *
 * Small, dependency-free statistics helpers for scoring predictions against
 * a human gold standard. No npm packages needed — these are ~10 lines each.
 */

export function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length
}

/** Pearson correlation coefficient. Sensitive to linear relationship + scale. */
export function pearson(xs: number[], ys: number[]): number {
  if (xs.length !== ys.length || xs.length === 0) {
    throw new Error('pearson: xs and ys must be same non-zero length')
  }
  const mx = mean(xs)
  const my = mean(ys)
  let num = 0
  let dx2 = 0
  let dy2 = 0
  for (let i = 0; i < xs.length; i++) {
    const dx = xs[i] - mx
    const dy = ys[i] - my
    num += dx * dy
    dx2 += dx * dx
    dy2 += dy * dy
  }
  return num / Math.sqrt(dx2 * dy2)
}

/** Fractional (average) rank, with ties handled by averaging tied ranks. */
function rank(xs: number[]): number[] {
  const idx = xs.map((_, i) => i).sort((a, b) => xs[a] - xs[b])
  const ranks = new Array<number>(xs.length)
  let i = 0
  while (i < idx.length) {
    let j = i
    while (j + 1 < idx.length && xs[idx[j + 1]] === xs[idx[i]]) j++
    const avgRank = (i + j) / 2 + 1
    for (let k = i; k <= j; k++) ranks[idx[k]] = avgRank
    i = j + 1
  }
  return ranks
}

/**
 * Spearman rank correlation. Scale-invariant — this is the metric that
 * matters most for a heuristic scorer like yours, since it only asks
 * "does your score go up when human difficulty goes up?", not "are the
 * units the same?".
 */
export function spearman(xs: number[], ys: number[]): number {
  return pearson(rank(xs), rank(ys))
}

/** Mean absolute error. Only meaningful when pred and truth share units/scale. */
export function mae(pred: number[], truth: number[]): number {
  if (pred.length !== truth.length || pred.length === 0) {
    throw new Error('mae: pred and truth must be same non-zero length')
  }
  let sum = 0
  for (let i = 0; i < pred.length; i++) sum += Math.abs(pred[i] - truth[i])
  return sum / pred.length
}

/** Root mean squared error — penalizes large misses more than MAE does. */
export function rmse(pred: number[], truth: number[]): number {
  if (pred.length !== truth.length || pred.length === 0) {
    throw new Error('rmse: pred and truth must be same non-zero length')
  }
  let sum = 0
  for (let i = 0; i < pred.length; i++) sum += (pred[i] - truth[i]) ** 2
  return Math.sqrt(sum / pred.length)
}

/**
 * Ordinary least-squares fit of ys ~ slope * xs + intercept.
 * Used to calibrate your unbounded multiplicative score onto the 0-1 human
 * scale before computing MAE/RMSE, so the error numbers are apples-to-apples.
 * Fit this on a held-out TRAIN split, then apply it to the TEST split.
 */
export function linearFit(xs: number[], ys: number[]): { slope: number; intercept: number } {
  const mx = mean(xs)
  const my = mean(ys)
  let num = 0
  let den = 0
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i] - mx) * (ys[i] - my)
    den += (xs[i] - mx) ** 2
  }
  const slope = den === 0 ? 0 : num / den
  const intercept = my - slope * mx
  return { slope, intercept }
}