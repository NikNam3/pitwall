// `race-forecast` (SP4.3a spec 6.3, Task 18): the field to the flag under one scenario and one policy per car (C50),
// its draws only from the injected generator (C2). Starting points are built by hand (`start.ts`, which also states
// how these tests read the starting point and the result); row 6 checks the plain forecast against a race of the
// test-race generator (spec 6.4), which is written independently of the simulator.
import { NOISE_COMPOUNDS, type Policy, type StartingPoint } from '@pitwall/domain';
import { createRng } from '@pitwall/engine/readers';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { raceForecast, SIMULATOR } from '../../src/race-forecast/index.ts';
import { generateRace, GENERATOR_DEFAULTS, type GeneratorParams } from '../../../../test-support/race-generator/index.ts';
import { drawn, interaction, LAP_MODEL, noStops, NOISY, PACE_MS, PLAIN, plainWith, startingPoint, traceAt, type CarSpec } from './start.ts';

const run = (start: StartingPoint, policies: readonly Policy[], scenario = PLAIN, toLap?: number) =>
  raceForecast(start, policies, scenario, createRng(42), { trace: true, ...(toLap !== undefined && { toLap }) });

const range = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, i) => from + i);

describe('race-forecast: the simulator marker', () => {
  it("exports SIMULATOR = defineSimulator('race-forecast')", () => {
    expect(SIMULATOR).toEqual({ kind: 'simulator', name: 'race-forecast' });
  });
});

describe('race-forecast: the field', () => {
  // row 1
  it('no stops and equal pace keep the gaps', () => {
    const gaps = [0, 1_800, 4_000, 6_500, 9_200, 12_000];
    const start = startingPoint({ lap: 5, lapsTotal: 30, cars: gaps.map((gapMs) => ({ gapMs })) });
    const r = run(start, noStops(gaps.length), PLAIN, 14);
    gaps.forEach((g, car) => {
      expect(Math.abs(r.gapMs[car]! - g)).toBeLessThanOrEqual(1);
      expect(r.position[car]).toBe(car + 1);
    });
  });

  // row 2
  it('a pass chance of 0 means no pass; the chance never falls as the advantage grows', () => {
    // cap 0: each car 1 s a lap faster than the one ahead and held at the minimum gap behind it
    const held: CarSpec[] = [
      { gapMs: 0, paceMs: 91_000 },
      { gapMs: 500, paceMs: 90_000 },
      { gapMs: 1_000, paceMs: 89_000 },
    ];
    const capped = startingPoint({ lap: 3, lapsTotal: 20, cars: held.map((c) => ({ ...c, paceSdMs: 150, sigmaMs: 200, rho: 0.3 })), interaction: interaction({ curve: { cap: 0 } }) });
    for (const scenario of [PLAIN, ...range(1, 50).map((id) => drawn(id))]) {
      const r = raceForecast(capped, noStops(3), scenario, createRng(scenario.id), { trace: true });
      for (const t of r.trace!) expect(Array.from(t.position)).toEqual([1, 2, 3]);
      expect(Array.from(r.position)).toEqual([1, 2, 3]);
    }

    // the plain pass lap of a car held at the minimum gap: never later for a larger pace advantage
    const passLap = (advantageMs: number): number => {
      const start = startingPoint({ lap: 3, lapsTotal: 40, cars: [{ gapMs: 0, paceMs: PACE_MS + advantageMs }, { gapMs: 500, paceMs: PACE_MS }] });
      const r = run(start, noStops(2));
      return r.trace!.find((t) => t.position[1] === 1)?.lap ?? Infinity;
    };
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2_000 }), fc.integer({ min: 0, max: 2_000 }), (a, b) => {
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        expect(passLap(hi)).toBeLessThanOrEqual(passLap(lo));
      }),
      { numRuns: 60 },
    );
  });

  // row 8
  it('two cars both in DRS range gain nothing on each other', () => {
    // equal pace, no passes; B 0.9 s behind A, C 0.9 s behind B: both in range of the car ahead at the one DRS zone
    const start = startingPoint({
      lap: 10,
      lapsTotal: 30,
      cars: [{ gapMs: 0 }, { gapMs: 900 }, { gapMs: 1_800 }],
      interaction: interaction({ curve: { cap: 0 }, minGapMs: 200, drsStraightGainMs: 250 }),
    });
    const r = run(start, noStops(3), PLAIN, 11);
    const end = traceAt(r, 11);
    // B gains the straight gain at each of its two zones on A, which is not itself in range
    expect(Math.abs(end.gapMs[1]! - (900 - 2 * 250))).toBeLessThanOrEqual(1);
    // C, in range of B which is in range of A, gains nothing on B
    for (const lap of [10, 11]) {
      const t = traceAt(r, lap);
      expect(Math.abs(t.gapMs[2]! - t.gapMs[1]! - 900)).toBeLessThanOrEqual(1);
    }
  });
});

