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
 * How much a lap of rain raises the track's wetness (ms of a slick's loss). Source: spike 4.3b-defaults (research 19
 * wetness): Singapore's rain onset, slick lap 24 to inter lap 27, +17.0 s over 2 rain laps: 8,501 ± 109 ms/lap (17 cars;
 * 5,667 if lap 25 counts); one onset, thin; the inter scale (3,500 / 0.5) is assumed.
 */
export const WETNESS_RISE_MS_PER_LAP = 8_500;
/**
 * How much a dry lap lowers it. Source: spike 4.3b-defaults (research 19 wetness): Singapore's drying start, inter lap 3
 * (12.0 s) to slick lap 7 (−0.4 s): 3,104 ± 106 ms/lap (18 cars); one drying, thin; the inter scale is assumed.
 */
export const WETNESS_FALL_MS_PER_LAP = 3_000;
/** The level a heavy rain settles at. Source: spike 4.3b-defaults (research 19 wetness): Singapore 14.4–14.9 s (laps 36–44, 17 cars), Miami 18.1 ± 0.7 s (laps 15–20, practice reference, biased high); peaks of 20–26 s fade within 3–10 laps; thin. */
export const WETNESS_MAX_MS = 16_000;
/**
 * An approximate forecast's timing error: per scenario the forecast is read this many laps (sd, normal, rounded)
 * earlier or later. Source: pitwall estimate (flagged; S12: wider when approximate). The check: the game's
 * approximate forecasts against the rain that came, on the wet recordings.
 */
export const APPROXIMATE_SHIFT_SD_LAPS = 2;
