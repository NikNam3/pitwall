// The forecast's plain inputs and outputs (SP4.3a spec 6, C50): the starting point `forecast-field` builds, the lap
// model's parameters and one car's lap, the policies and scenarios `race-forecast` runs, and its result. Plain and
// structured-cloneable (a job's input, C51); every array is indexed by car slot.
import type { NoiseCompound } from './analyses/driver-noise.ts';
import type { RaceInteraction } from './analyses/race-interaction.ts';
import type { TyreType } from './analyses/crossover.ts';
import type { CarId } from './ids.ts';

/** The compounds in `StartingPoint.compound`'s index order. */
export const NOISE_COMPOUNDS = ['soft', 'medium', 'hard', 'inter', 'wet'] as const satisfies readonly NoiseCompound[];

/** A DRS zone by lap fraction (the track file's `drsZones`). */
export type DrsZone = { detection: number; start: number; end: number };

/** The field at one frame, as the simulators start from it; built only by `forecast-field` (C50). */
export type StartingPoint = {
  lap: number;
  lapsTotal: number;
  cars: number;
  order: Int8Array;
  gapMs: Float64Array;
  lapFraction: Float64Array;
  retired: Uint8Array;
  human: Uint8Array;
  /** Index into `NOISE_COMPOUNDS`. */
  compound: Uint8Array;
  tyreAge: Int16Array;
  wearPct: Float64Array;
  fuelKg: Float64Array;
  paceMs: Float64Array;
  paceSdMs: Float64Array;
  degMsPerLap: Float64Array;
  degSdMs: Float64Array;
  sigmaMs: Float64Array;
  rho: Float64Array;
  mistakeRate: Float64Array;
  mistakeMedianMs: Float64Array;
  mistakeSigmaLog: Float64Array;
  bigEventRate: Float64Array;
  retireRate: Float64Array;
  wearRatePct: Float64Array;
  stopLow: Int16Array;
  stopMid: Int16Array;
  stopHigh: Int16Array;
  owesStop: Uint8Array;
  /** Our cars only. */
  sets: Record<CarId, { compound: NoiseCompound; wearPct: number }[]>;
  wetness: { wetnessMs: number; sdMs: number };
  track: { brakingZones: Float64Array; drsZones: DrsZone[]; pitLossMs: { green: number; vsc: number; sc: number } };
  /** Built by `forecast-field` (plan review P9, C50). */
  interaction: RaceInteraction;
  lapModel: LapModelParams;
};

/** The lap model's parameters (spec 6.2). */
export type LapModelParams = {
  compoundOffsetMs: Record<NoiseCompound, number>;
  /** 30 ms per kg (fixed prior). */
  fuelMsPerKg: number;
  /** The convex tyre term starts at about 40 % wear. */
  convexFromPct: number;
  convexMsPerPct2: number;
  /** The convex shape is a flagged prior. */
  convexFlagged: true;
  coldTyreMs: [lap1: number, lap2: number];
  coldTyreWetFactor: number;
  neutralised: Record<'sc' | 'vsc', { paceFactor: number; wearFactor: number; fuelFactor: number }>;
  wetnessMsPerMs: Record<TyreType, number>;
};

/** One car's lap as the lap model takes it. */
export type LapInput = {
  paceMs: number;
  degMsPerLap: number;
  wearPct: number;
  fuelKg: number;
  compound: NoiseCompound;
  lapOnSet: number;
  neutralised: 'none' | 'vsc' | 'sc';
  wetnessMs: number;
  scatterMs: number;
  mistakeMs: number;
};

/** One car's stops to the flag. */
export type Policy = { stops: { lap: number; compound: NoiseCompound }[] };

/** One scenario: its id (the draws' stream key), whether it draws nothing (`plain`), and its neutralisations. */
export type Scenario = { id: number; plain: boolean; neutralisations: { kind: 'sc' | 'vsc'; fromLap: number; toLap: number }[] };

/** Per lap, every car's position, gap and lap time. */
export type ForecastTrace = { lap: number; position: Int8Array; gapMs: Float64Array; lapTimeMs: Float64Array }[];

/** The field at the flag (or `toLap`), with the optional trace. */
export type ForecastResult = { position: Int8Array; gapMs: Float64Array; raceTimeMs: Float64Array; trace?: ForecastTrace };