describe('race-forecast: stops', () => {
  // row 3
  it('a stop never gains a position at the rejoin', () => {
    const field = fc.array(fc.record({ step: fc.integer({ min: 600, max: 3_000 }), pace: fc.integer({ min: -400, max: 400 }) }), { minLength: 2, maxLength: 6 });
    fc.assert(
      fc.property(field, fc.nat(), fc.integer({ min: 7, max: 15 }), (cars, pick, stopLap) => {
        let gap = 0;
        const start = startingPoint({
          lap: 5,
          lapsTotal: 20,
          cars: cars.map((c, i) => {
            if (i > 0) gap += c.step;
            return { gapMs: gap, paceMs: PACE_MS + c.pace, degMsPerLap: 10 };
          }),
        });
        const stopper = pick % cars.length;
        const policies = noStops(cars.length);
        policies[stopper] = { stops: [{ lap: stopLap, compound: 'hard' }], triggers: [] };
        const r = run(start, policies);
        expect(traceAt(r, stopLap + 1).position[stopper]!).toBeGreaterThanOrEqual(traceAt(r, stopLap - 1).position[stopper]!);
      }),
      { numRuns: 80 },
    );
  });

  // row 4
  it('an extra stop never shortens the plain race time', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 80_000, max: 100_000 }),
        fc.integer({ min: 15, max: 40 }),
        fc.double({ min: 0.5, max: 4, noNaN: true }),
        fc.boolean(),
        fc.double({ min: 0.05, max: 0.95, noNaN: true }),
        fc.double({ min: 0.05, max: 0.95, noNaN: true }),
        (paceMs, lapsTotal, wearRatePct, oneStop, at, extraAt) => {
          const start = startingPoint({ lap: 1, lapsTotal, cars: [{ paceMs, wearRatePct }] });
          const stopLap = 2 + Math.floor(at * (lapsTotal - 4));
          const base: Policy = { stops: oneStop ? [{ lap: stopLap, compound: 'medium' }] : [], triggers: [] };
          let extraLap = 2 + Math.floor(extraAt * (lapsTotal - 4));
          if (oneStop && Math.abs(extraLap - stopLap) < 2) extraLap = stopLap + 2 < lapsTotal ? stopLap + 2 : stopLap - 2;
          const extra: Policy = { stops: [...base.stops, { lap: extraLap, compound: 'medium' as const }].sort((a, b) => a.lap - b.lap), triggers: [] };
          const without = run(start, [base]).raceTimeMs[0]!;
          const withExtra = run(start, [extra]).raceTimeMs[0]!;
          expect(withExtra).toBeGreaterThanOrEqual(without - 1);
        },
      ),
      { numRuns: 80 },
    );
  });

  // row 5
  it('one more stop of one car leaves every other draw unchanged', () => {
    // far apart (35 s) so the extra stop meets no other car on track; the middle car stops once more on lap 10
    const start = startingPoint({ lap: 1, lapsTotal: 20, cars: [0, 35_000, 70_000].map((gapMs) => ({ ...NOISY, paceSdMs: 100, bigEventRate: 0, retireRate: 0, gapMs })) });
    const base: Policy[] = [{ stops: [{ lap: 12, compound: 'hard' }], triggers: [] }, { stops: [{ lap: 14, compound: 'hard' }], triggers: [] }, { stops: [{ lap: 13, compound: 'hard' }], triggers: [] }];
    const more = base.map((p, car) => (car === 1 ? { stops: [{ lap: 6, compound: 'medium' as const }, ...p.stops], triggers: [] } : p));
    for (const id of range(1, 10)) {
      const a = raceForecast(start, base, drawn(id), createRng(9), { trace: true });
      const b = raceForecast(start, more, drawn(id), createRng(9), { trace: true });
      for (const lap of range(1, 20)) {
        const [ta, tb] = [traceAt(a, lap), traceAt(b, lap)];
        expect(tb.lapTimeMs[0]).toBe(ta.lapTimeMs[0]);
        expect(tb.lapTimeMs[2]).toBe(ta.lapTimeMs[2]);
        if (lap < 6) expect(tb.lapTimeMs[1]).toBe(ta.lapTimeMs[1]);
      }
    }
  });

  // row 9
  it('double stack waits max(0, 6.5 s − entry gap)', () => {
    // our two cars (one pit box), equal pace, no passes; the second car stops on lap 10 behind its teammate or alone
    const waitFor = (entryGapMs: number): { second: number; first: number } => {
      const start = startingPoint({ lap: 1, lapsTotal: 25, cars: [{ gapMs: 0 }, { gapMs: entryGapMs }], ours: [0, 1], interaction: interaction({ curve: { cap: 0 } }) });
      const second: Policy = { stops: [{ lap: 10, compound: 'medium' }], triggers: [] };
      const stacked = run(start, [{ stops: [{ lap: 10, compound: 'medium' }], triggers: [] }, second]);
      const apart = run(start, [{ stops: [{ lap: 14, compound: 'medium' }], triggers: [] }, second]);
      return { second: stacked.raceTimeMs[1]! - apart.raceTimeMs[1]!, first: stacked.raceTimeMs[0]! - apart.raceTimeMs[0]! };
    };
    const two = waitFor(2_000);
    expect(Math.abs(two.second - 4_500)).toBeLessThanOrEqual(1);
    expect(Math.abs(two.first)).toBeLessThanOrEqual(1);
    const seven = waitFor(7_000);
    expect(Math.abs(seven.second)).toBeLessThanOrEqual(1);
  });
});

