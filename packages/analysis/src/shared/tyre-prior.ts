// The game's tyre prior (SP4.3c spec §5.2, research 22 §1.1–1.2, §1.6): pure functions `degradation` (its filter's start
// prior) and `tyre-model` (its rate before a measured one, its loss per % of wear) both import, so the two units never
// read each other. No unit read: plain numbers in, plain numbers out.

/** The game's wear-limit share a set's usable life runs to, in % (research 22 §1.1: `lifeSpan = usableLife × (1 − wear / 70)`). */
export const GAME_LIFE_LIMIT_PCT = 70;

/**
 * The wear rate in % per lap a set's usable life implies for a driver of factor `k` (research 22 §1.2: the AI's measured
 * rate is 0.86 × 70 / `usableLife`): `k × limitPct / usableLife`. `usableLife` is the set's laps from new to the limit.
 */
export function gamePriorRatePct(usableLife: number, k: number, limitPct: number): number {
  return (k * limitPct) / usableLife;
}

/** The least wear below which a set's lap-time delta is noise, in % (research 22 §1.6). */
export const MIN_WEAR_FOR_LOSS_PCT = 8;

/**
 * The game's lap-time loss per % of wear (research 22 §1.6): the fitted set's delta against a fresh set of its compound
 * (`fittedDeltaMs − freshDeltaMs`, both against the fitted set as the game gives them) over the fitted set's wear;
 * `undefined` below `minWearPct` (the delta is noise there).
 */
export function gameLossMsPerPct(fittedDeltaMs: number, freshDeltaMs: number, wearPct: number, minWearPct: number = MIN_WEAR_FOR_LOSS_PCT): number | undefined {
  if (!(wearPct >= minWearPct) || wearPct <= 0) return undefined;
  return (fittedDeltaMs - freshDeltaMs) / wearPct;
}
