// The distribution helpers (SP4.3b2 Task 6): a finishing-place pmf from per-scenario places, and the share of values
// per bin with the ends holding the tails (the calls' gain strips). Pure (C2).

/** The finishing-place pmf (P1 … P`cars`) of `finish`, one place (1-based) per scenario; a place outside 1 … `cars` counts in none. */
export function placePmf(finish: Int8Array, cars: number): number[] {
  const pmf = new Array<number>(cars).fill(0);
  if (finish.length === 0) return pmf;
  for (const place of finish) if (place >= 1 && place <= cars) pmf[place - 1] = (pmf[place - 1] ?? 0) + 1;
  return pmf.map((n) => n / finish.length);
}

/** The share of `values` per bin (`from + i × step`, `count` bins); the ends hold the tails. */
export function binShares(values: Float64Array, bins: { from: number; step: number; count: number }): number[] {
  const shares = new Array<number>(bins.count).fill(0);
  if (values.length === 0 || bins.count === 0) return shares;
  for (const v of values) {
    const i = Math.min(bins.count - 1, Math.max(0, Math.floor((v - bins.from) / bins.step)));
    shares[i] = (shares[i] ?? 0) + 1;
  }
  return shares.map((n) => n / values.length);
}
