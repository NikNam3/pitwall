// The one interface of a tyre type's module (SP4.3c spec §5.2): each type (slick, inter, wet) gives its wear rate, its
// lap-time loss per % of wear and its fresh-set offset from the inputs the unit chose; improving one type's model
// touches only its module.
import type { ActualCompound, Ms, TyreTerm } from '@pitwall/domain';
import type { EngineView } from '@pitwall/engine/readers';

/** A type's rate input: the rate the unit chose with its source, the track's wetness and the carcass where they apply. */
export type TypeRateInput = {
  /** The measured rate, the game's prior or the default, % per lap. */
  base: TyreTerm<number>;
  /** The track's wetness (ms, `track-wetness`'s slick loss) over the measured window and now; absent: not known. */
  wetnessMs?: { window: number; now: number };
  /** The carcass temperature (°C) the base rate assumes and the carcass now; absent: the game simulates none (AI cars). */
  carcassC?: { basis: number; now: number };
  config: EngineView['config'];
};

/** A type's loss input: the fitted set's actual compound and the game's loss per % where the unit measured it. */
export type TypeLossInput = {
  actual: ActualCompound;
  /** The game's loss per % of wear (`gameLossMsPerPct`), ms; absent below the noise threshold or without the sets. */
  gameMsPerPct?: number;
  config: EngineView['config'];
};

/** A type's offset input: the game's fresh-set delta against a fresh medium and the track file's offset, where known. */
export type TypeOffsetInput = {
  /** The best fresh set's delta against the best fresh medium, as the game gives the sets, ms. */
  gameMs?: Ms;
  /** The track file's offset of the compound against medium, ms. */
  trackMs?: Ms;
  config: EngineView['config'];
};

export type TypeModule = {
  wearRatePct(input: TypeRateInput): TyreTerm<number>;
  lossMsPerPct(input: TypeLossInput): TyreTerm<number>;
  freshOffsetMs(input: TypeOffsetInput): TyreTerm<Ms>;
};
