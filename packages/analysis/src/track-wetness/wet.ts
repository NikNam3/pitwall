// The one wet rule (SP4.3c O3, C43): `track-wetness` owns it. A track is wet once its wetness is above a dry track by
// more than `wetSigmas` of its sd. `track-wetness`'s `wet` applies it to its filtered state; a drawn scenario's path lap
// (one world, no sd) applies it with sd 0. No other unit judges wetness by its own test.

/** Whether a wetness of `wetnessMs` ± `sdMs` is wet: `wetnessMs − wetSigmas · sdMs > 0`. */
export const isWet = (wetnessMs: number, sdMs: number, wetSigmas: number): boolean => wetnessMs - wetSigmas * sdMs > 0;
