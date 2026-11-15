import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { known, unknown, type SessionTime } from '@pitwall/domain';
import { paceDelta, paceDeltaAround, referencePaceMs } from '../../src/pace-delta/index.ts';
import { PACE_DELTA_CONFIG } from '../../src/pace-delta/config.ts';
import * as analysis from '../../src/index.ts';
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

  it('fewer than two laps before is notApplicable (the laps before never grow), whatever comes after', () => {
    const never = unknown('notApplicable');
    expect(paceDelta([90_000], [91_000, 91_000], at)).toEqual(never);
    expect(paceDelta([], [91_000, 91_000], at)).toEqual(never);
    expect(paceDelta([90_000], [91_000], at)).toEqual(never);
    expect(paceDelta([], [], at)).toEqual(never);
  });

  it('two laps before and fewer than two after is insufficientData (the laps after still come)', () => {
    const insufficient = unknown('insufficientData');
    expect(paceDelta([90_000, 90_000], [91_000], at)).toEqual(insufficient);
    expect(paceDelta([90_000, 90_000], [], at)).toEqual(insufficient);
  });

  it('exactly two laps on each side is enough', () => {
    expect(paceDelta([90_000, 90_000], [89_000, 89_000], at).known).toBe(true);
  });

  it('swapping before and after flips the sign (up to the rounding of a half: +x.5 rounds up, −x.5 too)', () => {
    const laps = fc.array(fc.integer({ min: 60_000, max: 130_000 }), { minLength: 2, maxLength: 12 });
    fc.assert(
      fc.property(laps, laps, (before, after) => {
        const forward = valueOf(paceDelta(before, after, at));
        const backward = valueOf(paceDelta(after, before, at));
        expect(forward).toBeDefined();
        expect(backward).toBeDefined();
        expect(Math.abs(forward! + backward!)).toBeLessThanOrEqual(1);
      }),
    );
  });

  describe('whole milliseconds (C4)', () => {
    it('a mean difference with a fraction is rounded: 1809.67 ms is 1810 ms', () => {
      // after: mean 91 809.67; before: 90 000
      expect(paceDelta([90_000, 90_000, 90_000], [91_809, 91_810, 91_810], at)).toEqual({ known: true, value: 1810, at });
    });

    it('rounds to the nearest ms: +1.5 is 2, −1.25 is −1, −1.5 is −1 (a half rounds up), −2.5 is −2', () => {
      expect(valueOf(paceDelta([90_000, 90_000], [90_001, 90_002], at))).toBe(2);
      expect(valueOf(paceDelta([90_000, 90_000, 90_000, 90_005], [90_000, 90_000], at))).toBe(-1);
      expect(valueOf(paceDelta([90_000, 90_003], [90_000, 90_000], at))).toBe(-1);
      expect(valueOf(paceDelta([90_000, 90_005], [90_000, 90_000], at))).toBe(-2);
    });

    it('a result that rounds to zero from below is 0, never −0', () => {
      // −0.5 and −0.33 round to −0 with Math.round alone
      expect(Object.is(valueOf(paceDelta([90_000, 90_001], [90_000, 90_000], at)), 0)).toBe(true);
      expect(Object.is(valueOf(paceDelta([90_000, 90_000, 90_001], [90_000, 90_000], at)), 0)).toBe(true);
    });

    it('is always an integer within half a ms of the mean difference, for integer lap times', () => {
      const laps = fc.array(fc.integer({ min: 60_000, max: 130_000 }), { minLength: 2, maxLength: 12 });
      const mean = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length;
      fc.assert(
        fc.property(laps, laps, (before, after) => {
          const value = valueOf(paceDelta(before, after, at));
          expect(value).toBeDefined();
          expect(Number.isInteger(value)).toBe(true);
          expect(Object.is(value, -0)).toBe(false);
          expect(Math.abs(value! - (mean(after) - mean(before)))).toBeLessThanOrEqual(0.5 + 1e-9);
        }),
      );
    });
  });
});

