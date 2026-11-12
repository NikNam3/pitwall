// The test-race generator's parameters (SP4.3a spec 6.4): a race's truth.
import type { DrsZone, NoiseCompound } from '../../packages/domain/src/index.ts';

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
