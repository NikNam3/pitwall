// `driver-noise`'s qualifying row (SP4.3d2 Task 6, SP4.3d spec §7.2; contract C3, C14, C41, C44, C62c, C62d): the
// planning job runs the race's starting point on the ended qualifying session's as-of view, its `fixed.totalLaps` the
// race's entered laps (C62d). On it every car's noise model gives known values: a human's from the session's laps (as
// non-race laps) shrunk towards its profile (C62c), else the human default; an AI car's the config's AI values, and the
// AI field's rates the config's too. Practice and `none` stay `notApplicable`.
import { carId, known, unknown, type CarNoise, type DriverNoise, type DriverProfile, type Known } from '@pitwall/domain';
import { asOfNow, type AsOfView, type EngineView } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { driverNoiseCalculator } from '../../src/driver-noise/calculator.ts';
import { DRIVER_NOISE_BEHAVIOUR } from '../../src/driver-noise/behaviour.ts';
import { DRIVER_NOISE_CONFIG, driverNoiseAsOf } from '../../src/driver-noise/index.ts';
import { guardedQuick, NONE, PRACTICE, QUALIFYING } from '../situated.ts';
import { rowView, type CarLaps, type CarSituation } from './support.ts';

const calc = guardedQuick(driverNoiseCalculator);
const D = DRIVER_NOISE_CONFIG.defaults;

/** The race's laps as the user entered them in the planning round. */
const RACE_LAPS = 44;

/** Shrinkage off: a value is the session's own estimate where it has one. */
const SESSION_ONLY: EngineView['config'] = { 'driver-noise': { shrinkLaps: 0 } };
/** Shrinkage so strong the session's laps barely move the prior. */
const PRIOR_ONLY: EngineView['config'] = { 'driver-noise': { shrinkLaps: 1e9 } };

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

/** Car 0 (AI) and car 1 (human) each ran 22 laps in the session; laps 2 … 22 their pace laps, the human's spread three times wider. */
const AI_RESIDUAL = (n: number): number => spread(n - 2);
const HUMAN_RESIDUAL = (n: number): number => 3 * spread(n - 2);
const HUMAN_SIGMA = madSigma(Array.from({ length: 21 }, (_, i) => HUMAN_RESIDUAL(i + 2)));
const FIELD: (CarLaps & CarSituation)[] = [
  { car: 0, to: 22, residual: AI_RESIDUAL },
  { car: 1, to: 22, residual: HUMAN_RESIDUAL, driver: 'human' },
];

/** `view.drivers` with slot `slot` linked to person `person` whose entries are `entries`, every other slot unlinked. */
function linked(slot: number, person: string, entries: Record<string, number>): EngineView['drivers'] {
  const profile: DriverProfile = {
    person,
    displayName: person.toUpperCase(),
    entries: Object.fromEntries(Object.entries(entries).map(([key, value]) => [key, { value: known(value, 0), laps: 120, sessions: 3, newestSession: '2026-11-05' }])),
  };
  return Array.from({ length: 22 }, (_, i) => (i === slot ? known(profile, 0) : unknown('notApplicable')));
}
const PROFILE = linked(1, 'dr', { 'driverNoise.sigmaMs': 380, 'driverNoise.rho': 0.25, 'driverNoise.mistakeRate': 0.03 });

/** The ended qualifying session's view (`rowView`'s laps, `degradation`'s and `track-wetness`'s outputs given). */
const qualifyingView = (o: { drivers?: EngineView['drivers']; config?: EngineView['config'] } = {}): EngineView => rowView(FIELD, { phase: QUALIFYING, ...o });

/** The planning view (C62d): the session's as-of view with `fixed.totalLaps` the race's entered laps. */
const planningView = (view: EngineView): AsOfView => {
  const now = asOfNow(view);
  return { ...now, fixed: { ...now.fixed, totalLaps: known(RACE_LAPS, 0) } };
};

const carOf = (out: DriverNoise, car: number): CarNoise => {
  const noise = out.cars[carId(car)];
  if (noise === undefined) throw new Error(`no entry for car ${car}`);
  return noise;
};

const valueOf = <T>(k: Known<T>): T => {
  if (!k.known) throw new Error(`unknown: ${k.reason}`);
  return k.value;
};