describe('race-forecast: the generated race', () => {
  // row 6: the smallest race that shows it (P8): 10 AI cars, 20 laps, one stop each, generated once for the file.
  // Medium and hard share their degradation and wear so one `degMsPerLap` and `wearRatePct` per car describe both sets.
  const CARS = 10;
  const LAPS = 20;
  const params: GeneratorParams = {
    ...GENERATOR_DEFAULTS,
    cars: CARS,
    laps: LAPS,
    fuelStartKg: LAPS * GENERATOR_DEFAULTS.fuelPerLapKg,
    compounds: {
      ...GENERATOR_DEFAULTS.compounds,
      medium: { offsetMs: 600, degMsPerLap: 50, wearPctPerLap: 2 },
      hard: { offsetMs: 1_100, degMsPerLap: 50, wearPctPerLap: 2 },
    },
    field: GENERATOR_DEFAULTS.field.slice(0, CARS).map((car, i) => ({ ...car, human: false, sigmaMs: 200, rho: 0.3, mistakeRate: 0.02, stops: [{ lap: 8 + (i % 3), compound: 'hard' as const }], startCompound: 'medium' as const })),
  };
  const { race, truth } = generateRace(params, 2026);

  it('the plain forecast reproduces a generated race within its noise', () => {
    const gridGapMs = truth.pass.minGapMs + 500;
    const wear = truth.compounds.medium.wearPctPerLap;
    const start = startingPoint({
      lap: 1,
      lapsTotal: LAPS,
      cars: truth.field.map((car, i) => ({
        gapMs: i * gridGapMs,
        paceMs: car.paceMs,
        degMsPerLap: truth.compounds.medium.degMsPerLap / wear,
        wearRatePct: wear * car.wearFactor,
        fuelKg: truth.fuelStartKg,
        sigmaMs: car.sigmaMs,
        rho: car.rho,
        mistakeRate: car.mistakeRate,
        mistakeMedianMs: car.mistakeMedianMs,
        mistakeSigmaLog: car.mistakeSigmaLog,
      })),
      lapModel: {
        ...LAP_MODEL,
        fuelMsPerKg: 30,
        compoundOffsetMs: Object.fromEntries(NOISE_COMPOUNDS.map((c) => [c, truth.compounds[c].offsetMs])) as typeof LAP_MODEL.compoundOffsetMs,
      },
      pitLossMs: { green: truth.pitLossMs, vsc: truth.pitLossMs / 2, sc: truth.pitLossMs / 2, inLapShare: 0 },
      drsZones: truth.drsZones,
      brakingZones: truth.brakingZones,
      interaction: interaction({ minGapMs: truth.pass.minGapMs, curve: { level: -3, slopePerMs: 0.01, cap: 0.8 } }),
    });
    // the generator stops one frame after the leader takes the flag, so the comparison is at the last lap every car
    // completes (R35): the forecast to lap LAPS − 1 and each car's crossing of that lap's line in the generated race
    const AT_LAP = LAPS - 1;
    const r = raceForecast(start, truth.field.map((car) => ({ stops: car.stops, triggers: [] })), PLAIN, createRng(1), { toLap: AT_LAP });

    const last = race.viewAt(race.lastFrame).history.laps.filter((l) => l.status === 'confirmed' && l.lapNumber === AT_LAP);
    expect(last).toHaveLength(CARS);
    const finishedAt = new Map(last.map((l) => [l.carId as number, l.completedAt]));
    const byFinish = [...last].sort((a, b) => a.completedAt - b.completedAt).map((l) => l.carId as number);
    const positionErrors = range(0, CARS - 1).map((car) => Math.abs(r.position[car]! - (byFinish.indexOf(car) + 1)));
    expect(positionErrors.reduce((s, e) => s + e, 0) / CARS).toBeLessThanOrEqual(1.5);

    // σ_race: the noise of a car's race time over the race, its AR(1) scatter and its mistakes
    const raceVar = (car: number): number => {
      const c = truth.field[car]!;
      const scatter = c.sigmaMs ** 2 * LAPS * ((1 + c.rho) / (1 - c.rho));
      const mistakes = LAPS * c.mistakeRate * c.mistakeMedianMs ** 2 * Math.exp(2 * c.mistakeSigmaLog ** 2);
      return scatter + mistakes;
    };
    for (const car of range(1, CARS - 1)) {
      const generated = finishedAt.get(car)! - finishedAt.get(0)!;
      const forecast = r.raceTimeMs[car]! - r.raceTimeMs[0]!;
      expect(Math.abs(forecast - generated)).toBeLessThanOrEqual(3 * Math.sqrt(raceVar(car) + raceVar(0)));
    }
  });
});

