// `race-forecast`'s constants (SP4.3a spec 6.3). A simulator has no view and so no `config.ts` (C47 binds calculators
// and analyses); these are the model's fixed terms, each with its source.

/** A follower within this time of the car ahead at a DRS detection point may open its flap in that zone (F1 rules: 1 s). */
export const DRS_RANGE_MS = 1_000;
/** DRS is enabled from this lap on (F1 rules: lap 3), and off on a neutralised lap and the lap after one. */
export const DRS_FROM_LAP = 3;
/** The double stack: the second car of one pit box waits `max(0, DOUBLE_STACK_MS − entry gap)` (research 12 §5). */
export const DOUBLE_STACK_MS = 6_500;
/** A human's stop is this much shorter than an AI car's, stationary time (research 12 §5, research 13). */
export const HUMAN_STOP_SAVING_MS = 500;
/** A big slow lap (a spin, an off) costs between these (research 13: spins 5–10 s; spec 8: big events above 5 s). */
export const BIG_EVENT_MIN_MS = 5_000;
export const BIG_EVENT_MAX_MS = 10_000;
/** A passing car comes out this far ahead of the car it passed. */
export const PASS_MARGIN_MS = 1;
/** Plain mode: a held car passes once its summed hazard reaches ln 2, the median pass time (research 13 §10, new 13). */
export const MEDIAN_PASS_HAZARD = Math.LN2;
