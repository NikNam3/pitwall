// A packet's per-wheel array to named corners (C5: game order RL, RR, FL, FR), in the engine only (C6; SP4.3c Task 1,
// spec §5.3): `cornersFromGameOrder` leaves the domain and `cornersOf` names the corners through `CORNER_SLOTS`. Ported
// from `domain/test/vocabulary.test.ts`'s `cornersFromGameOrder` case.
import { describe, expect, it } from 'vitest';
import { CORNER_NAMES, CORNER_SLOTS, cornersOf } from '../../src/step/corners.ts';

describe('cornersOf', () => {
  it('maps game order RL, RR, FL, FR to named corners', () => {
    expect(cornersOf([1, 2, 3, 4])).toEqual({ rl: 1, rr: 2, fl: 3, fr: 4 });
  });

  it('a missing entry reads as 0', () => {
    expect(cornersOf([])).toEqual({ fl: 0, fr: 0, rl: 0, rr: 0 });
    expect(cornersOf([5, 6])).toEqual({ rl: 5, rr: 6, fl: 0, fr: 0 });
  });

  it('CORNER_SLOTS names every corner once, in CORNER_NAMES order, at the index cornersOf reads', () => {
    expect(CORNER_SLOTS.map(([name]) => name)).toEqual([...CORNER_NAMES]);
    const wheels = [10, 20, 30, 40];
    const named = cornersOf(wheels);
    for (const [name, index] of CORNER_SLOTS) expect([name, wheels[index]]).toEqual([name, named[name]]);
  });
});
