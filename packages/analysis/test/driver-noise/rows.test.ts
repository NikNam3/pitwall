// `driver-noise`'s rows on builder views and stored sessions (SP4.3a spec 4, 5.2, plan Task 10 rows 7-11; contract C3,
// C26, C62c, C84). The builder views give `degradation`'s stints and `track-wetness`'s common mode (`support.ts`), so a
// lap's residual is exactly the one the row sets; the stored sessions are generated races passed explicitly (C84).
import {
  carId,
  known,
  unknown,
  type CarNoise,
  type DriverNoise,
  type DriverProfile,
  type EstimateSource,
  type Known,
  type NoiseCompound,
} from '@pitwall/domain';
import { asOfStored, runAsOf, type AsOfUnit, type EngineView, type ProfileCtx } from '@pitwall/engine/readers';
import { beforeAll, describe, expect, it } from 'vitest';
import { degradationAsOf, degradationCalculator } from '../../src/degradation/calculator.ts';
import { DEGRADATION } from '../../src/degradation/index.ts';
import { driverNoiseCalculator } from '../../src/driver-noise/calculator.ts';
import { DRIVER_NOISE, DRIVER_NOISE_CONFIG, driverNoiseAsOf } from '../../src/driver-noise/index.ts';
import { DRIVER_NOISE_PROFILES } from '../../src/driver-noise/profiles.ts';
import { TRACK_WETNESS, trackWetnessAsOf } from '../../src/track-wetness/index.ts';
import type { BuilderRace } from '../../../../test-support/builders/long-race.ts';
import { generateRace, GENERATOR_DEFAULTS, type GeneratorCar } from '../../../../test-support/race-generator/index.ts';
import { guardedQuick } from '../situated.ts';
import { rowView, storedSession, type CarLaps, type CarSituation } from './support.ts';

const calc = guardedQuick(driverNoiseCalculator);
const D = DRIVER_NOISE_CONFIG.defaults;

/** Shrinkage off: the output is the session's own estimate. */
const SESSION_ONLY: EngineView['config'] = { 'driver-noise': { shrinkLaps: 0 } };

/**
 * A car's noise with each compound's wear-rate source. `CarNoise` has no per-compound source yet (requested of the
 * supervisor in the Task 10 test report: `wearRateSource: Record<NoiseCompound, EstimateSource>`).
 */
type WithWearSource = CarNoise & { wearRateSource: Record<NoiseCompound, EstimateSource> };

const carOf = (out: DriverNoise, car: number): WithWearSource => {
  const noise = out.cars[carId(car)];
  if (noise === undefined) throw new Error(`no entry for car ${car}`);
  return noise as WithWearSource;
};

const valueOf = (k: Known<number>): number => {
  if (!k.known) throw new Error(`unknown: ${k.reason}`);
  return k.value;
};

/** `view.drivers` with slot `slot` linked to person `person` whose entries are `entries`, every other slot unlinked. */
function linked(slot: number, person: string, entries: Record<string, number>): EngineView['drivers'] {
  const profile: DriverProfile = {
    person,
    displayName: person.toUpperCase(),
    entries: Object.fromEntries(Object.entries(entries).map(([key, value]) => [key, { value: known(value, 0), laps: 120, sessions: 3, newestSession: '2026-11-05' }])),
  };
  return Array.from({ length: 22 }, (_, i) => (i === slot ? known(profile, 0) : unknown('notApplicable')));
}

/** A permutation of the residuals −200, −180 … 200 ms over 21 laps: 1.4826 · MAD is 148.26 ms. */
const spread = (k: number): number => (((k * 8) % 21) - 10) * 20;

/** 1.4826 · the median absolute deviation from the median. */
const madSigma = (xs: readonly number[]): number => {
  const med = (ys: readonly number[]) => {
    const s = [...ys].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
  };
  const m = med(xs);
  return 1.4826 * med(xs.map((x) => Math.abs(x - m)));
};

