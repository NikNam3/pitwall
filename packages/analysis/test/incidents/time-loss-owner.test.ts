// `incidents`' time-loss entries and `driver-noise`'s human mistakes agree (SP4.3c Task 4, B6; C43, C45): both are
// `timeLossEvents` with `timeLossExcludedOf`'s exclusion, so the three cases of `../shared/time-loss-cases.ts` (a slow
// mini-sector under green, inside an SC span, inside the car's pit visit) give the same events in both. `incidents`
// runs through its guarded view (`run`, C41), `driver-noise` through its own (`humanModelOf`). The entry's
// `timeLostMs` is not compared: `incidents` takes it from `pace-delta` once lap records exist, its own presentation.
import { describe, expect, it } from 'vitest';
import { HUMAN, humanModelOf, SLOW_START, timeLossCase, type TimeLossCase } from '../shared/time-loss-cases.ts';
import { run } from './race.ts';

/** Car 7's time-loss entries of `incidents` in a case: where each starts and its lap. */
const incidentLosses = (kind: TimeLossCase) =>
  run(timeLossCase(kind))
    .filter((e) => e.kind === 'timeLoss' && e.carIds.includes(HUMAN))
    .map((e) => ({ at: e.at, lap: e.lap }));

describe('incidents and driver-noise: one time-loss rule (B6)', () => {
  it('under green: one time loss of the slow mini-sector in both', () => {
    expect(incidentLosses('green')).toEqual([{ at: SLOW_START, lap: 5 }]);
    expect(humanModelOf('green').mistakes).toBe(1);
  });

  it('inside an SC span and inside the pit visit: none in either', () => {
    for (const kind of ['sc', 'pitVisit'] as const) {
      expect(incidentLosses(kind), kind).toEqual([]);
      expect(humanModelOf(kind).mistakes, kind).toBe(0);
    }
  });

  it('per case, the count of time-loss entries equals the count of human mistakes', () => {
    for (const kind of ['green', 'sc', 'pitVisit'] as const) expect(incidentLosses(kind).length, kind).toBe(humanModelOf(kind).mistakes);
  });
});
