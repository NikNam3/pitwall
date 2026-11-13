// `forecast-score`'s forecast cases and the stops a forecast table's rivals follow (SP4.3a spec 7.1, plan Task 19
// rows 5, 6 and 13), and the dry-laps rule of every kind on a generator rain race.
import { carId, known, unknown, type RivalStop, type RivalStops } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import { naturalExperiments } from '../../src/forecast-score/experiments.ts';
import { forecastCases, forecastPolicies, type Horizon } from '../../src/forecast-score/forecasts.ts';
import { CONFIG, generated, plannedRace, SMALL, spacedField, withAppendFrames } from './support.ts';

const HORIZONS: readonly Horizon[] = [1, 3, 5, 10];

describe('forecast-score forecast cases', () => {
  it('forecast horizons 1, 3, 5, 10 with the gaps-stay baseline', () => {
    // Three cars 1 s apart, 20 laps; car 0 stops on lap 10 and drops to P3; car 2's wear is hidden (realism).
    const race = plannedRace({ laps: 20, cars: spacedField(3, 1_000, { 0: { stops: [{ lap: 10 }] }, 2: { wearHidden: true } }) });
    const cases = forecastCases(race.history, HORIZONS);
    // Ported in Task 11e (U9 Q1 A): no case from leader laps 1 and 2 (minPredictLap 3), and none of car 0 whose horizon
    // holds its own in-lap 10 or out-lap 11 (start laps 10 − h to 10).
    for (const h of HORIZONS) {
      const of = cases.filter((c) => c.horizon === h);
      // Every leader lap L ≥ 3 whose lap L + h every car completed: L = 3 .. 20 − h, cars 1 and 2 each, and car 0's.
      const car0 = Array.from({ length: 18 - h }, (_, i) => 3 + i).filter((l) => l < 10 - h || l > 10).length;
      expect(of, `horizon ${h}`).toHaveLength(2 * (18 - h) + car0);
      expect(Math.max(...of.map((c) => c.lap)), `horizon ${h}`).toBe(20 - h);
    }
    // Horizon 10 has no case for the last 9 laps (nor for lap 11, whose lap 21 never comes).
    expect(cases.filter((c) => c.horizon === 10 && c.lap > 10)).toEqual([]);
    for (const c of cases) {
      const leader = race.history.laps.find((l) => l.lapNumber === c.lap && l.positionAtEnd === 1)!;
      const target = race.lapOf(c.carId, c.lap + c.horizon);
      expect(c.targetLap).toBe(c.lap + c.horizon);
      expect(c.predictFrame).toBe(leader.frame);
      expect(c.actualLapTimeMs).toBe(target.lapTimeMs);
      expect(c.actualPosition).toBe(target.positionAtEnd);
      // "Gaps stay as they are": the car's place at the end of lap L.
      expect(c.baselinePosition).toBe(race.lapOf(c.carId, c.lap).positionAtEnd);
      expect(c.basis).toBe(c.carId === 2 ? 'age' : 'wear');
    }
    // Car 0's stop on lap 10 (Task 11e: its own case is left out): from lap 9 the baseline keeps car 1 P2, the race puts
    // it P1 at lap 12.
    expect(cases.find((c) => c.carId === 0 && c.lap === 9 && c.horizon === 3)).toBeUndefined();
    expect(cases.find((c) => c.carId === 1 && c.lap === 9 && c.horizon === 3)).toMatchObject({ baselinePosition: 2, actualPosition: 1 });
  });

  it('wet laps and weather crossovers are excluded', () => {
    // The generator's small race in the rain from lap 12: every car stops on lap 6 onto hards (dry) and on lap 12 onto
    // inters (the crossover); laps 13 to 20 are wet.
    const params = { ...SMALL, rain: { fromLap: 12, wetnessMs: 4_000 }, field: SMALL.field.map((car) => ({ ...car, stops: [{ lap: 6, compound: 'hard' as const }, { lap: 12, compound: 'inter' as const }] })) };
    const race = generated(params);
    const h = withAppendFrames(race.viewAt(race.lastFrame).history);
    const cases = forecastCases(h, HORIZONS);
    expect(cases.length).toBeGreaterThan(0);
    // No case reaches the crossover's in lap or the wet laps after it.
    expect(cases.filter((c) => c.targetLap >= 12)).toEqual([]);
    const { rejoin, undercut, scStop } = naturalExperiments(h, CONFIG);
    // The dry stops only: one per car, each predicted at the car's own lap-5 record.
    expect(rejoin).toHaveLength(SMALL.cars);
    for (const c of rejoin) {
      const lap5 = h.laps.find((l) => l.carId === c.carId && l.lapNumber === 5 && l.status === 'confirmed')!;
      expect(c.predictFrame, `car ${c.carId}`).toBe(lap5.frame);
    }
    expect(undercut).toEqual([]);
    expect(scStop).toEqual([]);
  });
});

describe('forecast-score policies', () => {
  const stop = (over: Partial<RivalStop>): RivalStop => ({
    owesStop: known(true, 0),
    window: known({ lowLap: 10, midLap: 12, highLap: 14, toFlag: false }, 0),
    nextCompound: known({ hard: 0.7, medium: 0.3 }, 0),
    basis: 'peers',
    ...over,
  });

  it("a forecast table's rivals follow rival-stops", () => {
    // Car 0: its window's middle lap onto its likeliest compound; car 1 to the flag; car 2 without a window; car 3
    // without known odds; car 4 the likeliest of three.
    const stops: RivalStops = {
      [carId(0)]: stop({}),
      [carId(1)]: stop({ window: known({ lowLap: 30, midLap: 30, highLap: 30, toFlag: true }, 0), basis: 'noStop' }),
      [carId(2)]: stop({ window: unknown('insufficientData') }),
      [carId(3)]: stop({ nextCompound: unknown('insufficientData') }),
      [carId(4)]: stop({ window: known({ lowLap: 18, midLap: 20, highLap: 22, toFlag: false }, 0), nextCompound: known({ soft: 0.2, medium: 0.5, hard: 0.3 }, 0) }),
    };
    expect(forecastPolicies(stops, 6)).toEqual([
      { stops: [{ lap: 12, compound: 'hard' }], triggers: [] },
      { stops: [], triggers: [] },
      { stops: [], triggers: [] },
      { stops: [], triggers: [] },
      { stops: [{ lap: 20, compound: 'medium' }], triggers: [] },
      // Car 5 has no entry: no stop.
      { stops: [], triggers: [] },
    ]);
  });
});
