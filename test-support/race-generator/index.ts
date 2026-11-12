// The test-race generator (SP4.3a spec 6.4): races from known parameters, the synthetic truth the recovery tests of the
// estimation calculators and the forecast check against. Written independently of the simulators: it steps continuous
// time in 100 ms steps with a pass hazard over time (not per braking zone, the simulator's model), AR(1) scatter and
// log-normal mistakes, and records facts and spans as the engine appends them, one frame every 500 ms. Seeded; it reads
// no clock and no `Math.random` (C2). Imports are relative because the repo root does not link workspace packages.
import type { BuilderRace } from '../builders/long-race.ts';
import { record } from './record.ts';
import { simulate } from './simulate.ts';
import type { GeneratorCar, GeneratorParams } from './types.ts';

export type { GeneratorCar, GeneratorParams } from './types.ts';
export { FUEL_MS_PER_KG, SC_LAP_FACTOR } from './simulate.ts';

const AI_CARS = 18;

/** A 20-car, 50-lap dry race: 18 AI cars 120 ms apart a lap (σ 200 ms) and two humans (σ 450 and 900 ms), one stop each, medium to hard. */
export const GENERATOR_DEFAULTS: GeneratorParams = {
  cars: 20,
  laps: 50,
  trackM: 5_000,
  brakingZones: [0.08, 0.3, 0.45, 0.62, 0.8],
  drsZones: [
    { detection: 0.88, start: 0.95, end: 0.05 },
    { detection: 0.4, start: 0.5, end: 0.58 },
  ],
  pitLossMs: 22_000,
  stationaryMs: 2_500,
  fuelStartKg: 100,
  fuelPerLapKg: 1.8,
  compounds: {
    soft: { offsetMs: 0, degMsPerLap: 80, wearPctPerLap: 3 },
    medium: { offsetMs: 600, degMsPerLap: 50, wearPctPerLap: 2 },
    hard: { offsetMs: 1_100, degMsPerLap: 30, wearPctPerLap: 1.4 },
    inter: { offsetMs: 6_000, degMsPerLap: 100, wearPctPerLap: 2.5 },
    wet: { offsetMs: 9_000, degMsPerLap: 80, wearPctPerLap: 2 },
  },
  field: Array.from({ length: 20 }, (_, i): GeneratorCar => {
    const human = i >= AI_CARS;
    return {
      paceMs: 90_000 + 120 * i,
      human,
      sigmaMs: human ? (i === AI_CARS ? 450 : 900) : 200,
      rho: human ? 0.4 : 0.3,
      mistakeRate: human ? 0.05 : 0.02,
      mistakeMedianMs: 1_500,
      mistakeSigmaLog: 0.6,
      wearFactor: 1,
      stops: [{ lap: 18 + (i % 5), compound: 'hard' }],
      startCompound: 'medium',
    };
  }),
  pass: { hazardPerS: (advantageMs) => (advantageMs <= 0 ? 0 : 0.05 * (1 - Math.exp(-advantageMs / 300))), drsFactor: 2, minGapMs: 1_000 },
};

/** Throws on parameters the generator cannot race: a field of another size than `cars`, stops it cannot make, a safety car outside the race. */
function validate(p: GeneratorParams): void {
  if (p.field.length !== p.cars) throw new Error(`generateRace: ${p.field.length} cars in the field for cars = ${p.cars}`);
  if (p.cars < 1 || p.cars > 22 || p.laps < 1 || p.laps > 160 || p.trackM <= 0) throw new Error('generateRace: needs 1 to 22 cars, 1 to 160 laps and a track');
  if (p.pitLossMs < p.stationaryMs) throw new Error('generateRace: pitLossMs must include stationaryMs');
  p.field.forEach((car, i) => {
    car.stops.forEach((stop, k) => {
      const before = car.stops[k - 1];
      if (stop.lap < 1 || stop.lap >= p.laps || (before !== undefined && stop.lap < before.lap + 2))
        throw new Error(`generateRace: car ${i}'s stop on lap ${stop.lap} is not an in lap of the race at least two laps after the one before`);
    });
  });
  if (p.sc !== undefined && (p.sc.fromLap < 1 || p.sc.toLap < p.sc.fromLap || p.sc.toLap > p.laps)) throw new Error('generateRace: the safety car lies outside the race');
}

/**
 * A race from `params`, as the views of its frames, and the parameters it was generated from (`truth`, the same object).
 * Lights out at 1 s; the field leaves the grid in field order, each car `minGapMs` + 500 ms behind the one ahead. A lap's
 * target is `paceMs` + the compound's offset + its `degMsPerLap` per lap of tyre age + 30 ms per kg of fuel at its start
 * (`FUEL_MS_PER_KG`) + the AR(1) scatter + a mistake + `wetnessMs` from the rain's lap; an in lap adds 30 % of the pit
 * loss without the stop, the out lap the rest and the stop. Under the safety car every car laps 1.4 times slower and
 * nobody passes. A pass puts the passer 1 m ahead of the car it passed (an `overtake` event). The race ends on the frame
 * after the leader completes its last lap (its confirmed record's frame).
 */
export function generateRace(params: GeneratorParams, seed: number): { race: BuilderRace; truth: GeneratorParams } {
  validate(params);
  return { race: record(params, simulate(params, seed)), truth: params };
}
