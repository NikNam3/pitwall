// The distribution helpers (SP4.3b2 Task 6 rows 3 and 4): `binShares` (the calls' gain strips, the ends holding the
// tails) and `placePmf` (a finishing-place pmf from per-scenario places).
import { describe, expect, it } from 'vitest';
import { binShares, placePmf } from '../../src/shared/distribution.ts';

const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);

describe('distribution', () => {
  // row 3
  it('binShares: a value below from lands in the first bin, above the last in the last; shares sum to 1', () => {
    const bins = { from: -2, step: 1, count: 4 }; // [-2,-1) [-1,0) [0,1) [1,2)
    expect(binShares(Float64Array.of(-50), bins)).toEqual([1, 0, 0, 0]);
    expect(binShares(Float64Array.of(50), bins)).toEqual([0, 0, 0, 1]);
    const shares = binShares(Float64Array.of(-9, -1.5, -0.5, 0.25, 0.75, 1.5, 9, 2), bins);
    expect(shares).toHaveLength(4);
    expect(shares).toEqual([2 / 8, 1 / 8, 2 / 8, 3 / 8]);
    expect(sum(shares)).toBeCloseTo(1, 12);
  });

  // row 4
  it('placePmf sums to 1', () => {
    const pmf = placePmf(Int8Array.of(1, 1, 2, 4, 4, 4, 3, 2), 5);
    expect(pmf).toHaveLength(5);
    expect(pmf).toEqual([2 / 8, 2 / 8, 1 / 8, 3 / 8, 0]);
    expect(sum(pmf)).toBeCloseTo(1, 12);
  });
});