describe('race-forecast: draws', () => {
  // row 7
  it('a seeded run is bit-identical', () => {
    const start = startingPoint({
      lap: 1,
      lapsTotal: 25,
      cars: range(0, 7).map((i) => ({ ...NOISY, gapMs: 1_200 * i, paceMs: PACE_MS + 60 * i, degMsPerLap: 15 })),
      ours: [3, 4],
    });
    const policies: Policy[] = range(0, 7).map((i) => ({ stops: [{ lap: 10 + (i % 4), compound: 'hard' }], triggers: [] }));
    const scenario = drawn(17, [{ kind: 'sc', fromLap: 14, toLap: 16 }]);
    const a = raceForecast(start, policies, scenario, createRng(5), { trace: true });
    const b = raceForecast(start, policies, scenario, createRng(5), { trace: true });
    expect(b).toEqual(a);
    // and the draws are drawn: another scenario's race differs
    const other = raceForecast(start, policies, { ...scenario, id: 18 }, createRng(5), { trace: true });
    expect(Array.from(other.raceTimeMs)).not.toEqual(Array.from(a.raceTimeMs));
  });

  // row 13
  it("pace draws: none in plain mode; across 2,000 scenarios a car's drawn pace has the builder's paceSdMs within 10 %; one stream per car", () => {
    // two quiet cars 40 s apart, one lap each: the lap time is the drawn pace and nothing else
    const field = (sd0: number): StartingPoint =>
      startingPoint({ lap: 5, lapsTotal: 30, cars: [{ gapMs: 0, paceSdMs: sd0 }, { gapMs: 40_000, paceSdMs: 300 }] });
    const start = field(200);
    const pace = (s: StartingPoint, id: number): [number, number] => {
      const t = traceAt(raceForecast(s, noStops(2), drawn(id), createRng(3), { trace: true, toLap: 5 }), 5);
      return [t.lapTimeMs[0]!, t.lapTimeMs[1]!];
    };
    const plain = traceAt(raceForecast(start, noStops(2), PLAIN, createRng(3), { trace: true, toLap: 5 }), 5);
    expect(Math.abs(plain.lapTimeMs[0]! - PACE_MS)).toBeLessThanOrEqual(1);
    expect(Math.abs(plain.lapTimeMs[1]! - PACE_MS)).toBeLessThanOrEqual(1);

    const draws = range(1, 2_000).map((id) => pace(start, id));
    const stats = (xs: number[]): { mean: number; sd: number } => {
      const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
      return { mean, sd: Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / (xs.length - 1)) };
    };
    const [a, b] = [stats(draws.map((d) => d[0])), stats(draws.map((d) => d[1]))];
    expect(Math.abs(a.sd / 200 - 1)).toBeLessThanOrEqual(0.1);
    expect(Math.abs(b.sd / 300 - 1)).toBeLessThanOrEqual(0.1);
    expect(Math.abs(a.mean - PACE_MS)).toBeLessThanOrEqual((4 * 200) / Math.sqrt(2_000));
    expect(Math.abs(b.mean - PACE_MS)).toBeLessThanOrEqual((4 * 300) / Math.sqrt(2_000));
    const corr = draws.reduce((s, d) => s + (d[0] - a.mean) * (d[1] - b.mean), 0) / ((draws.length - 1) * a.sd * b.sd);
    expect(Math.abs(corr)).toBeLessThan(0.1);
    // one stream per car: car 1's draw does not move when car 0 draws nothing
    const quiet0 = field(0);
    for (const id of range(1, 50)) expect(pace(quiet0, id)[1]).toBe(draws[id - 1]![1]);
  });
});

