import { known, unknown, type Known, type SessionTime } from '@pitwall/domain';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { lapsToReach, lapsUntil, perLapRate, type Rate } from '../../src/per-lap-rate/index.ts';

const OPTS = { window: 5, minSamples: 3 };
const AT = 777 as SessionTime;
const atOf = (lap: number) => (lap * 1000) as SessionTime;
const atResult = (k: Known<unknown>): SessionTime => {
  if (!k.known) throw new Error(`expected known, got ${k.reason}`);
  return k.at;
};
const rateOf = (k: Known<Rate>): Rate => {
  if (!k.known) throw new Error(`expected a known rate, got ${k.reason}`);
  return k.value;
};
const series = (a: number, b: number, laps: number[]) => laps.map((lap) => ({ lap, value: a + b * lap, at: atOf(lap) }));

/** Strictly increasing laps, 3 to 5 of them (inside the default window), starting at 1..10. */
const lapsArb = fc
  .tuple(fc.integer({ min: 1, max: 10 }), fc.array(fc.integer({ min: 1, max: 3 }), { minLength: 2, maxLength: 4 }))
  .map(([start, steps]) => steps.reduce<number[]>((acc, s) => [...acc, acc[acc.length - 1]! + s], [start]));

describe('perLapRate', () => {
  it('property: a linear series a + b·lap gives perLap b', () => {
    fc.assert(
      fc.property(fc.integer({ min: -100, max: 100 }), fc.integer({ min: -20, max: 20 }), lapsArb, (a, b, laps) => {
        const rate = rateOf(perLapRate(series(a, b, laps), OPTS));
        expect(rate.perLap).toBeCloseTo(b, 9);
        expect(rate.samples).toBe(laps.length);
        expect(atResult(perLapRate(series(a, b, laps), OPTS))).toBe(atOf(laps[laps.length - 1]!));
      }),
    );
  });

  it('property: adding a constant to every value changes nothing', () => {
    fc.assert(
      fc.property(
        lapsArb,
        fc.integer({ min: -50, max: 50 }),
        fc.integer({ min: -20, max: 20 }),
        fc.integer({ min: -1000, max: 1000 }),
        (laps, seed, b, shift) => {
          const base = laps.map((lap, i) => ({ lap, value: b * lap + ((seed * (i + 3)) % 7), at: atOf(lap) }));
          const shifted = base.map((s) => ({ ...s, value: s.value + shift }));
          const r1 = rateOf(perLapRate(base, OPTS));
          const r2 = rateOf(perLapRate(shifted, OPTS));
          expect(r2.perLap).toBeCloseTo(r1.perLap, 9);
          expect(r2.samples).toBe(r1.samples);
        },
      ),
    );
  });

  it('one outlier among 5 samples moves the rate by less than 10 %', () => {
    const clean = series(10, 2, [1, 2, 3, 4, 5]);
    const odd = clean.map((s) => (s.lap === 3 ? { ...s, value: s.value + 100 } : s));
    const rate = rateOf(perLapRate(odd, OPTS));
    expect(Math.abs(rate.perLap - 2)).toBeLessThan(0.2);
    expect(rate.samples).toBe(5);
  });

  it('2 samples with minSamples 3 is unknown(insufficientData)', () => {
    expect(perLapRate(series(0, 1, [1, 2]), OPTS)).toEqual(unknown('insufficientData'));
  });

  it('no samples is unknown(insufficientData)', () => {
    expect(perLapRate([], OPTS)).toEqual(unknown('insufficientData'));
  });

  it('samples outside the window are ignored', () => {
    const old = [
      { lap: 1, value: 500, at: atOf(1) },
      { lap: 2, value: -300, at: atOf(2) },
      { lap: 3, value: 900, at: atOf(3) },
    ];
    const recent = series(60, -2, [4, 5, 6, 7, 8]);
    const rate = rateOf(perLapRate([...old, ...recent], OPTS));
    expect(rate.perLap).toBeCloseTo(-2, 9);
    expect(rate.samples).toBe(5);
    expect(atResult(perLapRate([...old, ...recent], OPTS))).toBe(atOf(8));
  });
});

describe('lapsUntil', () => {
  it('with rate -2 from 60 to 40 is 10', () => {
    const result = lapsUntil(known({ perLap: -2, samples: 5 }, AT), 60, 40);
    expect(result.known).toBe(true);
    if (result.known) {
      expect(result.value).toBeCloseTo(10, 9);
      expect(result.at).toBe(AT);
    }
  });

  it('with rate +2 from 60 to 40 is notApplicable', () => {
    expect(lapsUntil(known({ perLap: 2, samples: 5 }, AT), 60, 40)).toEqual(unknown('notApplicable'));
  });

  it('passes an unknown rate through', () => {
    expect(lapsUntil(unknown('insufficientData'), 60, 40)).toEqual(unknown('insufficientData'));
  });
});

describe('lapsToReach', () => {
  const rate = (perLap: number) => known({ perLap, samples: 3 }, AT);
  const reading = (value: number) => ({ value, at: 555 as SessionTime });

  it('below a target it rises to: lapsUntil', () => {
    expect(lapsToReach(rate(2), reading(60), 70, 'rising')).toEqual(lapsUntil(rate(2), 60, 70));
  });

  it('at or above a target it rises to: 0 as of the reading, whatever the rate', () => {
    expect(lapsToReach(rate(2), reading(70), 70, 'rising')).toEqual(known(0, 555));
    expect(lapsToReach(rate(-1), reading(76), 70, 'rising')).toEqual(known(0, 555));
    expect(lapsToReach(unknown('insufficientData'), reading(76), 70, 'rising')).toEqual(known(0, 555));
  });

  it('at or below a target it falls to: 0 as of the reading; above it: lapsUntil', () => {
    expect(lapsToReach(unknown('insufficientData'), reading(900), 1000, 'falling')).toEqual(known(0, 555));
    expect(lapsToReach(rate(-400), reading(1000), 1000, 'falling')).toEqual(known(0, 555));
    expect(lapsToReach(rate(-400), reading(1600), 1000, 'falling')).toEqual(lapsUntil(rate(-400), 1600, 1000));
  });

  it('not yet there: an unknown rate passes through', () => {
    expect(lapsToReach(unknown('insufficientData'), reading(60), 70, 'rising')).toEqual(unknown('insufficientData'));
  });
});
