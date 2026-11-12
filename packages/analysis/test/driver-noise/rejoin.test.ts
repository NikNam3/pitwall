// `driver-noise`'s rejoin laps (SP4.3b spec 4.2 F4, plan Task 8; contract C33, C43, C45, C47): the scatter set leaves
// out a car's laps 1 to `rejoinSkipLaps` (config, 2) after each of its stops; `freeAirLaps` is unchanged (C43). A
// generator stop at lap L is its in lap; lap L + 1 is its out lap, never a pace lap (`degradation` excludes it); the
// laps after the stop are L + 2, L + 3 …, so with the default L + 2 and L + 3 are left out and L + 4 counts again.
//
// Rows (plan Task 8): 1 σ recovered with two stops a car (4.3a's R51 case), 2 which laps are left out, R1 rewind.
// R2 (the 4.3a tests pass unchanged) is `driver-noise.test.ts`, `rows.test.ts`, `driver-now.test.ts` and the budget.
//
// The car's `laps` is the count of the laps its σ rests on (`ModelEstimates.laps`: the free-air pace laps). Row 2 reads
// it as of each lap's confirmed frame with `degradation`'s and `track-wetness`'s outputs of the flag, so every lap's
// residual is known when it enters and each lap's count step is that lap's membership of the set.
import { carId, type CarNoise, type DriverNoise, type FrameNumber } from '@pitwall/domain';
import { beforeAll, describe, expect, it } from 'vitest';
import { driverNoiseCalculator } from '../../src/driver-noise/calculator.ts';
import { DRIVER_NOISE_CONFIG } from '../../src/driver-noise/index.ts';
import type { BuilderRace } from '../../../../test-support/builders/long-race.ts';
import { generateRace, GENERATOR_DEFAULTS, type GeneratorCar, type GeneratorParams } from '../../../../test-support/race-generator/index.ts';
import type { EngineView } from '@pitwall/engine/readers';
import { guardedQuick } from '../situated.ts';
import { lapConfirmedFrame, viewAt } from './support.ts';

const calc = guardedQuick(driverNoiseCalculator);

/** A generator car on mediums, no stop unless given. */
const genCar = (paceMs: number, over: Partial<GeneratorCar> = {}): GeneratorCar => ({
  paceMs,
  human: false,
  sigmaMs: 200,
  rho: 0.3,
  mistakeRate: 0.02,
  mistakeMedianMs: 1_500,
  mistakeSigmaLog: 0.6,
  wearFactor: 1,
  stops: [],
  startCompound: 'medium',
  ...over,
});

const params = (field: GeneratorCar[], over: Partial<GeneratorParams> = {}): GeneratorParams => ({ ...GENERATOR_DEFAULTS, cars: field.length, field, ...over });

/** Shrinkage off (`shrinkLaps` 0): the output is the session's own estimate. */
const sessionOnly = (over: Record<string, number> = {}): EngineView['config'] => ({ 'driver-noise': { shrinkLaps: 0, ...over } });

// Row 1: R1's AI field of `driver-noise.test.ts` (20 cars σ 200, 55 ms a lap apart, 50 laps), every car stopping twice,
// staggered so the field rejoins into traffic: hards at lap 15 + i mod 5, mediums at lap 32 + i mod 5.
const AI_SIGMA_MS = 200;
const TWO_STOPS: GeneratorCar[] = Array.from({ length: 20 }, (_, i) =>
  genCar(90_000 + 55 * i, {
    stops: [
      { lap: 15 + (i % 5), compound: 'hard' },
      { lap: 32 + (i % 5), compound: 'medium' },
    ],
  }),
);
const SEEDS = [1, 2, 3, 4, 5, 6];

// Row 2 and R1: three cars 4 s a lap apart (free air all race), car 1 without mistakes stopping at lap STOP of 16.
const STOP = 8;
const LONE_CAR = 1;
const LONE = params(
  Array.from({ length: 3 }, (_, i) => genCar(90_000 + 4_000 * i, i === LONE_CAR ? { mistakeRate: 0, stops: [{ lap: STOP, compound: 'hard' }] } : { mistakeRate: 0 })),
  { laps: 16 },
);

let twoStops: BuilderRace[];
let lone: BuilderRace;