describe('paceDeltaAround', () => {
  const laps = (count: number, timeOf: (n: number) => number) =>
    Array.from({ length: count }, (_, i) => lap({ lapNumber: i + 1, lapTimeMs: timeOf(i + 1), completedAt: (i + 1) * 100_000 }));
  /** The lap-class options are required: the caller passes the `lap-classes` config (its default here). */
  const race = { window: 3, isRace: true, maxNeutralisedMs: 2000 };

  it('pace laps after the lap minus those before it, the lap itself excluded, as of the newest lap used', () => {
    const list = laps(8, (n) => (n < 5 ? 90_000 : n === 5 ? 150_000 : 91_000));
    expect(paceDeltaAround(list, 5, race)).toEqual(known(1000, 800_000));
  });

  it('up to `window` laps on each side: the nearest ones', () => {
    // laps 2..4 before (lap 1 of a race is no pace lap), 6..8 after; lap 9 lies outside the window
    const list = laps(9, (n) => (n === 9 ? 200_000 : n < 5 ? 90_000 : 91_000));
    expect(paceDeltaAround(list, 5, race)).toEqual(known(1000, 800_000));
    expect(paceDeltaAround(list, 5, { ...race, window: 2 })).toEqual(known(1000, 700_000));
  });

  it('only pace laps count: lap 1 of a race and an in lap are skipped', () => {
    const list = laps(8, () => 90_000).map((l) => (l.lapNumber === 6 ? { ...l, inLap: true, lapTimeMs: 150_000 } : l));
    expect(paceDeltaAround(list, 5, race)).toEqual(known(0, 800_000));
    // in practice lap 1 is a pace lap, but one lap before is still too few, and it can never become more
    expect(paceDeltaAround(laps(3, (n) => (n === 1 ? 80_000 : 90_000)), 2, { ...race, isRace: false })).toEqual(unknown('notApplicable'));
  });

  it('fewer than two pace laps before the lap is notApplicable, whatever comes after', () => {
    // lap 1 of a race is no pace lap: before lap 2 there is none, before lap 3 only lap 2
    expect(paceDeltaAround(laps(8, () => 90_000), 2, race)).toEqual(unknown('notApplicable'));
    expect(paceDeltaAround(laps(8, () => 90_000), 3, race)).toEqual(unknown('notApplicable'));
    expect(paceDeltaAround(laps(2, () => 90_000), 2, race)).toEqual(unknown('notApplicable'));
    expect(paceDeltaAround([], 2, race)).toEqual(unknown('notApplicable'));
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 3 }), fc.integer({ min: 0, max: 8 }), (event, after) => {
        expect(paceDeltaAround(laps(event + after, () => 90_000), event, race)).toEqual(unknown('notApplicable'));
      }),
    );
  });

  it('only pace laps count before the lap: an in lap among them leaves too few, so notApplicable', () => {
    // laps 2..4 before lap 5, but 3 and 4 are an in lap and an out lap: only lap 2 is a pace lap
    const list = laps(8, () => 90_000).map((l) =>
      l.lapNumber === 3 ? { ...l, inLap: true } : l.lapNumber === 4 ? { ...l, outLap: true } : l,
    );
    expect(paceDeltaAround(list, 5, race)).toEqual(unknown('notApplicable'));
  });

  it('two pace laps before and fewer than two after is insufficientData', () => {
    // before lap 4: laps 2 and 3
    expect(paceDeltaAround(laps(4, () => 90_000), 4, race)).toEqual(unknown('insufficientData'));
    expect(paceDeltaAround(laps(5, () => 90_000), 4, race)).toEqual(unknown('insufficientData'));
    expect(paceDeltaAround(laps(6, () => 90_000), 5, race)).toEqual(unknown('insufficientData'));
  });

  it('two pace laps on each side is known', () => {
    expect(paceDeltaAround(laps(6, (n) => (n < 4 ? 90_000 : 91_000)), 4, race)).toEqual(known(1000, 600_000));
  });

  it('the order of the laps does not matter', () => {
    const list = laps(8, (n) => (n < 5 ? 90_000 : 91_000));
    expect(paceDeltaAround([...list].reverse(), 5, race)).toEqual(paceDeltaAround(list, 5, race));
  });

  it('whole milliseconds (C4): a mean difference with a fraction is rounded, and one just below zero is 0, never −0', () => {
    // before: laps 2..4 at 90 000, 90 000, 90 001 (mean 90 000.33); after: laps 6..8
    const before = (n: number) => (n === 4 ? 90_001 : 90_000);
    const slower = laps(8, (n) => (n < 5 ? before(n) : n === 5 ? 150_000 : 91_000));
    expect(paceDeltaAround(slower, 5, race)).toEqual(known(1000, 800_000));
    const same = paceDeltaAround(laps(8, (n) => (n < 5 ? before(n) : 90_000)), 5, race);
    expect(same).toEqual(known(0, 800_000));
    expect(same.known && Object.is(same.value, 0)).toBe(true);
  });

  it('the lap-class options are required: a call without maxNeutralisedMs is a type error, not a silent default', () => {
    const list = laps(8, () => 90_000);
    // @ts-expect-error maxNeutralisedMs is required (the `lap-classes` config of the caller)
    const call = () => paceDeltaAround(list, 5, { window: 3, isRace: true });
    expect(typeof call).toBe('function');
  });

  it('a lap counts as a pace lap by the given maxNeutralisedMs: 3 s under SC is out at 2000 ms and in at 5000 ms', () => {
    // lap 7 is slow (100 s) with 3 s of it under SC (scShare 0.03)
    const list = laps(8, (n) => (n === 7 ? 100_000 : n < 5 ? 90_000 : 91_000)).map((l) => (l.lapNumber === 7 ? { ...l, scShare: 0.03 } : l));
    // out: laps 6 and 8 after (91 s)
    expect(paceDeltaAround(list, 5, race)).toEqual(known(1000, 800_000));
    // in: laps 6, 7, 8 after (mean 94 s)
    expect(paceDeltaAround(list, 5, { ...race, maxNeutralisedMs: 5000 })).toEqual(known(4000, 800_000));
  });
});

