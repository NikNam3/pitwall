// `forecast-score`'s CRPS (SP4.3b spec §8.4; SP4.3b1 Task 22): for whole places, the ranked probability score.
// Stub of the test phase (C82): the implement phase writes it.

/**
 * The ranked probability score of `pmf` (P(P1) … P(Pn)) against the place `actual` (1-based): the sum over places of
 * the squared difference of the predicted and the actual cumulative distributions.
 */
export function rankedProbabilityScore(pmf: readonly number[], actual: number): number {
  void pmf;
  void actual;
  throw new Error('not implemented');
}
