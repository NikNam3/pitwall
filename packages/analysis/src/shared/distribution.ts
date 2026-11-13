// STUB (SP4.3b2 Task 6, test phase): the distribution helpers; the implement phase writes them.

const notImplemented = (name: string): never => {
  throw new Error(`${name}: not implemented (SP4.3b2 Task 6)`);
};

/** The finishing-place pmf (P1 … P`cars`) of `finish`, one place (1-based) per scenario. */
export function placePmf(_finish: Int8Array, _cars: number): number[] {
  return notImplemented('placePmf');
}

/** The share of `values` per bin (`from + i × step`, `count` bins); the ends hold the tails. */
export function binShares(_values: Float64Array, _bins: { from: number; step: number; count: number }): number[] {
  return notImplemented('binShares');
}
