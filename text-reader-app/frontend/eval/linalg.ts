/**
 * @file eval/linalg.ts
 *
 * Minimal dependency-free linear algebra needed for ridge regression:
 * matrix transpose/multiply and Gauss-Jordan matrix inversion. Small and
 * intentionally naive — this fits a handful of features on a few thousand
 * rows, offline, once, not at runtime in the extension. Not meant for
 * anything bigger; reach for a real library if the feature count grows
 * much past what {@link fitComplexityWeights.ts} uses.
 */

export type Matrix = number[][]
export type Vector = number[]

export function transpose(a: Matrix): Matrix {
  if (a.length === 0) return []
  return a[0].map((_, col) => a.map(row => row[col]))
}

export function matMul(a: Matrix, b: Matrix): Matrix {
  const result: Matrix = []
  for (let i = 0; i < a.length; i++) {
    const row: number[] = []
    for (let j = 0; j < b[0].length; j++) {
      let sum = 0
      for (let k = 0; k < b.length; k++) sum += a[i][k] * b[k][j]
      row.push(sum)
    }
    result.push(row)
  }
  return result
}

export function matVecMul(a: Matrix, v: Vector): Vector {
  return a.map(row => row.reduce((sum, val, i) => sum + val * v[i], 0))
}

export function identity(n: number): Matrix {
  return Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  )
}

/**
 * Inverts a square matrix via Gauss-Jordan elimination with partial
 * pivoting.
 *
 * @throws if the matrix is singular. Shouldn't happen once ridge
 *   regularization is applied — that's precisely what the `+ lambda*I`
 *   term in {@link ridgeRegression} guards against. If you hit this with
 *   `lambda > 0`, two of your features are exactly collinear.
 */
export function invert(input: Matrix): Matrix {
  const n = input.length
  const a = input.map(row => [...row])
  const inv = identity(n)

  for (let col = 0; col < n; col++) {
    // Partial pivot: swap in the row with the largest value in this column
    let pivotRow = col
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivotRow][col])) pivotRow = row
    }
    if (Math.abs(a[pivotRow][col]) < 1e-12) {
      throw new Error(`Matrix is singular at column ${col} — try a larger ridge lambda.`)
    }
    ;[a[col], a[pivotRow]] = [a[pivotRow], a[col]]
    ;[inv[col], inv[pivotRow]] = [inv[pivotRow], inv[col]]

    const pivot = a[col][col]
    for (let j = 0; j < n; j++) {
      a[col][j] /= pivot
      inv[col][j] /= pivot
    }

    for (let row = 0; row < n; row++) {
      if (row === col) continue
      const factor = a[row][col]
      for (let j = 0; j < n; j++) {
        a[row][j] -= factor * a[col][j]
        inv[row][j] -= factor * inv[col][j]
      }
    }
  }

  return inv
}

/**
 * Ridge regression via the closed-form normal equations:
 * ```
 * w = (XᵀX + λR)⁻¹ Xᵀy
 * ```
 * where `R` is the identity matrix with row/column 0 zeroed out, so the
 * intercept term (assumed to be column 0 of `X`, always `1`) is never
 * shrunk — only the real feature weights are regularized toward zero.
 *
 * @param X      - Design matrix, one row per sample. Column 0 must be a
 *                 constant `1` for every row (the intercept column).
 * @param y      - Target vector, one value per sample.
 * @param lambda - Ridge regularization strength. `0` = ordinary least
 *                 squares (no shrinkage); higher = weights pulled toward 0.
 * @returns Weight vector, same length as a row of `X` (index 0 = intercept).
 */
export function ridgeRegression(X: Matrix, y: Vector, lambda: number): Vector {
  const Xt = transpose(X)
  const XtX = matMul(Xt, X)

  const n = XtX.length
  for (let i = 1; i < n; i++) XtX[i][i] += lambda // skip index 0 — never regularize the intercept

  const XtXInv = invert(XtX)
  const Xty = matVecMul(Xt, y)
  return matVecMul(XtXInv, Xty)
}

/** Applies a fitted weight vector to a design matrix: `ŷ = X · w`. */
export function predict(X: Matrix, w: Vector): Vector {
  return matVecMul(X, w)
}