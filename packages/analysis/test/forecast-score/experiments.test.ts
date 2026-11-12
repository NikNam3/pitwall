// `forecast-score`'s natural experiments on planned builder races (SP4.3a spec 7.1, plan Task 19 rows 1–4 and 13):
// which stops and pairs are cases, the frame each is predicted from, what it measures, and the stops the other cars
// follow (P7). The scored half (predicted against actual) is in `job.test.ts`.
import { carId, type CarId } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import { naturalExperiments, type Case } from '../../src/forecast-score/experiments.ts';
import { CONFIG, plannedRace, spacedField } from './support.ts';

const others = (cases: readonly Case[], car: number): CarId[] =>
  cases.filter((c) => c.carId === car).map((c) => c.otherCarId!).sort((a, b) => a - b);

describe('forecast-score natural experiments', () => {
  it('rejoin case on a builder stop: predicted vs actual position', () => {
    // Four cars 1.5 s apart; car 1 stops at the end of lap 6 and loses 22 s: cars 2 and 3 pass it.
    const race = plannedRace({ laps: 12, cars: spacedField(4, 1_500, { 1: { stops: [{ lap: 6 }] } }) });
    const { rejoin, undercut, scStop } = naturalExperiments(race.history, CONFIG);
    expect(rejoin).toHaveLength(1);
    const [c] = rejoin;
    expect(c).toMatchObject({ kind: 'rejoin', carId: carId(1), predictFrame: race.lapOf(1, 5).frame });
    expect(c!.otherCarId).toBeUndefined();
    // Measured at the first crossing after the out lap: the end of lap 7.
    expect(c!.measure(race.history)).toBe(race.lapOf(1, 7).positionAtEnd);
    expect(c!.measure(race.history)).toBe(4);
    expect(undercut).toEqual([]);
    expect(scStop).toEqual([]);
  });

  it('a 7 s stationary stop and a penalty stop are no rejoin case', () => {
    const race = plannedRace({
      laps: 12,
      cars: spacedField(4, 1_500, { 1: { stops: [{ lap: 6, stationaryMs: 7_000 }] }, 2: { stops: [{ lap: 8, penaltyServed: true }] } }),
    });
    expect(naturalExperiments(race.history, CONFIG).rejoin).toHaveLength(0);
  });

  it('undercut: within 3 s, 1–5 laps apart, no SC between; a 6-lap pair and an SC-split pair are excluded', () => {
    // Three pairs, each 1 s apart and 9 s from the next: cars 0 and 1 stop on laps 6 and 8 (counted); cars 2 and 3 on
    // laps 6 and 12 (6 laps apart); cars 4 and 5 on laps 13 and 16 with an SC between (leader laps 14 and 15).
    const race = plannedRace({
      laps: 20,
      cars: [
        { gridOffsetMs: 0, stops: [{ lap: 6 }] },
        { gridOffsetMs: 1_000, stops: [{ lap: 8, stationaryMs: 4_000 }] },
        { gridOffsetMs: 10_000, stops: [{ lap: 6 }] },
        { gridOffsetMs: 11_000, stops: [{ lap: 12 }] },
        { gridOffsetMs: 20_000, stops: [{ lap: 13 }] },
        { gridOffsetMs: 21_000, stops: [{ lap: 16 }] },
      ],
      neutralisation: { fromMs: 1_250_000, toMs: 1_400_000 },
    });
    const { undercut } = naturalExperiments(race.history, CONFIG);
    expect(undercut).toHaveLength(1);
    const [c] = undercut;
    expect(c).toMatchObject({ kind: 'undercut', carId: carId(0), otherCarId: carId(1), predictFrame: race.lapOf(0, 5).frame });
    // The change of their gap from the first stopper's in-lap crossing (end of lap 5) to after the second car's out
    // lap (end of lap 9): car 1's stop stood 1.5 s longer.
    expect(c!.measure(race.history)).toBe(race.gapAt(0, 1, 9) - race.gapAt(0, 1, 5));
    expect(c!.measure(race.history)).toBe(1_500);
  });

  it('SC stop: cars within ±3 places that stayed out, measured 2 laps after the SC ends', () => {
    // Eight cars 1.1 s apart; an SC from 820 s to 1,050 s; car 3 stops under it on lap 10 (P4 at the end of lap 9),
    // car 6 on lap 11 (P6 at the end of lap 10, car 3 now P8).
    const race = plannedRace({
      laps: 16,
      cars: spacedField(8, 1_100, { 3: { stops: [{ lap: 10 }] }, 6: { stops: [{ lap: 11 }] } }),
      neutralisation: { fromMs: 820_000, toMs: 1_050_000 },
    });
    const { scStop } = naturalExperiments(race.history, CONFIG);
    // Car 6 stopped during the neutralisation too: no car that stayed out for car 3, and car 3 none for car 6.
    expect(others(scStop, 3)).toEqual([0, 1, 2, 4, 5]);
    expect(others(scStop, 6)).toEqual([2, 4, 5, 7]);
    expect(scStop).toHaveLength(9);
    const c = scStop.find((s) => s.carId === 3 && s.otherCarId === 0)!;
    expect(c).toMatchObject({ kind: 'scStop', predictFrame: race.lapOf(3, 9).frame });
    // Car 3's first lap completed after the SC ends is lap 12: the change is measured at the end of lap 14.
    expect(race.completedAt(3, 11)).toBeLessThan(1_050_000);
    expect(race.completedAt(3, 12)).toBeGreaterThan(1_050_000);
    expect(c.measure(race.history)).toBe(race.gapAt(3, 0, 14) - race.gapAt(3, 0, 9));
  });

  it("an experiment's other cars follow their actual stops", () => {
    // Car 1 stops on lap 6 onto mediums; car 3, a third car, on lap 8 onto hards, inside car 1's horizon (P7).
    const race = plannedRace({
      laps: 14,
      cars: spacedField(4, 1_500, { 1: { stops: [{ lap: 6, compound: 'medium' }] }, 3: { stops: [{ lap: 8, compound: 'hard' }] } }),
    });
    const { rejoin } = naturalExperiments(race.history, CONFIG);
    const first = rejoin.find((c) => c.carId === 1)!;
    expect(first.policy).toEqual([{ stops: [], triggers: [] }, { stops: [{ lap: 6, compound: 'medium' }], triggers: [] }, { stops: [], triggers: [] }, { stops: [{ lap: 8, compound: 'hard' }], triggers: [] }]);
    // Car 3's case is predicted at the end of its lap 7: car 1's stop is made by then, and so no policy's.
    const second = rejoin.find((c) => c.carId === 3)!;
    expect(second.policy).toEqual([{ stops: [], triggers: [] }, { stops: [], triggers: [] }, { stops: [], triggers: [] }, { stops: [{ lap: 8, compound: 'hard' }], triggers: [] }]);
  });
});
