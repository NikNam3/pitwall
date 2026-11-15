// `weather-paths`' wetness dynamics (SP4.3b spec §7.1, Task 19b; moved from `race-monte-carlo`, SP4.3c O3b). A
// simulator has no view and so no `config.ts` (C47 binds calculators and analyses). `track-wetness` has no prediction
// model of its own (its filter is a random walk; the forecast only widens its step, R19), so these are the generator's,
// flagged as pitwall estimates. The check to make: on the wet recordings (Singapore 2026-10-29_00-04-08, Mexico
// 2026-10-30_15-20-41, Miami 2026-10-30_18-53-00) compare track-wetness's filtered state per lap against the game's
// rain per lap, and fit the rise per rain lap, the fall per dry lap and the ceiling.

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
