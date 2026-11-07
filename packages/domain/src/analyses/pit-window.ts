// Value types of the `pit-window` analysis (SP4.2 spec 3.4). Every lap it names is a stop lap: the lap at whose end the car boxes.
import type { VisualCompound } from '../compounds.ts';
import type { CarId } from '../ids.ts';
import type { Known } from '../known.ts';

/** Where the car stands against its window: `none` means no same-type compound has a window (never missing data). */
export type PitWindowState = 'before' | 'lead' | 'open' | 'closed' | 'none';

/** One compound we still have a new set of and may fit (the compound rule applied). */
export type PitWindowSet = {
  compound: VisualCompound;
  /** Of the fitted set's type: dry for a dry set; inter or wet for an inter or wet one. */
  sameType: boolean;
  lifeLaps: Known<number>;
  /** The first stop lap from which a new set of it reaches the flag. */
  earliest: Known<number>;
  /** `latest + lifeLaps`: the last lap the set could run when fitted at `latest`. */
  lifeEnd: Known<number>;
  /** `lifeEnd ≥ flag`; unknown while `lifeEnd` is. */
  reaches: Known<boolean>;
  /** Its window, stop laps `from` (its `earliest`) to `to` (`stint.latest`); `notApplicable` when it has none, unknown while `stint.latest` is. */
  windowLaps: Known<{ from: number; to: number }>;
  /** Where the car stands against this set's window, by the same rules as `PitWindow.window`; `none` without a window. */
  state: Known<PitWindowState>;
};

/** `pitWindow.car` (a `Known` of it: `notApplicable` outside the race, `notReceived` until the tyre sets arrive). */
export type PitWindow = {
  carId: CarId;
  /** The race's lap count. */
  flag: number;
  currentLap: number;
  stint: {
    compound: VisualCompound;
    fromLap: number;
    latest: Known<number>;
    /** False when no stop is needed (the compound rule met and the fitted set reaches the flag); unknown while `latest` is. */
    stopNeeded: Known<boolean>;
    /** The fitted set is at or past its limit (`lapsToLimit` below 1, or the current lap beyond `latest`). */
    pastLimit: boolean;
  };
  sets: PitWindowSet[];
  /** Unknown while `stint.latest` is. */
  window: Known<PitWindowState>;
  /** The first same-type compound with a window; `notApplicable` for `none`, unknown while `window` is. */
  windowCompound: Known<VisualCompound>;
};
