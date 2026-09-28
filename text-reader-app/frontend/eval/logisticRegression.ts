/**
 * @file eval/logisticRegression.ts
 *
 * Minimal L2-regularized logistic regression via batch gradient descent.
 * Same Matrix/Vector shapes as eval/linalg.ts's ridgeRegression, but for a
 * binary target — used by fitKeywordWeights.ts to predict candidate-is-a-
 * gold-keyphrase-match instead of a continuous complexity rating.
 */

import type { Matrix, Vector } from './linalg'

function sigmoid(z: number): number {
  if (z >= 0) {
    const e = Math.exp(-z)
    return 1 / (1 + e)
  }
  const e = Math.exp(z)
  return e / (1 + e)
}

/**
 * Fits weights via batch gradient descent with L2 regularization.
 * The intercept (X's first column, all 1s) is never penalized — same
 * convention as ridgeRegression.
 *
 * @param X - Design matrix, one row per example, first column all 1s.
 * @param y - Binary labels (0 or 1).
 * @param lambda - L2 penalty strength.
 * @param iterations - Gradient descent steps.
 * @param learningRate - Step size; lower this if the loss diverges/NaNs.
 */
export function logisticRegression(
  X: Matrix,
  y: Vector,
  lambda: number,
  iterations = 2000,
  learningRate = 0.1,
): Vector {
  const n = X.length
  const d = X[0].length
  const w: Vector = new Array(d).fill(0)

  for (let iter = 0; iter < iterations; iter++) {
    const grad: Vector = new Array(d).fill(0)
    for (let i = 0; i < n; i++) {
      const z = X[i].reduce((acc, x, j) => acc + x * w[j], 0)
      const err = sigmoid(z) - y[i]
      for (let j = 0; j < d; j++) grad[j] += err * X[i][j]
    }
    for (let j = 0; j < d; j++) {
      const reg = j === 0 ? 0 : lambda * w[j]
      w[j] -= learningRate * (grad[j] / n + reg)
    }
  }
  return w
}