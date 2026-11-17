// `strategy-dp`'s plain inputs and outputs (SP4.3b spec §6; SP4.3c spec §5.4, Task 9's shape, C50): one car's stops and
// compounds to the flag, expected over the SC/VSC chances, per weather world. Structured-cloneable; typed arrays are
// indexed by lap (index 0 = `fromLap`). Not in `domain`, whose types are JSON-safe; the plans are JSON-safe, the table
// is not.
import type { CarId, LapModelParams, NoiseCompound, StartingPoint } from '@pitwall/domain';

/** The car's own lap-model inputs at `fromLap` (spec §6 Input), its tyre terms per compound (SP4.3c Task 12, B5). */
export type DpCarParams = {
  compound: NoiseCompound;
  /** Laps on the fitted set. */
  tyreAge: number;
  wearPct: number;
  fuelKg: number;
  /** kg per lap: the starting point's burn (`StartingPoint.fuelBurnKgPerLap`, `shared/fuel-burn.ts`, SP4.3c O15). */
  fuelBurnKgPerLap: number;
  paceMs: number;
  /** ν per compound: the loss per lap of wear on that compound (`StartingPoint.tyre`). */
  degMsPerLap: Record<NoiseCompound, number>;
  /** Wear per lap by compound in %; `null` where the car's wear is hidden (age only, spec §6). */
  wearRatePct: Record<NoiseCompound, number> | null;
  /** A new set's laps to the 70 % limit per compound (`StartingPoint.tyre`); `null`: none known (SP4.3c §5.2). */
  lapsToLimit: Record<NoiseCompound, number | null>;
  /** The fitted set's laps left to the limit (0: at or past it; it still runs `fromLap`); `null`: none known. */
  fittedLapsToLimit: number | null;
  /** Whether a human drives the car (its stops are shorter, 4.3a). */
  human: boolean;
};

/** One weather world (`weather-paths`' `weatherWorlds`, O3b): its `u`, weight and per lap its wetness and traffic. */
export type DpWorld = {
  u: number;
  /** The worlds' weights sum to 1. */
  weight: number;
  /** The world's track wetness per lap, ms. */
  wetnessByLap: Float64Array;
  /** The traffic cost of a rejoin per lap, ms, from the world's plain forecast. */
  trafficMsByLap: Float64Array;
};

export type DpInput = {
  car: CarId;
  /**
   * The start compound (SP4.3d spec §7.2): `carParams.compound` for a car on its tyres; `null` on the grid where the
   * start is free: the car starts on a new set of the compound the DP picks among those with a set left, that set
   * counted in the sets used and the compound rule reading it as the car's compound; `carParams.compound`, `tyreAge`,
   * `wearPct` and `fittedLapsToLimit` are then not read.
   */
  startCompound: NoiseCompound | null;
  fromLap: number;
  totalLaps: number;
  lap: LapModelParams;
  carParams: DpCarParams;
  /** New sets left per compound. */
  sets: Record<NoiseCompound, number>;
  /** The compound rule: a second dry compound is still owed. */
  owesSecondCompound: boolean;
  pitLossMs: StartingPoint['track']['pitLossMs'];
  /** Per lap the start chance of an SC (`byLap`) and a VSC; the duration pmfs (index 0 = 1 lap). */
  hazard: { byLap: Float64Array; vscByLap: Float64Array; scDur: Float64Array; vscDur: Float64Array };
  /** The neutralisation out now with the pmf of its laps left (index 0 = it ends this lap), else `null`. */
  active: { condition: 'sc' | 'vsc'; remaining: Float64Array } | null;
  /** The weather worlds, the heaviest first (one of weight 1 where no rain can come); each solved alone. */
  worlds: DpWorld[];
};

/**
 * One plan: its stops, its expected remaining race time and the world it was solved in; on a free start
 * (`DpInput.startCompound` `null`) the compound it starts on, else no `startCompound`.
 */
export type DpPlan = { startCompound?: NoiseCompound; stops: { lap: number; compound: NoiseCompound }[]; expectedMs: number; world: number };

/** Per lap the expected remaining race time boxing under a neutralisation and staying out: for `sc-call` (4.3b2). */
export type DpTable = { boxUnderMs: Float64Array; stayMs: Float64Array };

/**
 * Per world the best plan per stop count and compound sequence; the box-this-lap and continue plays, the table (the
 * heaviest world's, the first on equal weights).
 */
export type DpResult = { plans: DpPlan[]; boxThisLap: DpPlan | null; continue: DpPlan; table: DpTable };

/** A call's first stop (4.3b2): at `stopLap` onto `compound` (`'best'`: the DP picks), or no stop through `noStopThrough`. */
export type DpFirst = { stopLap: number; compound: NoiseCompound | 'best' } | { noStopThrough: number };

/** A neutralisation forced at the start lap, with the pmf of its laps left (index 0 = it ends this lap). */
export type DpUnder = { condition: 'sc' | 'vsc'; remaining: Float64Array };