// SP4.3c Task 2: the `pace` unit is gone (no unit read its output); its one setting, the pace laps in the recent mean,
// moves to `pace-delta`'s own config, and `damage` and `incidents` read it from there.
describe('PACE_DELTA_CONFIG', () => {
  it("is pace-delta's section with windowLaps 3, the old pace window", () => {
    expect(PACE_DELTA_CONFIG.key).toBe('pace-delta');
    expect(PACE_DELTA_CONFIG.defaults).toEqual({ windowLaps: 3 });
    expect(PACE_DELTA_CONFIG.read({ config: { 'pace-delta': { windowLaps: 2 } } })).toEqual({ windowLaps: 2 });
  });

  it('the package exports it, and no pace calculator or pace config', () => {
    expect((analysis as Record<string, unknown>).PACE_DELTA_CONFIG).toBe(PACE_DELTA_CONFIG);
    expect(analysis).not.toHaveProperty('paceCalculator');
    expect(analysis).not.toHaveProperty('PACE_CONFIG');
    expect(analysis).not.toHaveProperty('PACE');
  });
});

// SP4.3c Task 7 (O12, B11, C43): the one reference pace before an event, which `pit-loss` reads too. Its options are
// `paceDeltaAround`'s: the window (`pace-delta.windowLaps`) and the caller's `lap-classes` options.
describe('referencePaceMs', () => {
  const race = { window: 3, isRace: true, maxNeutralisedMs: 1000 };
  /** Car 0's lap `n` taking `ms`, completed at `n · 100 000`. */
  const lapN = (n: number, ms: number, over: Parameters<typeof lap>[0] = {}) => lap({ lapNumber: n, lapTimeMs: ms, completedAt: n * 100_000, ...over });
  const INVALID = { valid: { lap: false, sectors: [false, false, false] as [boolean, boolean, boolean] } };

  it('the mean (not the median) of the last `window` pace laps before the lap, as of the newest of them', () => {
    const laps = [lapN(1, 99_000), lapN(2, 90_000), lapN(3, 91_000), lapN(4, 92_000), lapN(5, 96_000), lapN(6, 80_000), lapN(7, 80_000)];
    // laps 3, 4, 5: mean 93 000 (the median would be 92 000); lap 6 itself and lap 7 after it are in none
    expect(referencePaceMs(laps, 6, race)).toEqual(known(93_000, 500_000));
  });

  it('takes laps in any order; a lap that is no pace lap is skipped, so the window reaches further back', () => {
    // lap 4 is invalid: the last three pace laps before lap 6 are 2, 3, 5 (mean 92 333.3)
    const laps = [lapN(5, 96_000), lapN(2, 90_000), lapN(4, 70_000, INVALID), lapN(3, 91_000)];
    expect(referencePaceMs(laps, 6, race)).toEqual(known(92_333, 500_000));
    // an in-lap is no pace lap either
    const withInLap = [lapN(2, 90_000), lapN(3, 91_000), lapN(4, 92_000), lapN(5, 99_000, { inLap: true })];
    expect(referencePaceMs(withInLap, 6, race)).toEqual(known(91_000, 400_000));
  });

  it('fewer pace laps than the window: the mean of those there are, in whole ms (C4)', () => {
    // 90 000.5 rounds to 90 001
    expect(referencePaceMs([lapN(2, 90_000), lapN(3, 90_001)], 4, race)).toEqual(known(90_001, 300_000));
    expect(referencePaceMs([lapN(2, 90_000)], 4, race)).toEqual(known(90_000, 200_000));
  });

  it('no pace lap before the lap: insufficientData, never 0 (C3); lap 1 of a race is no pace lap, of practice it is', () => {
    expect(referencePaceMs([], 5, race)).toEqual(unknown('insufficientData'));
    expect(referencePaceMs([lapN(5, 90_000), lapN(6, 90_000)], 5, race)).toEqual(unknown('insufficientData'));
    expect(referencePaceMs([lapN(1, 90_000)], 2, race)).toEqual(unknown('insufficientData'));
    expect(referencePaceMs([lapN(1, 90_000)], 2, { ...race, isRace: false })).toEqual(known(90_000, 100_000));
  });
});
