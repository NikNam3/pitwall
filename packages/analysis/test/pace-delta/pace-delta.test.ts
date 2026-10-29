import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { SessionTime } from '@pitwall/domain';
import { paceDelta } from '../../src/pace-delta/index.ts';

const at = 123_456 as SessionTime;
const valueOf = (k: ReturnType<typeof paceDelta>) => (k.known ? k.value : undefined);

describe('paceDelta', () => {
  it('before 90 000 ×2, after 91 000 ×2 gives +1000', () => {
    const result = paceDelta([90_000, 90_000], [91_000, 91_000], at);
    expect(result.known).toBe(true);
    expect(valueOf(result)).toBe(1000);
  });

  it('a known result carries the session time it was given', () => {
    expect(paceDelta([90_000, 90_000], [91_000, 91_000], at)).toEqual({ known: true, value: 1000, at });
  });

  it('compares the means of both sides', () => {
    expect(valueOf(paceDelta([90_000, 92_000, 91_000], [90_000, 90_500], at))).toBeCloseTo(-750);
  });

  it('fewer than two laps on either side is insufficientData', () => {
    const insufficient = { known: false, reason: 'insufficientData' };
    expect(paceDelta([90_000], [91_000, 91_000], at)).toEqual(insufficient);
    expect(paceDelta([90_000, 90_000], [91_000], at)).toEqual(insufficient);
    expect(paceDelta([], [91_000, 91_000], at)).toEqual(insufficient);
    expect(paceDelta([90_000, 90_000], [], at)).toEqual(insufficient);
    expect(paceDelta([], [], at)).toEqual(insufficient);
  });

  it('exactly two laps on each side is enough', () => {
    expect(paceDelta([90_000, 90_000], [89_000, 89_000], at).known).toBe(true);
  });

  it('swapping before and after flips the sign', () => {
    const laps = fc.array(fc.integer({ min: 60_000, max: 130_000 }), { minLength: 2, maxLength: 12 });
    fc.assert(
      fc.property(laps, laps, (before, after) => {
        const forward = valueOf(paceDelta(before, after, at));
        const backward = valueOf(paceDelta(after, before, at));
        expect(forward).toBeDefined();
        expect(backward).toBeDefined();
        expect(forward! + backward!).toBeCloseTo(0, 6);
      }),
    );
  });
});
