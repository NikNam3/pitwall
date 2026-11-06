// `raising-average` (spec 3.1, V08): per car the `forPace` laps (`lap-classes`) sorted ascending, point X the mean of the
// first X, rounded to integer ms; every car, rivals included; each lap's current record (C25). Builder data; every case
// runs through the guarded view (C41). Its behaviour table (C44) is checked by the generic completeness test.
import { carId, type LapRecord } from '@pitwall/domain';
import type { EngineView } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { RAISING_AVERAGE, type RaisingAverageOutput } from '../../src/raising-average/index.ts';
import { raisingAverageCalculator } from '../../src/raising-average/calculator.ts';
import { carState, lap } from '../../../../test-support/builders/index.ts';
import { guardedQuick, PRACTICE, situatedView } from '../situated.ts';

const calc = guardedQuick(raisingAverageCalculator);

/** The projection holding `laps`; car 0 in the session unless `cars` says otherwise; a race unless `phase` says otherwise. */
const view = (o: Parameters<typeof situatedView>[0] & { laps: LapRecord[] }): EngineView => {
  const { laps, history = {}, cars = [carState()], ...rest } = o;
  return situatedView({ cars, history: { laps, ...history }, ...rest });
};

/** Lap `n` of car `car` at `ms`, with any overrides. */
const at = (n: number, ms: number, over: Partial<LapRecord> = {}, car = 0): LapRecord => lap({ carId: carId(car), lapNumber: n, lapTimeMs: ms, ...over });

const run = (v: EngineView): RaisingAverageOutput => calc.compute(v);

describe('raising-average', () => {
  it('is the quick analysis `raising-average` per frame over laps and the weekend phase', () => {
    expect(raisingAverageCalculator.id).toBe(RAISING_AVERAGE);
    expect(raisingAverageCalculator.kind).toBe('quick');
    expect(raisingAverageCalculator.cadence).toBe('frame');
    expect(raisingAverageCalculator.reads).toEqual(expect.arrayContaining(['laps', 'spans:weekend-phase']));
  });

  it('1: one car with forPace laps 90 100, 90 300, 90 200 gives the means of its best 1, 2, 3', () => {
    const out = run(view({ laps: [at(2, 90_100), at(3, 90_300), at(4, 90_200)] }));
    expect(out).toEqual({ cars: [{ carId: carId(0), laps: 3, pointsMs: [90_100, 90_150, 90_200] }] });
  });

  it('2: in, out, invalid and neutralised laps are left out; lap 1 of a race is, lap 1 of a practice session is not', () => {
    const race = [
      at(1, 89_000), // lap 1 of a race: no pace lap
      at(2, 89_100, { inLap: true }),
      at(3, 89_200, { outLap: true }),
      at(4, 89_300, { valid: { lap: false, sectors: [true, false, true] } }),
      at(5, 89_400, { scShare: 0.5 }), // 44.7 s under SC
      at(6, 89_500, { vscShare: 0.5 }), // 44.75 s under VSC
      at(7, 90_000),
      at(8, 90_500),
    ];
    expect(run(view({ laps: race }))).toEqual({ cars: [{ carId: carId(0), laps: 2, pointsMs: [90_000, 90_250] }] });

    const practice = [at(1, 89_000), at(2, 90_000)];
    expect(run(view({ laps: practice, phase: PRACTICE }))).toEqual({ cars: [{ carId: carId(0), laps: 2, pointsMs: [89_000, 89_500] }] });
  });

  it('3: a car with only an out lap has an empty curve', () => {
    const out = run(view({ laps: [at(2, 95_000, { outLap: true })] }));
    expect(out).toEqual({ cars: [{ carId: carId(0), laps: 0, pointsMs: [] }] });
  });

  it('4: a provisional lap 5 at 91 000 superseded by its confirmed record at 90 900 is counted once, at 90 900', () => {
    const laps = [at(4, 90_000), at(5, 91_000, { status: 'provisional' }), at(5, 90_900, { supersedes: { list: 'laps', index: 1 } })];
    expect(run(view({ laps }))).toEqual({ cars: [{ carId: carId(0), laps: 2, pointsMs: [90_000, 90_450] }] });
  });

  it('5: two cars give two curves by car id, rivals included', () => {
    // the rival (car 3) first in the log; the curves come by car id
    const laps = [at(2, 91_000, {}, 3), at(2, 90_000), at(3, 91_400, {}, 3), at(3, 90_200)];
    const out = run(view({ laps, cars: [carState(), carState({ id: carId(3) })] }));
    expect(out).toEqual({
      cars: [
        { carId: carId(0), laps: 2, pointsMs: [90_000, 90_100] },
        { carId: carId(3), laps: 2, pointsMs: [91_000, 91_200] },
      ],
    });
  });

  it('6: means are rounded to integer ms', () => {
    // best 3: (90 000 + 90 002 + 90 003) / 3 = 90 001.67 → 90 002
    const out = run(view({ laps: [at(2, 90_003), at(3, 90_000), at(4, 90_002)] }));
    expect(out).toEqual({ cars: [{ carId: carId(0), laps: 3, pointsMs: [90_000, 90_001, 90_002] }] });
    for (const p of out.cars[0]!.pointsMs) expect(Number.isInteger(p)).toBe(true);
  });
});