describe("driver-noise's qualifying row (SP4.3d2 Task 6)", () => {
  it('the behaviour table gives qualifying a row of its own; practice and none stay outside the race', () => {
    const rows = DRIVER_NOISE_BEHAVIOUR['weekend-phase']!;
    expect(rows['qualifying']).not.toEqual(rows['practice']);
    for (const kind of ['practice', 'none']) expect(rows[kind]?.isRace, kind).toBe(false);
  });

  it("a qualifying session's as-of view gives every car known values (not notApplicable), the AI field's too", () => {
    const view = qualifyingView({ drivers: PROFILE });
    const out = driverNoiseAsOf(planningView(view));
    // its scheduled run on the session's view, through its guarded view (C41), is the same
    expect(calc.compute(view)).toEqual(out);
    for (const car of [0, 1]) {
      const noise = carOf(out, car);
      for (const key of ['sigmaMs', 'rho', 'mistakeRatePerLap', 'mistakeSize', 'bigEventRatePerLap', 'retireRatePerLap'] as const) {
        expect(noise[key].known, `car ${car} ${key}`).toBe(true);
      }
    }
    for (const [key, value] of Object.entries(out.aiField)) expect(value.known, `aiField ${key}`).toBe(true);
  });

  it("an AI car is at the config's AI values, and the AI field's rates are the config's, whatever its session laps", () => {
    for (const config of [undefined, SESSION_ONLY]) {
      const out = driverNoiseAsOf(planningView(qualifyingView(config === undefined ? {} : { config })));
      const ai = carOf(out, 0);
      const label = config === undefined ? 'default shrinkage' : 'shrinkage off';
      expect(ai.driver, label).toBe('ai');
      expect(valueOf(ai.sigmaMs), label).toBeCloseTo(D.aiSigmaMs, 9);
      expect(valueOf(ai.rho), label).toBeCloseTo(D.aiRho, 9);
      expect(valueOf(ai.mistakeRatePerLap), label).toBeCloseTo(D.aiMistakeRate, 9);
      expect(valueOf(ai.mistakeSize), label).toEqual({ medianMs: D.aiMistakeMedianMs, sigmaLog: D.aiMistakeSigmaLog });
      expect(valueOf(ai.bigEventRatePerLap), label).toBeCloseTo(D.aiBigEventRate, 9);
      expect(valueOf(ai.retireRatePerLap), label).toBeCloseTo(D.aiRetireRate, 9);
      expect(valueOf(out.aiField.mistakeRatePerLap), label).toBeCloseTo(D.aiMistakeRate, 9);
      expect(valueOf(out.aiField.bigEventRatePerLap), label).toBeCloseTo(D.aiBigEventRate, 9);
      expect(valueOf(out.aiField.retireRatePerLap), label).toBeCloseTo(D.aiRetireRate, 9);
    }
  });

  it("a human's model rests on the session's laps, as non-race laps", () => {
    const human = carOf(driverNoiseAsOf(planningView(qualifyingView({ config: SESSION_ONLY }))), 1);
    expect(human.driver).toBe('human');
    expect(human.laps).toBeGreaterThan(0);
    expect(valueOf(human.sigmaMs)).toBeCloseTo(HUMAN_SIGMA, 6);
    expect(human.source.kind).toBe('session');
  });

  it("a human's prior is its profile (C62c), else the human default", () => {
    const profiled = carOf(driverNoiseAsOf(planningView(qualifyingView({ drivers: PROFILE, config: PRIOR_ONLY }))), 1);
    expect(valueOf(profiled.sigmaMs)).toBeCloseTo(380, 3);
    expect(valueOf(profiled.rho)).toBeCloseTo(0.25, 6);
    expect(valueOf(profiled.mistakeRatePerLap)).toBeCloseTo(0.03, 6);
    expect(profiled.source).toMatchObject({ kind: 'profile', person: 'dr' });

    const plain = carOf(driverNoiseAsOf(planningView(qualifyingView({ config: PRIOR_ONLY }))), 1);
    expect(valueOf(plain.sigmaMs)).toBeCloseTo(D.humanSigmaMs, 3);
    expect(plain.source.kind).toBe('default');

    // the default shrinkage blends the two: between the profile's σ and the session's
    const blended = valueOf(carOf(driverNoiseAsOf(planningView(qualifyingView({ drivers: PROFILE }))), 1).sigmaMs);
    expect(blended).toBeGreaterThan(Math.min(380, HUMAN_SIGMA));
    expect(blended).toBeLessThan(Math.max(380, HUMAN_SIGMA));
  });

  it('practice rows unchanged: practice and none stay notApplicable', () => {
    const na = unknown('notApplicable');
    for (const phase of [PRACTICE, NONE]) {
      const out = driverNoiseAsOf(planningView(rowView(FIELD, { phase, drivers: PROFILE })));
      expect(out.aiField, phase.kind).toEqual({ mistakeRatePerLap: na, bigEventRatePerLap: na, retireRatePerLap: na });
      for (const car of [0, 1]) expect(carOf(out, car).sigmaMs, `${phase.kind} car ${car}`).toEqual(na);
    }
  });
});