describe('driver-noise rows (spec 5.2)', () => {
  it("7: wear rate of a hidden rival: profile, else our car's rate on that compound this race, else the config default, with the source", () => {
    const ours = (compound: NoiseCompound): CarLaps & CarSituation => ({ car: 0, to: 10, compound });
    // car 1: a human rival on mediums, its wear hidden by realism
    const rival: CarLaps & CarSituation = { car: 1, to: 10, compound: 'medium', wear: 'hidden', driver: 'human' };

    // its profile's rate
    const withProfile = carOf(calc.compute(rowView([ours('medium'), rival], { drivers: linked(1, 'dr', { 'driverNoise.wearRatePct.medium': 1.7 }) })), 1);
    expect(valueOf(withProfile.wearRatePctPerLap.medium)).toBeCloseTo(1.7, 9);
    expect(withProfile.wearRateSource.medium).toMatchObject({ kind: 'profile', person: 'dr' });

    // no profile: our car's measured rate on mediums this race (1 % a lap)
    const fromOurs = carOf(calc.compute(rowView([ours('medium'), rival])), 1);
    expect(valueOf(fromOurs.wearRatePctPerLap.medium)).toBeCloseTo(1, 9);
    expect(fromOurs.wearRateSource.medium.kind).toBe('session');

    // our car never ran mediums: the config default
    const fromDefault = carOf(calc.compute(rowView([ours('soft'), rival])), 1);
    expect(valueOf(fromDefault.wearRatePctPerLap.medium)).toBeCloseTo(D.defaultWearRatePct, 9);
    expect(fromDefault.wearRateSource.medium.kind).toBe('default');
  });

  it('8: a human with a profile starts from it, source profile; without one from the human default, source default', () => {
    // the race's first lap not yet complete: no lap of car 1 in the projection
    const start = (drivers?: EngineView['drivers']) =>
      carOf(calc.compute(rowView([{ car: 0, to: 0 }, { car: 1, to: 0, driver: 'human' }], drivers === undefined ? {} : { drivers })), 1);

    const profiled = start(
      linked(1, 'dr', {
        'driverNoise.sigmaMs': 380,
        'driverNoise.rho': 0.25,
        'driverNoise.mistakeRate': 0.03,
        'driverNoise.mistakeMedianMs': 900,
        'driverNoise.mistakeSigmaLog': 0.5,
      }),
    );
    expect(profiled.driver).toBe('human');
    expect(profiled.laps).toBe(0);
    expect(valueOf(profiled.sigmaMs)).toBeCloseTo(380, 9);
    expect(valueOf(profiled.rho)).toBeCloseTo(0.25, 9);
    expect(valueOf(profiled.mistakeRatePerLap)).toBeCloseTo(0.03, 9);
    expect(profiled.mistakeSize).toMatchObject({ known: true, value: { medianMs: 900, sigmaLog: 0.5 } });
    expect(profiled.source).toMatchObject({ kind: 'profile', person: 'dr' });

    const plain = start();
    expect(plain.driver).toBe('human');
    expect(plain.laps).toBe(0);
    expect(valueOf(plain.sigmaMs)).toBeCloseTo(D.humanSigmaMs, 9);
    expect(valueOf(plain.mistakeRatePerLap)).toBeCloseTo(D.humanMistakeRate, 9);
    expect(plain.mistakeSize).toMatchObject({ known: true, value: { medianMs: D.humanMistakeMedianMs } });
    expect(plain.source.kind).toBe('default');
  });

  it('9: mistake laps are left out of σ', () => {
    // AI car 0, laps 2..23 its pace laps: lap 12 a 3 s mistake (beyond 3σ, under the big-event 5 s), the others the spread
    const MISTAKE_LAP = 12;
    const residuals = new Map<number, number>();
    let k = 0;
    for (let n = 2; n <= 23; n++) residuals.set(n, n === MISTAKE_LAP ? 3_000 : spread(k++));
    const residual = (n: number) => residuals.get(n) ?? 0;

    const withMistake = carOf(calc.compute(rowView([{ car: 0, to: 23, residual }], { config: SESSION_ONLY })), 0);
    const withoutLap = carOf(calc.compute(rowView([{ car: 0, to: 23, residual, without: [MISTAKE_LAP] }], { config: SESSION_ONLY })), 0);

    const clean = [...residuals].filter(([n]) => n !== MISTAKE_LAP).map(([, r]) => r);
    const all = [...residuals.values()];
    expect(madSigma(all)).not.toBeCloseTo(madSigma(clean), 0);
    // the mistake lap is a mistake, and σ is the one of the other laps, as if it never happened
    expect(valueOf(withMistake.mistakeRatePerLap)).toBeGreaterThan(0);
    expect(valueOf(withMistake.sigmaMs)).toBeCloseTo(madSigma(clean), 6);
    expect(valueOf(withMistake.sigmaMs)).toBeCloseTo(valueOf(withoutLap.sigmaMs), 6);
  });

  it("10: the profile entries' aggregate over two stored sessions weights by laps, each session's values from runAsOf on asOfStored", () => {
    const units: AsOfUnit[] = [
      { id: DEGRADATION, reads: degradationCalculator.reads, asOf: degradationAsOf },
      { id: TRACK_WETNESS, reads: [{ calculator: DEGRADATION }], asOf: trackWetnessAsOf },
      { id: DRIVER_NOISE, reads: driverNoiseCalculator.reads, asOf: driverNoiseAsOf },
    ];
    // shrinkage off, so each session's output is its own estimate however the aggregate reads it
    const ctx: ProfileCtx = { config: SESSION_ONLY, overrides: {} };
    const own = (session: ReturnType<typeof storedSession>): CarNoise => {
      const out = runAsOf(units, asOfStored(session, ctx)).get(DRIVER_NOISE) as DriverNoise;
      return carOf(out, session.carId);
    };
    const values = sessions.map(own);
    expect(values.map((v) => v.driver)).toEqual(['human', 'human']);
    const laps = values.map((v) => v.laps);
    expect(laps[0]).not.toBe(laps[1]);
    const weighted = (pick: (v: CarNoise) => Known<number>) => values.reduce((s, v) => s + valueOf(pick(v)) * v.laps, 0) / (laps[0]! + laps[1]!);

    const entry = (key: string) => {
      const decl = DRIVER_NOISE_PROFILES.entries[key];
      if (decl === undefined) throw new Error(`${key} is declared`);
      return decl.aggregate(sessions, ctx);
    };
    const sigma = entry('driverNoise.sigmaMs');
    expect(valueOf(sigma.value)).toBeCloseTo(weighted((v) => v.sigmaMs), 6);
    expect(sigma.laps).toBe(laps[0]! + laps[1]!);
    const rho = entry('driverNoise.rho');
    expect(valueOf(rho.value)).toBeCloseTo(weighted((v) => v.rho), 6);
    expect(rho.laps).toBe(laps[0]! + laps[1]!);
    // both sessions wear their mediums 2 % a lap (the generator's medium rate), so any weighting gives 2
    expect(valueOf(entry('driverNoise.wearRatePct.medium').value)).toBeCloseTo(2, 6);
  });

  it('11: a retirement counts in retireRatePerLap, not in bigEventRatePerLap (P5)', () => {
    const pattern = (n: number) => spread(n % 21);
    const slowAt = (lap: number) => (n: number) => (n === lap ? 9_000 : pattern(n));
    const RETIRED_FROM = 15 * 20 + 1 + 5; // after car 1's lap-15 frame
    /** AI cars 0..2 over 15 laps; car 1's lap 15 and car 2's lap 10 as given, car 1 retired after its lap 15 or not. */
    const view = (o: { car1Slow: boolean; car1Retired: boolean; car2Slow: boolean }) =>
      calc.compute(
        rowView([
          { car: 0, to: 15, residual: pattern },
          { car: 1, to: 15, residual: o.car1Slow ? slowAt(15) : pattern, ...(o.car1Retired && { retiredFrom: RETIRED_FROM }) },
          { car: 2, to: 15, residual: o.car2Slow ? slowAt(10) : pattern },
        ]),
      );
    const slowThenRetired = view({ car1Slow: true, car1Retired: true, car2Slow: false });
    const retired = view({ car1Slow: false, car1Retired: true, car2Slow: false });
    const plain = view({ car1Slow: false, car1Retired: false, car2Slow: false });
    const bigLap = view({ car1Slow: false, car1Retired: false, car2Slow: true });

    // the retiring car's slow last lap is no big event: as if its last lap were normal
    expect(carOf(slowThenRetired, 1).bigEventRatePerLap).toEqual(carOf(retired, 1).bigEventRatePerLap);
    expect(carOf(slowThenRetired, 1).retireRatePerLap).toEqual(carOf(retired, 1).retireRatePerLap);
    expect(slowThenRetired.aiField.bigEventRatePerLap).toEqual(retired.aiField.bigEventRatePerLap);
    // the retirement counts in the retirement rate
    expect(valueOf(carOf(retired, 1).retireRatePerLap)).toBeGreaterThan(valueOf(carOf(plain, 1).retireRatePerLap));
    expect(valueOf(retired.aiField.retireRatePerLap)).toBeGreaterThan(valueOf(plain.aiField.retireRatePerLap));
    expect(retired.aiField.bigEventRatePerLap).toEqual(plain.aiField.bigEventRatePerLap);
    // a 9 s slow green lap the car runs on from is a big event, no retirement
    expect(valueOf(carOf(bigLap, 2).bigEventRatePerLap)).toBeGreaterThan(valueOf(carOf(plain, 2).bigEventRatePerLap));
    expect(carOf(bigLap, 2).retireRatePerLap).toEqual(carOf(plain, 2).retireRatePerLap);
    expect(valueOf(bigLap.aiField.bigEventRatePerLap)).toBeGreaterThan(valueOf(plain.aiField.bigEventRatePerLap));
    expect(bigLap.aiField.retireRatePerLap).toEqual(plain.aiField.retireRatePerLap);
  });
});

// Row 10's stored sessions: the same 4-car field, car 3 a human (σ 900 in the first, 450 in the second), 12 and 20 laps.
const storedField = (sigmaMs: number): GeneratorCar[] =>
  Array.from({ length: 4 }, (_, i) => ({
    ...GENERATOR_DEFAULTS.field[0]!,
    paceMs: 90_000 + 400 * i,
    human: i === 3,
    sigmaMs: i === 3 ? sigmaMs : 200,
    rho: 0.3,
    stops: [],
    startCompound: 'medium' as const,
  }));
let sessions: ReturnType<typeof storedSession>[];
beforeAll(() => {
  const races: BuilderRace[] = [
    generateRace({ ...GENERATOR_DEFAULTS, cars: 4, laps: 12, field: storedField(900) }, 21).race,
    generateRace({ ...GENERATOR_DEFAULTS, cars: 4, laps: 20, field: storedField(450) }, 22).race,
  ];
  sessions = races.map((race, i) => storedSession(race, 3, `${100 + i}`));
});
