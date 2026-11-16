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

/**
 * The index of car `car`'s terms on compound `compound` (an index into `NOISE_COMPOUNDS`) in `StartingPoint.tyre`'s
 * arrays: `car * NOISE_COMPOUNDS.length + compound`.
 */
export const tyreIndex = (car: number, compound: number): number => car * NOISE_COMPOUNDS.length + compound;

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
  /** kg per lap: the car's measured burn, else its fuel over the laps left (`shared/fuel-burn.ts`, SP4.3c O15). */
  fuelBurnKgPerLap: Float64Array;
  paceMs: Float64Array;
  paceSdMs: Float64Array;
  sigmaMs: Float64Array;
  rho: Float64Array;
  mistakeRate: Float64Array;
  mistakeMedianMs: Float64Array;
  mistakeSigmaLog: Float64Array;
  bigEventRate: Float64Array;
  retireRate: Float64Array;
  /**
   * The tyre terms per car and compound, each array indexed `tyreIndex(car, compound)` (`car * NOISE_COMPOUNDS.length +
   * compound`): the wear rate (% per lap), the degradation (ms per % wear) and its σ, and the laps a fresh set lasts to
   * its wear limit (-1: no limit known).
   */
  tyre: { wearRatePct: Float64Array; degMsPerLap: Float64Array; degSdMs: Float64Array; lapsToLimit: Int16Array };
  stopLow: Int16Array;
  stopMid: Int16Array;
  stopHigh: Int16Array;
  owesStop: Uint8Array;
  /** Per car the fitted set's laps left to the limit (`tyre-model`'s `fittedLapsToLimit`, floored); −1 while unknown (SP4.3c Task 19). */
  fittedLapsToLimit: Int16Array;
  /** Per car `rival-stops`' next-compound odds; `null` while unknown (SP4.3c Task 18, O9). */
  nextOdds: (Partial<Record<NoiseCompound, number>> | null)[];
  /** Per car `rival-stops`' tyre-type switch from the game's delta; `null` while unknown (SP4.3c Task 18, O5). */
  typeSwitch: ({ lap: number; to: TyreType } | null)[];
  /** Our cars only. */
  sets: Record<CarId, { compound: NoiseCompound; wearPct: number }[]>;
  /** `wet`: track-wetness's one wet rule at the starting point (SP4.3c O3). */
  wetness: { wetnessMs: number; sdMs: number; wet: boolean };
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
  /**
   * The grid start (SP4.3d spec §7.2); `null` for a start inside the race. `freeCompound[k] = 1`: car k's start
   * compound comes from its policy's `startCompound`; `odds[k]`: car k's start compound is drawn from these options
   * (`null`: neither, the car keeps `compound[k]`).
   */
  start: null | { freeCompound: Uint8Array; odds: (StartOption[] | null)[] };
};

/** One drawn start option of a rival on the grid: its compound, its chance and its stop laps on it (SP4.3d spec §7.2). */
export type StartOption = { compound: NoiseCompound; p: number; stopLow: number; stopMid: number; stopHigh: number };

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
  /** The one wet rule's verdict for this lap (SP4.3c O3). */
  wet: boolean;
  scatterMs: number;
  mistakeMs: number;
};

/**
 * One car's stops to the flag (SP4.3d spec §5.1): a plan is a stop list. `startCompound` only before the start (the
 * planning round).
 */
export type Policy = { startCompound?: NoiseCompound; stops: { lap: number; compound: NoiseCompound }[] };

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
