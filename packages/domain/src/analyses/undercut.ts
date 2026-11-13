// Value types of the `undercut` analysis (SP4.3b spec §9.1): per rival in range and N = 1–3, we box now and it N laps
// later (for a car behind, the mirror), scored until both have stopped plus one lap.
import type { CarId } from '../ids.ts';
import type { Known } from '../known.ts';
import type { Ms } from '../units.ts';

/** The gain bins of `UndercutCase.gainBins`: 0.5 s from −4 s to +4 s (spec §9.1, the approved mockup). */
export const UNDERCUT_GAIN_BINS = { fromMs: -4000, stepMs: 500, count: 16 } as const;

/** One case: N laps between the two stops; the expected gap change (positive = good), the chance we end ahead, the gain distribution, our rejoin position. */
export type UndercutCase = { n: 1 | 2 | 3; gainMs: Known<number>; pAhead: Known<number>; gainBins: Known<number[]>; rejoinPosition: Known<number> };

/** One rival in range: its side, place and current gap; we end ahead when the gain exceeds `aheadFromGainMs`. */
export type UndercutRival = {
  carId: CarId;
  side: 'ahead' | 'behind';
  position: number;
  /** ≥ 0. */
  gapMs: Ms;
  /** We end ahead when the gain exceeds this: +gap ahead, −gap behind. */
  aheadFromGainMs: number;
  cases: UndercutCase[];
};

/** `undercut.car`: our car's place, the range searched and the rivals in place order. */
export type Undercut = { carId: CarId; lap: number; position: number; rangeMs: Ms; rivals: UndercutRival[] };
