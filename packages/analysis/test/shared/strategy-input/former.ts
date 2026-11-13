// The snapshot of 4.3b1's job values (SP4.3b2 Task 6 row 2): `former-values.json` holds, on the strategy tests' generator
// race (`../../strategy/support.ts`, `RACE`) at the leader's lap `SNAPSHOT_LAP`, with the plain forecast drawn from
// `createRng(SNAPSHOT_SEED)`, what `strategy`'s job computed before the move to `shared/strategy-input/`: per our car
// the DP input it handed `strategyDp` and `policyOf(best plan, the DP's thresholds)`; the `race-monte-carlo` hazard;
// the rival rules, points, zTie and tieBand from the config. Written once from `candidatesForRun` before the move.

export const SNAPSHOT_LAP = 3;
export const SNAPSHOT_SEED = 1_521_242_744;

/** `x` as JSON holds it: every typed array a plain array. */
export function plainValue(x: unknown): unknown {
  if (ArrayBuffer.isView(x)) return Array.from(x as unknown as ArrayLike<number>);
  if (Array.isArray(x)) return x.map(plainValue);
  if (x !== null && typeof x === 'object') return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, plainValue(v)]));
  return x;
}
