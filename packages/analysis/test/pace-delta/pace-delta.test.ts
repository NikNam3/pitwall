import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { paceDelta } from '../../src/pace-delta/index.ts';

const valueOf = (k: ReturnType<typeof paceDelta>) => (k.known ? k.value : undefined);

describe('paceDelta', () => {
  it('before 90 000 ×2, after 91 000 ×2 gives +1000', () => {
    const result = paceDelta([90_000, 90_000], [91_000, 91_000]);
    expect(result.known).toBe(true);
    expect(valueOf(result)).toBe(1000);
  });

  it('compares the means of both sides', () => {
    expect(valueOf(paceDelta([90_000, 92_000, 91_000], [90_000, 90_500]))).toBeCloseTo(-750);
  });

  it('fewer than two laps on either side is insufficientData', () => {
    const insufficient = { known: false, reason: 'insufficientData' };
    expect(paceDelta([90_000], [91_000, 91_000])).toEqual(insufficient);
    expect(paceDelta([90_000, 90_000], [91_000])).toEqual(insufficient);
    expect(paceDelta([], [91_000, 91_000])).toEqual(insufficient);
    expect(paceDelta([90_000, 90_000], [])).toEqual(insufficient);
    expect(paceDelta([], [])).toEqual(insufficient);
  });

  it('exactly two laps on each side is enough', () => {
    expect(paceDelta([90_000, 90_000], [89_000, 89_000]).known).toBe(true);
  });

  it('swapping before and after flips the sign', () => {
    const laps = fc.array(fc.integer({ min: 60_000, max: 130_000 }), { minLength: 2, maxLength: 12 });
    fc.assert(
      fc.property(laps, laps, (before, after) => {
        const forward = valueOf(paceDelta(before, after));
        const backward = valueOf(paceDelta(after, before));
        expect(forward).toBeDefined();
        expect(backward).toBeDefined();
        expect(forward! + backward!).toBeCloseTo(0, 6);
      }),
    );
  });
});
