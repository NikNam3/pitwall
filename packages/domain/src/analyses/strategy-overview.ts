// Value types of the `strategy-overview` analysis (SP4.3d spec §6.4): the field's strategies in one table.
import type { VisualCompound } from '../compounds.ts';
import type { Policy } from '../forecast.ts';
import type { CarId } from '../ids.ts';
import type { Known } from '../known.ts';
import type { Ms } from '../units.ts';
import type { NoiseCompound } from './driver-noise.ts';

/** One car's row; `plan` only on our cars. */
export type OverviewRow = {
  carId: CarId;
  position: number;
  gapMs: Known<Ms>;
  compound: Known<VisualCompound>;
  tyreAge: Known<number>;
  stops: number;
  owesCompound: Known<boolean>;
  pastStints: { fromLap: number; toLap: number; compound: VisualCompound }[];
  window: Known<{ lowLap: number; midLap: number; highLap: number }>;
  nextCompound: Known<Partial<Record<NoiseCompound, number>>>;
  plan: { a: Policy | null; b: Policy | null } | null;
};

/** `strategyOverview.car`: the rows of the field, and the pit loss they share. */
export type StrategyOverview = { carId: CarId; lossMs: Known<Ms>; rows: OverviewRow[] };
