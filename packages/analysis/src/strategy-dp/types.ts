// `strategy-dp`'s plain inputs and outputs (SP4.3b spec §6, C50): one car's stops and compounds to the flag, expected
// over the SC/VSC chances. Structured-cloneable; typed arrays are indexed by lap (index 0 = `fromLap`). Not in `domain`,
// whose types are JSON-safe.
import type { CarId, LapModelParams, NoiseCompound, StartingPoint, Trigger } from '@pitwall/domain';

/** The car's own lap-model inputs at `fromLap` (spec §6 Input). */
export type DpCarParams = {
  compound: NoiseCompound;
  /** Laps on the fitted set. */
  tyreAge: number;
  wearPct: number;
  fuelKg: number;
  paceMs: number;
  degMsPerLap: number;
  /** Wear per lap by compound in %; `null` where the car's wear is hidden (age only, spec §6). */
  wearRatePct: Record<NoiseCompound, number> | null;
  /** Whether a human drives the car (its stops are shorter, 4.3a). */
  human: boolean;
};

export type DpInput = {
  car: CarId;
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
  /** The plain forecast's track wetness per lap, ms. */
  wetnessByLap: Float64Array;
  /** The traffic cost of a rejoin per lap, ms, from the plain forecast. */
  trafficMsByLap: Float64Array;
};

/** One plan: its stops and its expected remaining race time. */
export type DpPlan = { stops: { lap: number; compound: NoiseCompound }[]; expectedMs: number };

/** Per lap the expected remaining race time boxing under a neutralisation and staying out: for `sc-call` (4.3b2). */
export type DpTable = { boxUnderMs: Float64Array; stayMs: Float64Array };

/** The best plan per stop count and sequence, the box-now and stay-out variants, the trigger thresholds, the table. */
export type DpResult = { plans: DpPlan[]; boxNow: DpPlan | null; stayOut: DpPlan; thresholds: Trigger[]; table: DpTable };
