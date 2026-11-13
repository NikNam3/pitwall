// `race-monte-carlo`'s fixed terms (SP4.3b spec §7). A simulator has no view and so no `config.ts` (C47 binds
// calculators and analyses); the search's and the rivals' values arrive in `McInput` from `strategy`'s config. These
// are the model's fixed terms, each with its source.

/**
 * The cover rule's gap (spec §7.2 ablation, only with `coverRule`): a rival ahead of our stopping car by at most this
 * at the line ending our in-lap covers with a stop on the next lap. Source: `strategy`'s `ruleGapMs` 3,000 ms (spec
 * §11.1), `forecast-score`'s `closeGapMs` (research 12 §8).
 */
export const COVER_GAP_MS = 3_000;

/**
 * The share of a car's scenario-policies the search keeps back for scoring the top few again on common scenarios
 * (spec §7.3 step 5). Source: pitwall estimate (a quarter: the search's batches of `n0` keep the rest).
 */
export const RESCORE_SHARE = 0.25;

/** The draws' purposes of the scenario streams (spec §7.1); apart from `race-forecast`'s, which use another base seed. */
export const MC_PURPOSE = { scStart: 1, scLength: 2, vscStart: 3, vscLength: 4, activeLength: 5, rivalLap: 6, rivalSc: 7, rain: 8, forecastShift: 9 } as const;

// The rain timeline's wetness dynamics (spec §7.1, Task 19b). `track-wetness` has no prediction model of its own (its
// filter is a random walk; the forecast only widens its step, R19), so these are the simulator's, flagged as pitwall
// estimates. The check to make: on the wet recordings (Singapore 2026-10-29_00-04-08, Mexico 2026-10-30_15-20-41,
// Miami 2026-10-30_18-53-00) compare track-wetness's filtered state per lap against the game's rain per lap, and fit
// the rise per rain lap, the fall per dry lap and the ceiling.

/**
 * How much a lap of rain raises the track's wetness (ms of a slick's loss). Source: pitwall estimate (flagged): from a
 * dry track three laps of rain pass the slick/inter crossover at about 7 s (research 19 §4).
 */
export const WETNESS_RISE_MS_PER_LAP = 2_500;
/**
 * How much a dry lap lowers it. Source: pitwall estimate (flagged): a track dries slower than it wets, about 7 laps
 * from the slick/inter crossover back to dry.
 */
export const WETNESS_FALL_MS_PER_LAP = 1_000;
/** The wetness of a fully wet track. Source: pitwall estimate (flagged): the highest inter excess seen, about 16 s (Miami, research 19 §4), is a slick wetness of about 25 s at the inter slope 0.5. */
export const WETNESS_MAX_MS = 25_000;
/**
 * An approximate forecast's timing error: per scenario the forecast is read this many laps (sd, normal, rounded)
 * earlier or later. Source: pitwall estimate (flagged; S12: wider when approximate). The check: the game's
 * approximate forecasts against the rain that came, on the wet recordings.
 */
export const APPROXIMATE_SHIFT_SD_LAPS = 2;
