import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { known, unknown, type SessionTime } from '@pitwall/domain';
import { paceDelta, paceDeltaAround } from '../../src/pace-delta/index.ts';
import { lap } from '../../../../test-support/builders/index.ts';

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

describe('paceDeltaAround', () => {
  const laps = (count: number, timeOf: (n: number) => number) =>
    Array.from({ length: count }, (_, i) => lap({ lapNumber: i + 1, lapTimeMs: timeOf(i + 1), completedAt: (i + 1) * 100_000 }));
  const race = { window: 3, isRace: true };

  it('pace laps after the lap minus those before it, the lap itself excluded, as of the newest lap used', () => {
    const list = laps(8, (n) => (n < 5 ? 90_000 : n === 5 ? 150_000 : 91_000));
    expect(paceDeltaAround(list, 5, race)).toEqual(known(1000, 800_000));
  });

  it('up to `window` laps on each side: the nearest ones', () => {
    // laps 2..4 before (lap 1 of a race is no pace lap), 6..8 after; lap 9 lies outside the window
    const list = laps(9, (n) => (n === 9 ? 200_000 : n < 5 ? 90_000 : 91_000));
    expect(paceDeltaAround(list, 5, race)).toEqual(known(1000, 800_000));
    expect(paceDeltaAround(list, 5, { window: 2, isRace: true })).toEqual(known(1000, 700_000));
  });

  it('only pace laps count: lap 1 of a race and an in lap are skipped', () => {
    const list = laps(8, () => 90_000).map((l) => (l.lapNumber === 6 ? { ...l, inLap: true, lapTimeMs: 150_000 } : l));
    expect(paceDeltaAround(list, 5, race)).toEqual(known(0, 800_000));
    // in practice lap 1 is a pace lap, but one lap before is still too few
    expect(paceDeltaAround(laps(3, (n) => (n === 1 ? 80_000 : 90_000)), 2, { window: 3, isRace: false })).toEqual(unknown('insufficientData'));
  });

  it('fewer than two pace laps on a side is insufficientData', () => {
    expect(paceDeltaAround(laps(6, () => 90_000), 5, race)).toEqual(unknown('insufficientData'));
    expect(paceDeltaAround(laps(8, () => 90_000), 2, race)).toEqual(unknown('insufficientData'));
    expect(paceDeltaAround([], 2, race)).toEqual(unknown('insufficientData'));
  });

  it('the order of the laps does not matter', () => {
    const list = laps(8, (n) => (n < 5 ? 90_000 : 91_000));
    expect(paceDeltaAround([...list].reverse(), 5, race)).toEqual(paceDeltaAround(list, 5, race));
  });
});
