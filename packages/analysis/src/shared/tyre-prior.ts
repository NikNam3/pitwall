// The game's tyre prior (SP4.3c spec §5.2, research 22 §1.1–1.2, §1.6): pure functions `degradation` (its filter's start
// prior) and `tyre-model` (its rate before a measured one, its loss per % of wear, its laps to the limit) both import, so
// the two units never read each other. No unit read and no config of its own: the callers pass `tyre-model`'s config
// (the limit, the AI's k, the loss threshold, C47). One copy each of the fresh-set pick and the laps-to-limit rule (C43).
import { known, unknown, type Known, type TyreSet, type VisualCompound } from '@pitwall/domain';
import type { DeepReadonly } from '@pitwall/engine/readers';

type GameSet = DeepReadonly<TyreSet>;

/**
 * The wear rate in % per lap a set's usable life implies for a driver of factor `k` (research 22 §1.2: the AI's measured
 * rate is 0.86 × the limit / `usableLife`): `k × limitPct / usableLife`. `usableLife` is the set's laps from new to the limit.
 */
export function gamePriorRatePct(usableLife: number, k: number, limitPct: number): number {
  return (k * limitPct) / usableLife;
}

/**
 * The game's lap-time loss per % of wear (research 22 §1.6): the fitted set's delta against a fresh set of its compound
 * (`fittedDeltaMs − freshDeltaMs`, both against the fitted set as the game gives them) over the fitted set's wear;
 * `undefined` below `minWearPct` (the delta is noise there).
 */
export function gameLossMsPerPct(fittedDeltaMs: number, freshDeltaMs: number, wearPct: number, minWearPct: number): number | undefined {
  if (!(wearPct >= minWearPct) || wearPct <= 0) return undefined;
  return (fittedDeltaMs - freshDeltaMs) / wearPct;
}

/**
 * A fresh set (SP4.2 "only new tyre sets"): available, not fitted, new. `i` is its index in the car's sets and
 * `fittedIdx` the game's fitted index where the sets carry one (the live state's; a lap record's sets have none).
 */
export const isFreshSet = (s: GameSet, i: number, fittedIdx?: number): boolean => s.available && !s.fitted && i !== fittedIdx && s.wearPct === 0;

/** The fastest fresh set of `compound` in `sets` (the smallest delta), if any (`isFreshSet`). */
export function bestFreshSet(sets: readonly GameSet[], compound: VisualCompound, fittedIdx?: number): GameSet | undefined {
  let best: GameSet | undefined;
  sets.forEach((x, i) => {
    if (x.visualCompound === compound && isFreshSet(x, i, fittedIdx) && (best === undefined || x.lapDeltaMs < best.lapDeltaMs)) best = x;
  });
  return best;
}

/**
 * The game's loss per % of the `fitted` set against the `fresh` one (`gameLossMsPerPct`); `undefined` below `minWearPct`
 * or when the worn set is no slower than the fresh one (no reading of the game's loss, C3).
 */
export function gameSetLossMsPerPct(fitted: GameSet, fresh: GameSet,minWearPct: number): number | undefined {
  const loss = gameLossMsPerPct(fitted.lapDeltaMs, fresh.lapDeltaMs, fitted.wearPct, minWearPct);
  return loss !== undefined && loss > 0 ? loss : undefined;
}

/**
 * The game's ν of the `fitted` set in ms per lap (research 22 §1.6, §2): its loss per % against `fresh`
 * (`gameSetLossMsPerPct`) times the rate its usable life implies (`gamePriorRatePct` with `k` and `limitPct`);
 * `undefined` without a usable life or a loss.
 */
export function gameSetNuMsPerLap(fitted: GameSet, fresh: GameSet,k: number, limitPct: number, minWearPct: number): number | undefined {
  if (!(fitted.usableLifeLaps > 0)) return undefined;
  const loss = gameSetLossMsPerPct(fitted, fresh, minWearPct);
  return loss === undefined ? undefined : loss * gamePriorRatePct(fitted.usableLifeLaps, k, limitPct);
}

/**
 * Laps from `wear` to `limitPct` at `rate` % per lap, at the later of the two times: 0 at or past the limit (whatever
 * the rate); the wear's or the rate's reason while unknown, `insufficientData` for a rate of 0 or less (C3).
 */
export function lapsToLimitOf(wear: Known<number>, rate: Known<number>, limitPct: number): Known<number> {
  if (!wear.known) return wear;
  if (wear.value >= limitPct) return known(0, wear.at);
  if (!rate.known) return rate;
  if (!(rate.value > 0)) return unknown('insufficientData');
  return known((limitPct - wear.value) / rate.value, Math.max(wear.at, rate.at));
}
