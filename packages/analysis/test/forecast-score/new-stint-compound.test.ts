// `forecast-score`'s compound after a stop (SP4.3b1 Task 11b, spec F8 cause 5; C25, C33): the compound a car left the
// pits on after its stop on lap n is the compound of the stint that starts on lap n + 1, not the compound of its lap
// n + 1 record. In F1 25 the out-lap record still carries the old set's compound (28 of 54 Spa stops, 20 of 21 Texas
// stops), so these races give every out-lap record (provisional and confirmed) the compound of the lap before it. The
// weather-crossover detection and an experiment's stop policy (P7) read the same new-stint compound.
import type { LapRecord, Policy } from '@pitwall/domain';
import { createRng, type Projection } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { naturalExperiments } from '../../src/forecast-score/experiments.ts';
import { prepareScore, run } from '../../src/forecast-score/job.ts';
import { raceLaps } from '../../src/forecast-score/laps.ts';
import { CONFIG, generated, plannedRace, spacedField, viewOf, type PlannedCar } from './support.ts';

/** `p` with every out-lap record carrying the compound of its car's record of the lap before (as F1 25 records it). */
function oldCompoundOnOutLaps(p: Projection): Projection {
  const before = new Map<string, Pick<LapRecord, 'visualCompound' | 'actualCompound'>>();
  for (const l of p.laps) before.set(`${l.carId}:${l.lapNumber}`, { visualCompound: l.visualCompound, actualCompound: l.actualCompound });
  const laps = p.laps.map((l) => {
    const prev = before.get(`${l.carId}:${l.lapNumber - 1}`);
    return l.outLap && prev !== undefined ? { ...l, ...prev } : l;
  });
  return { ...p, laps } as Projection;
}

/** The planned race of four cars 1.5 s apart, `over` merged per car, with the old compound on its out-lap records. */
function race(laps: number, over: Record<number, PlannedCar>) {
  const planned = plannedRace({ laps, cars: spacedField(4, 1_500, over) });
  return { planned, history: oldCompoundOnOutLaps(planned.history) };
}

describe('forecast-score: the compound after a stop is the new stint\'s (Task 11b)', () => {
  it('compoundAfter(car, n) gives the compound of the stint that starts after the stop at lap n, not the out-lap row\'s old compound', () => {
    // Car 1 starts on softs, stops on lap 6 onto mediums and on lap 12 onto hards.
    const { history } = race(18, { 1: { stops: [{ lap: 6, compound: 'medium' }, { lap: 12, compound: 'hard' }] } });
    const laps = raceLaps(history);
    // The out-lap records carry the old set's compound; the stints the new set's.
    expect(laps.lap(1, 7)?.visualCompound).toBe('soft');
    expect(laps.lap(1, 13)?.visualCompound).toBe('medium');
    expect(history.stints.filter((s) => s.carId === 1).map((s) => [s.firstLap, s.visualCompound])).toEqual([[1, 'soft'], [7, 'medium'], [13, 'hard']]);
    expect(laps.compoundAfter(1, 6)).toBe('medium');
    expect(laps.compoundAfter(1, 12)).toBe('hard');
  });

  it('the weather-crossover detection reads the same new-stint compound', () => {
    // Car 1 stops on lap 6 from softs onto inters: a weather crossover, though its out-lap record still says soft.
    const { planned, history } = race(12, { 1: { stops: [{ lap: 6, compound: 'inter' }] } });
    const laps = raceLaps(history);
    expect(laps.lap(1, 7)?.visualCompound).toBe('soft');
    expect(laps.crossover(1, 6)).toBe(true);
    expect(laps.dry(1, 5, 7)).toBe(false);
    // So the stop is no rejoin case, as on the race whose out-lap record carries the new compound.
    expect(naturalExperiments(planned.history, CONFIG).rejoin.filter((c) => c.carId === 1)).toEqual([]);
    expect(naturalExperiments(history, CONFIG).rejoin.filter((c) => c.carId === 1)).toEqual([]);
  });

  it("an experiment's stop policy uses the new set's compound", () => {
    // Car 1 stops on lap 6 onto mediums, car 3 on lap 8 onto hards; both out-lap records still say soft.
    const { planned, history } = race(14, { 1: { stops: [{ lap: 6, compound: 'medium' }] }, 3: { stops: [{ lap: 8, compound: 'hard' }] } });
    const first = naturalExperiments(history, CONFIG).rejoin.find((c) => c.carId === 1)!;
    const expected: Policy[] = [{ stops: [], triggers: [] }, { stops: [{ lap: 6, compound: 'medium' }], triggers: [] }, { stops: [], triggers: [] }, { stops: [{ lap: 8, compound: 'hard' }], triggers: [] }];
    expect(first.policy).toEqual(expected);
    // The same policy as on the race whose out-lap records carry the new compound.
    expect(naturalExperiments(planned.history, CONFIG).rejoin.find((c) => c.carId === 1)!.policy).toEqual(expected);
  });

  it('rewind: output equals a run without the undone frames (C33)', () => {
    // The small generator race (one stop each on laps 8 to 10, medium to hard) with the old compound on its out-lap
    // records; a flashback from the leader's lap 16 to its lap 13.
    const g = generated();
    const target = g.framesOfLap(13)[0]!;
    const undone = g.framesOfLap(16)[0]!;
    const at = viewOf(g, target);
    const never = run(structuredClone(prepareScore({ ...at, history: oldCompoundOnOutLaps(at.history) })), createRng(0));
    const rewound = { ...at, history: oldCompoundOnOutLaps(at.history), delta: g.viewAt(target, { from: undone }).delta };
    expect(rewound.delta.rewound).toBeDefined();
    expect(run(structuredClone(prepareScore(rewound)), createRng(0))).toEqual(never);
    // The experiments' policies on that race name the hard set, the compound each car left the pits on.
    const policies = naturalExperiments(oldCompoundOnOutLaps(at.history), CONFIG, at.situation).rejoin.flatMap((c) => c.policy.flatMap((p) => p.stops));
    expect(policies.length).toBeGreaterThan(0);
    expect(new Set(policies.map((s) => s.compound))).toEqual(new Set(['hard']));
  });
});