describe('race-forecast: neutralisations', () => {
  // row 11
  it("under SC the field queues behind the leader and nobody passes; the queue's gaps close to minGapMs", () => {
    // each car 200 ms a lap faster than the one ahead, 3 s apart, an easy pass once held
    const start = startingPoint({
      lap: 18,
      lapsTotal: 30,
      cars: range(0, 5).map((i) => ({ gapMs: 3_000 * i, paceMs: PACE_MS - 200 * i })),
      interaction: interaction({ minGapMs: 500, curve: { level: 0, slopePerMs: 0.01, cap: 1 } }),
    });
    const r = run(start, noStops(6), plainWith([{ kind: 'sc', fromLap: 20, toLap: 23 }]));
    const before = Array.from(traceAt(r, 19).position);
    for (const lap of range(20, 23)) expect(Array.from(traceAt(r, lap).position)).toEqual(before);
    const queue = traceAt(r, 22);
    const order = range(0, 5).sort((x, y) => queue.position[x]! - queue.position[y]!);
    for (let k = 1; k < order.length; k++) {
      const gap = queue.gapMs[order[k]!]! - queue.gapMs[order[k - 1]!]!;
      expect(gap).toBeGreaterThanOrEqual(500 - 1);
      expect(gap).toBeLessThanOrEqual(500 + 100);
    }
  });

  // row 12
  it('under VSC nobody passes and gaps keep their size', () => {
    // B held at the minimum gap behind A, 1.5 s a lap faster; D 1.5 s a lap faster than C: both would pass at once
    const start = startingPoint({
      lap: 20,
      lapsTotal: 30,
      cars: [
        { gapMs: 0, paceMs: 91_500 },
        { gapMs: 500, paceMs: 90_000 },
        { gapMs: 3_000, paceMs: 90_500 },
        { gapMs: 3_500, paceMs: 89_000 },
      ],
      interaction: interaction({ minGapMs: 500, curve: { level: 0, slopePerMs: 0.01, cap: 1 } }),
    });
    const vsc = [{ kind: 'vsc' as const, fromLap: 20, toLap: 23 }];
    for (const scenario of [plainWith(vsc), drawn(4, vsc)]) {
      const r = raceForecast(start, noStops(4), scenario, createRng(8), { trace: true });
      for (const lap of range(20, 23)) expect(Array.from(traceAt(r, lap).position)).toEqual([1, 2, 3, 4]);
      const first = traceAt(r, 20);
      for (const lap of [21, 22]) {
        const t = traceAt(r, lap);
        for (const car of [1, 2, 3]) expect(Math.abs(t.gapMs[car]! - first.gapMs[car]!)).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('race-forecast: retirements and big slow laps', () => {
  // row 14
  it('retirements: a retireRate of 0 retires nobody; a retired car keeps no position and leaves the queue; big slow laps never retire', () => {
    // a big slow lap every lap, no retirements: nobody retires, and every lap is more than 5 s slow
    const slow = startingPoint({ lap: 1, lapsTotal: 15, cars: [0, 30_000, 60_000].map((gapMs) => ({ gapMs, bigEventRate: 1, retireRate: 0 })) });
    for (const id of range(1, 40)) {
      const r = raceForecast(slow, noStops(3), drawn(id), createRng(2), { trace: true });
      expect(Array.from(r.position).sort()).toEqual([1, 2, 3]);
      for (const t of r.trace!) {
        expect(Array.from(t.position).sort()).toEqual([1, 2, 3]);
        expect(t.lapTimeMs[0]!).toBeGreaterThan(PACE_MS + 5_000);
      }
    }

    // A retires on its first lap; B and C, held behind it, run at their own pace from then on
    const queue = startingPoint({
      lap: 5,
      lapsTotal: 20,
      cars: [
        { gapMs: 0, paceMs: 91_000, retireRate: 1 },
        { gapMs: 500, paceMs: PACE_MS },
        { gapMs: 1_000, paceMs: PACE_MS },
      ],
      interaction: interaction({ minGapMs: 500, curve: { cap: 0 } }),
    });
    const r = raceForecast(queue, noStops(3), drawn(1), createRng(2), { trace: true });
    expect(Array.from(r.position)).toEqual([0, 1, 2]);
    for (const lap of range(6, 20)) expect(Array.from(traceAt(r, lap).position)).toEqual([0, 1, 2]);
    for (const lap of range(7, 20)) {
      const t = traceAt(r, lap);
      expect(Math.abs(t.lapTimeMs[1]! - PACE_MS)).toBeLessThanOrEqual(1);
      expect(Math.abs(t.lapTimeMs[2]! - PACE_MS)).toBeLessThanOrEqual(1);
    }

    // a car retired before the starting point keeps no position either
    const out = startingPoint({ lap: 5, lapsTotal: 10, cars: [{ gapMs: 0 }, { gapMs: 2_000, retired: true }, { gapMs: 4_000 }] });
    expect(Array.from(run(out, noStops(3)).position)).toEqual([1, 0, 2]);
  });
});
