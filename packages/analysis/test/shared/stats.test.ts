// The one stats helper of the analysis package (SP4.3c Task 2, C43): `median` (the average of the two middles),
// `lowerMedian` (the lower middle, for whole places) and `madSigma` (1.4826 × the median absolute deviation from the
// median). None sorts its input in place; an empty input has none (`undefined`), never 0 (C3).
import { describe, expect, it } from 'vitest';
import { lowerMedian, madSigma, median } from '../../src/shared/stats.ts';

/** Calls `f` on a copy-checked array: the input is unchanged after the call. */
function unchanged<T>(f: (xs: number[]) => T, input: readonly number[]): T {
  const xs = [...input];
  const result = f(xs);
  expect(xs).toEqual(input);
  return result;
}

describe('median', () => {
  it('[3, 1, 2] is 2: the middle of the sorted values', () => {
    expect(unchanged(median, [3, 1, 2])).toBe(2);
  });

  it('[1, 2, 3, 4] is 2.5: the average of the two middles', () => {
    expect(unchanged(median, [1, 2, 3, 4])).toBe(2.5);
  });

  it('an unsorted even list averages its two sorted middles', () => {
    expect(unchanged(median, [4, 1, 3, 2])).toBe(2.5);
  });

  it('one value is that value', () => {
    expect(unchanged(median, [7])).toBe(7);
  });

  it('[] is undefined', () => {
    expect(unchanged(median, [])).toBeUndefined();
  });

  it('takes any array-like: a typed array, unchanged', () => {
    const xs = Float64Array.from([5, 1, 3]);
    expect(median(xs)).toBe(3);
    expect([...xs]).toEqual([5, 1, 3]);
  });
});

describe('lowerMedian', () => {
  it('[1, 2, 3, 4] is 2: the lower middle', () => {
    expect(unchanged(lowerMedian, [1, 2, 3, 4])).toBe(2);
  });

  it('an unsorted even list takes its lower sorted middle', () => {
    expect(unchanged(lowerMedian, [4, 3, 1, 2])).toBe(2);
  });

  it('an odd list is its middle, as median', () => {
    expect(unchanged(lowerMedian, [3, 1, 2])).toBe(2);
  });

  it('[] is undefined', () => {
    expect(unchanged(lowerMedian, [])).toBeUndefined();
  });
});

describe('madSigma', () => {
  it('[1, 1, 1] is 0: no deviation', () => {
    expect(unchanged(madSigma, [1, 1, 1])).toBe(0);
  });

  it('[1, 2, 3, 4, 5] is 1.4826: median 3, absolute deviations [2, 1, 0, 1, 2], their median 1', () => {
    expect(unchanged(madSigma, [5, 1, 4, 2, 3])).toBeCloseTo(1.4826, 10);
  });

  it('an even list uses the average of the two middles for the median and the deviations', () => {
    // median 2.5; deviations [1.5, 0.5, 0.5, 1.5], their median 1
    expect(unchanged(madSigma, [1, 2, 3, 4])).toBeCloseTo(1.4826, 10);
  });

  it('[] is undefined', () => {
    expect(unchanged(madSigma, [])).toBeUndefined();
  });
});
