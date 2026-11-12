// `driver-noise`'s driver of a car at the view's frame comes from the open car-driver span only (SP4.3a final review
// F3; C20, C26, C28): no reader works out a situation from closed spans itself. A stored session's as-of view holds
// the spans covering its last frame open (`asOfStored`), so a car without an open car-driver span has no driver now:
// `unknown`, never the kind of its newest closed span.
//
// The race: 6 cars over 30 laps, car 5 a human handed to the AI at the start of lap 20. At the flag its open
// car-driver span is `ai` and its closed one `human`.
import { carId, type CarNoise, type DriverNoise } from '@pitwall/domain';
import { asOfNow, type AsOfView } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { driverNoiseAsOf } from '../../src/driver-noise/index.ts';
import { generateRace, GENERATOR_DEFAULTS, type GeneratorCar } from '../../../../test-support/race-generator/index.ts';
import { viewAt } from './support.ts';

const CAR = 5;

const genCar = (paceMs: number, over: Partial<GeneratorCar> = {}): GeneratorCar => ({
  paceMs, human: false, sigmaMs: 200, rho: 0.3, mistakeRate: 0.02, mistakeMedianMs: 1_500, mistakeSigmaLog: 0.6, wearFactor: 1, stops: [], startCompound: 'medium', ...over,
});
const field = Array.from({ length: 6 }, (_, i) => genCar(90_000 + 400 * i, i === CAR ? { human: true, sigmaMs: 450, takeoverLap: 20 } : {}));
const race = generateRace({ ...GENERATOR_DEFAULTS, cars: 6, laps: 30, field }, 4).race;

const carOf = (out: DriverNoise): CarNoise => {
  const noise = out.cars[carId(CAR)];
  if (noise === undefined) throw new Error(`no entry for car ${CAR}`);
  return noise;
};

describe("driver-noise: the driver now is the open car-driver span's (F3)", () => {
  const view = viewAt(race, race.lastFrame);
  const asOf: AsOfView = { ...asOfNow(view), outputs: view.outputs };

  it('the race: car 5 has a closed human span and an open ai span at the flag', () => {
    expect((view.history.spans['car-driver'] ?? []).some((s) => s.carId === CAR && s.kind === 'human')).toBe(true);
    expect((view.situation.byMachine['car-driver'] ?? []).find((s) => s.carId === CAR)?.kind).toBe('ai');
    expect(carOf(driverNoiseAsOf(asOf)).driver).toBe('ai');
  });

  it('without an open car-driver span the driver is unknown, not the newest closed span\'s kind', () => {
    const byMachine = {
      ...asOf.situation.byMachine,
      'car-driver': (asOf.situation.byMachine['car-driver'] ?? []).filter((s) => s.carId !== CAR),
    };
    const out = driverNoiseAsOf({ ...asOf, situation: { ...asOf.situation, byMachine } });
    expect(carOf(out).driver).toBe('unknown');
  });
});
