// The forecast's plain inputs and outputs (SP4.3a spec 6, C50): the starting point `forecast-field` builds, the lap
// model's parameters and one car's lap, the policies and scenarios `race-forecast` runs, and its result. Plain and
// structured-cloneable (a job's input, C51); every array is indexed by car slot.
import type { NoiseCompound } from './analyses/driver-noise.ts';
import type { RaceInteraction } from './analyses/race-interaction.ts';
import type { TyreType } from './analyses/crossover.ts';
import type { CarId } from './ids.ts';
import type { Known } from './known.ts';
import type { Ms } from './units.ts';

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
  /**
   * The weather forecast's samples mapped onto race laps by the leader's lap time: per lap its rain chance (0–100) and
   * the forecast's accuracy (SP4.3b spec §7.1, S12); unknown where no forecast reached the view (C3).
   */
  weather: Known<{ byLap: { lap: number; rainPct: number }[]; accuracy: 'perfect' | 'approximate' }>;
  /** `inLapShare`: the part of a stop's loss paid on the in lap, the rest on the out lap (SP4.3b spec §4.2, F2). */
  track: { brakingZones: Float64Array; drsZones: DrsZone[]; pitLossMs: { green: number; vsc: number; sc: number; inLapShare: number } };
  /** DRS: a car within `rangeMs` of the car ahead at a detection point may open it, from lap `fromLap` (SP4.3b spec §4.2, F7). */
  drs: { rangeMs: Ms; fromLap: number };
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

/**
 * A reaction a plan carries (SP4.3b spec §6, §8.2): when its condition holds in a scenario, the car does its action.
 * The closed list of kinds; every threshold is the DP's as at the plan. `degradationOff` carries the plan it switches
 * to, never an index: a decision must replay alone (C76).
 */
export type Trigger =
  | { kind: 'neutralised'; condition: 'sc' | 'vsc'; fromLap: number; toLap: number; action: { box: NoiseCompound } | 'stayOut' }
  | { kind: 'rain'; wetnessMs: number; action: { box: NoiseCompound } }
  | { kind: 'rivalPits'; carId: CarId; withinMs: Ms; action: 'cover' | 'extend' }
  | { kind: 'degradationOff'; wearRateDeltaPct: number; action: { switchTo: { lap: number; compound: NoiseCompound }[] } }
  | { kind: 'damage'; lossMsPerLap: Ms; action: { box: NoiseCompound } };

/** One car's stops to the flag, and the triggers that change them inside a scenario. */
export type Policy = { stops: { lap: number; compound: NoiseCompound }[]; triggers: Trigger[] };

/**
 * One scenario: its id (the draws' stream key), whether it draws nothing (`plain`), and its neutralisations.
 * `wetnessByLap[i]`: the track's wetness (ms) on lap `start.lap + i` (the last entry beyond its end, the starting
 * point's before `start.lap`); absent, every lap has the starting point's wetness (SP4.3b spec §7.1, Task 19b).
 */
export type Scenario = { id: number; plain: boolean; neutralisations: { kind: 'sc' | 'vsc'; fromLap: number; toLap: number }[]; wetnessByLap?: Float64Array };

/** Per lap, every car's position, gap and lap time. */
export type ForecastTrace = { lap: number; position: Int8Array; gapMs: Float64Array; lapTimeMs: Float64Array }[];

/** The field at the flag (or `toLap`), with the optional trace. */
export type ForecastResult = { position: Int8Array; gapMs: Float64Array; raceTimeMs: Float64Array; trace?: ForecastTrace };
