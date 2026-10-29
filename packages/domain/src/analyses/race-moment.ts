// Value types of the `race-moment` analysis (spec 7, A.3).
import type { SessionTime } from '../ids.ts';
import type { Known } from '../known.ts';

/** The race moments, highest priority first (spec 7.2). */
export type Moment = 'neutralised' | 'incident' | 'weather' | 'battle' | 'carCare';

/** `raceMoment.current` (a `Known` of it: `notApplicable` outside the race). */
export type RaceMoment = {
  moment: Moment;
  /** From the cause: the flag phase start or the incident time; `notApplicable` for battle, weather and car care. */
  since: Known<SessionTime>;
  /** The rule that set the moment and its values. */
  cause: { rule: string; params: Record<string, number | string> };
  /** Every moment that holds now, the current one included, highest priority first. */
  active: Moment[];
};
