// Value types of the `talk-window` analysis (spec 6.3).
import type { Known } from '../known.ts';

/**
 * `talkWindow.car`: whether the car is in or just before a braking zone (`busy`) or not (`clear`). Our cars only;
 * `notApplicable` for any other car, without a track file or without braking zones.
 */
export type TalkWindow = { talk: Known<'clear' | 'busy'> };
