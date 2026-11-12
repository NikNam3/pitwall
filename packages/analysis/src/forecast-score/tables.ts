// `forecast-score`'s tables (SP4.3a spec 7.1): scored cases, per driver type their number, mean absolute error and
// bias. No targets (S2).
import { known, unknown, type ScoreCase, type ScoreTable, type SessionTime } from '@pitwall/domain';

/** The summary of one driver type's cases; without a case its mean and bias are not known (C3). */
function summary(cases: readonly ScoreCase[], at: SessionTime): ScoreTable['ai'] {
  const n = cases.length;
  if (n === 0) return { n, meanAbs: unknown('insufficientData'), bias: unknown('insufficientData') };
  let abs = 0;
  let sum = 0;
  for (const c of cases) {
    abs += Math.abs(c.error);
    sum += c.error;
  }
  return { n, meanAbs: known(abs / n, at), bias: known(sum / n, at) };
}

/** A table of `cases`, split AI and human; `at` is when its newest fact was recorded. */
export function scoreTable(name: string, unit: ScoreTable['unit'], cases: ScoreCase[], at: SessionTime): ScoreTable {
  return {
    name,
    unit,
    ai: summary(cases.filter((c) => c.driver === 'ai'), at),
    human: summary(cases.filter((c) => c.driver === 'human'), at),
    cases,
  };
}

/** One scored case: `error` = actual − predicted. */
export const scored = (c: Omit<ScoreCase, 'error'>): ScoreCase => ({ ...c, error: c.actual - c.predicted });