beforeAll(() => {
  twoStops = SEEDS.map((seed) => generateRace(params(TWO_STOPS), seed).race);
  lone = generateRace(LONE, 7).race;
});

const mean = (xs: readonly number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length;
const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

const valueOf = (k: CarNoise['sigmaMs']): number => {
  if (!k.known) throw new Error(`unknown: ${k.reason}`);
  return k.value;
};

const carOf = (out: DriverNoise, car: number): CarNoise => {
  const noise = out.cars[carId(car)];
  if (noise === undefined) throw new Error(`no entry for car ${car}`);
  return noise;
};

/** The car's `laps` as of `frame`, with the flag's upstream outputs (every lap's residual known) and `config`. */
function lapsAsOf(race: BuilderRace, car: number, frame: FrameNumber, config: EngineView['config'], flag: EngineView['outputs']): number {
  const view = viewAt(race, frame, { config });
  return carOf(calc.compute({ ...view, outputs: flag }), car).laps;
}

describe('driver-noise rejoin laps (SP4.3b F4)', () => {
  it("1: the generator's σ 200 is recovered within 15 % also when every car stops twice", () => {
    // the AI field's median σ per race at the flag, shrinkage off, averaged over the races
    const outs = twoStops.map((race) => calc.compute(viewAt(race, race.lastFrame, { config: sessionOnly() })));
    const aiSigma = mean(outs.map((out) => median(Array.from({ length: 20 }, (_, c) => valueOf(carOf(out, c).sigmaMs)))));
    expect(Math.abs(aiSigma - AI_SIGMA_MS) / AI_SIGMA_MS, `AI σ ${aiSigma.toFixed(0)}`).toBeLessThanOrEqual(0.15);
  });

  it('2: the two laps after a stop are not in the scatter set, the third is', () => {
    const flag = viewAt(lone, lone.lastFrame).outputs;
    /** Whether lap `n` enters the car's set: its count step from lap n − 1's confirmed frame to lap n's. */
    const enters = (n: number, config: EngineView['config']): boolean =>
      lapsAsOf(lone, LONE_CAR, lapConfirmedFrame(lone, LONE_CAR, n), config, flag) - lapsAsOf(lone, LONE_CAR, lapConfirmedFrame(lone, LONE_CAR, n - 1), config, flag) === 1;

    // without the skip each of the laps after the out lap is in the set (the car runs in free air), so the row is not vacuous
    const noSkip = sessionOnly({ rejoinSkipLaps: 0 });
    for (const n of [STOP + 2, STOP + 3, STOP + 4]) expect(enters(n, noSkip), `lap ${n} without the skip`).toBe(true);

    // the default: the two laps after the stop are left out, the third counts again
    const byDefault = sessionOnly();
    expect(enters(STOP + 2, byDefault), `lap ${STOP + 2}: 1st after the stop`).toBe(false);
    expect(enters(STOP + 3, byDefault), `lap ${STOP + 3}: 2nd after the stop`).toBe(false);
    expect(enters(STOP + 4, byDefault), `lap ${STOP + 4}: 3rd after the stop`).toBe(true);

    // at the flag: exactly the two laps fewer than without the skip
    const atFlag = (config: EngineView['config']) => carOf(calc.compute({ ...viewAt(lone, lone.lastFrame, { config }), outputs: flag }), LONE_CAR).laps;
    expect(atFlag(noSkip) - atFlag(byDefault)).toBe(2);

    // the default is declared in the unit's config (C47)
    expect((DRIVER_NOISE_CONFIG.defaults as Record<string, unknown>)['rejoinSkipLaps'], 'the config default').toBe(2);
  });

  it('R1: rewind: output equals a run without the undone frames (C33)', () => {
    // the target inside the skip window (the 1st lap after the stop running), the undone frames past it
    const target = lone.framesOfLap(STOP + 2)[0]!;
    const undone = lone.framesOfLap(STOP + 6)[0]!;
    const rewound = viewAt(lone, target, { from: undone, config: sessionOnly() });
    expect(rewound.delta.rewound).toBeDefined();
    const fresh = calc.compute(viewAt(lone, target, { config: sessionOnly() }));
    expect(calc.compute(rewound)).toEqual(fresh);
    // the undone laps did count before the flashback
    expect(calc.compute(viewAt(lone, undone, { config: sessionOnly() }))).not.toEqual(fresh);
  });
});
