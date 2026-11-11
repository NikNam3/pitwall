// The test-race generator (SP4.3a spec 6.4): races from known parameters, the synthetic truth the recovery tests of the
// estimation calculators and the forecast check against. Written independently of the simulators: it steps continuous
// time in 100 ms steps with a pass hazard over time (not per braking zone, the simulator's model), AR(1) scatter and
// log-normal mistakes, and records facts and spans as the engine appends them, one frame every 500 ms. Seeded; it reads
// no clock and no `Math.random` (C2). Imports are relative because the repo root does not link workspace packages.
import type { DrsZone, NoiseCompound } from '../../packages/domain/src/index.ts';
import type { BuilderRace } from '../builders/long-race.ts';

/** One car of the field, in grid order: `field[0]` starts on pole. */
export type GeneratorCar = {
  /** Its base lap time on a fresh soft set, before fuel, tyre age, scatter and mistakes. */
  paceMs: number;
  /** Driven by a human from the start (its `car-driver` span is `human`), else by the AI. */
  human: boolean;
  /** The stationary standard deviation of its lap-time scatter (AR(1)), in ms. */
  sigmaMs: number;
  /** The lap-to-lap correlation of its scatter. */
  rho: number;
  /** The chance of a mistake per lap. */
  mistakeRate: number;
  /** A mistake's time loss, log-normal: its median in ms and the σ of its log. */
  mistakeMedianMs: number;
  mistakeSigmaLog: number;
  /** Its tyre wear per lap as a multiple of the compound's `wearPctPerLap`. */
  wearFactor: number;
  /** Its stops: it pits at the end of lap `lap` (its in lap) and leaves on a fresh set of `compound`. */
  stops: { lap: number; compound: NoiseCompound }[];
  /** The compound it starts on; `soft` when absent. */
  startCompound?: NoiseCompound;
  /** A human car handed to the AI: its `human` span closes, and an `ai` span opens, on the frame it starts this lap. */
  takeoverLap?: number;
};

export type GeneratorParams = {
  cars: number;
  laps: number;
  trackM: number;
  /** By lap fraction, in lap order. */
  brakingZones: number[];
  /** By lap fraction (a zone may wrap past the line). */
  drsZones: DrsZone[];
  /** What a stop costs against staying out (the in lap and out lap together, the stationary time included), in ms. */
  pitLossMs: number;
  stationaryMs: number;
  fuelStartKg: number;
  fuelPerLapKg: number;
  /** Per compound: its lap-time offset against a fresh soft set, its time loss per lap of tyre age, its wear per lap. */
  compounds: Record<NoiseCompound, { offsetMs: number; degMsPerLap: number; wearPctPerLap: number }>;
  /** `field.length === cars`; `generateRace` throws otherwise. */
  field: GeneratorCar[];
  pass: {
    /** The hazard of passing per second while within `minGapMs` of the car ahead, by the follower's pace advantage in ms a lap. */
    hazardPerS: (advantageMs: number) => number;
    /** The hazard's multiple while the follower has DRS. */
    drsFactor: number;
    /** A car held up behind a slower one follows it at no less than this gap. */
    minGapMs: number;
  };
  /** A safety car, deployed during the leader's lap `fromLap` and in during its lap `toLap`. */
  sc?: { fromLap: number; toLap: number };
  /** From lap `fromLap` on, every lap is `wetnessMs` slower. */
  rain?: { fromLap: number; wetnessMs: number };
};

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

/** A race from `params`, as the views of its frames, and the parameters it was generated from (`truth`). */
export function generateRace(params: GeneratorParams, seed: number): { race: BuilderRace; truth: GeneratorParams } {
  void params;
  void seed;
  throw new Error('not implemented');
}
