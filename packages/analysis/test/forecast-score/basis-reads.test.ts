// `forecast-score`'s job declares `decisions` (SP4.3e Task 7a-2, round 2; C41, C51, C62, spec §4.2): its `prepare`
// hands `view.basis` to the forecast units, and `view.basis` follows the projection's newest `basisChosen` decision, so
// the job trigger declares `decisions` in its `reads` (C62).
import { describe, expect, it } from 'vitest';
import { FORECAST_SCORE_JOB } from '../../src/forecast-score/index.ts';

describe('forecast-score reads view.basis (C62)', () => {
  it('the job trigger declares decisions in its reads', () => {
    expect(FORECAST_SCORE_JOB.reads).toContain('decisions');
  });
});
