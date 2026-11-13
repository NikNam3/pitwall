// `forecast-score`'s CRPS (SP4.3b spec §8.4; SP4.3b1 Task 22): for whole places, the ranked probability score of the
// field's position pmf (`race-monte-carlo`'s `fieldPositions`) against the place the car had, per driver type the mean.
import { known, unknown, type SessionTime, type Summary } from '@pitwall/domain';

/**
 * The ranked probability score of `pmf` (P(P1) … P(Pn)) against the place `actual` (1-based): the sum over places of
 * the squared difference of the predicted and the actual cumulative distributions.
 */
export function rankedProbabilityScore(pmf: readonly number[], actual: number): number {
  let cumulative = 0;
  let score = 0;
  for (let k = 0; k < pmf.length; k++) {
    cumulative += pmf[k] ?? 0;
    const d = cumulative - (k + 1 >= actual ? 1 : 0);
    score += d * d;
  }
  return score;
}

/**
 * One driver type's CRPS summary: the number of scores and their mean (`meanAbs`; a score is never negative). The bias
 * of a score has no meaning, so it is not applicable; without a score the mean is not known (C3).
 */
export function crpsSummary(scores: readonly number[], at: SessionTime): Summary {
  const n = scores.length;
  if (n === 0) return { n, meanAbs: unknown('insufficientData'), bias: unknown('notApplicable') };
  let sum = 0;
  for (const s of scores) sum += s;
  return { n, meanAbs: known(sum / n, at), bias: unknown('notApplicable') };
}
