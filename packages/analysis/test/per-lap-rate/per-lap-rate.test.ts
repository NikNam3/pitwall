import { known, unknown, type Known, type SessionTime } from '@pitwall/domain';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { lapsToReach, lapsUntil, PER_LAP_RATE_CONFIG, perLapGainRate, perLapRate, type GainSample, type Rate } from '../../src/per-lap-rate/index.ts';

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

describe('per-lap-rate config', () => {
  it('a rate is the median of the last 5 per-lap gains and is known from 2 of them (user ruling 2026-10-30)', () => {
    expect(PER_LAP_RATE_CONFIG.key).toBe('per-lap-rate');
    expect(PER_LAP_RATE_CONFIG.defaults).toMatchObject({ window: 5, minSamples: 2 });
  });
});

/** One gain sample per lap from `from` on, at `lap * 1000`. */
const gains = (values: number[], from = 1): GainSample[] => values.map((gain, i) => ({ lap: from + i, gain, at: atOf(from + i) }));
const GAIN_OPTS = { window: 5, minSamples: 2 };

describe('perLapGainRate (median of the laps` own gains)', () => {
  it('the rate is the median of the gains, as of the newest sample', () => {
    // sorted 1.8, 2, 2.1, 2.4, 3: the median is 2.1
    expect(perLapGainRate(gains([2, 2.4, 1.8, 3, 2.1]), GAIN_OPTS)).toEqual(known({ perLap: 2.1, samples: 5 }, atOf(5)));
  });

  it('an even number of gains gives the mean of the middle two', () => {
    expect(perLapGainRate(gains([2, 3]), GAIN_OPTS)).toEqual(known({ perLap: 2.5, samples: 2 }, atOf(2)));
    // sorted 1, 2, 4, 8: (2 + 4) / 2
    expect(perLapGainRate(gains([8, 1, 4, 2]), GAIN_OPTS)).toEqual(known({ perLap: 3, samples: 4 }, atOf(4)));
  });

  it('2 gains give a rate; 1 does not (minSamples 2)', () => {
    expect(perLapGainRate(gains([3, 3]), GAIN_OPTS)).toMatchObject({ known: true, value: { perLap: 3, samples: 2 } });
    expect(perLapGainRate(gains([3]), GAIN_OPTS)).toEqual(unknown('insufficientData'));
  });

  it('no gains is unknown(insufficientData)', () => {
    expect(perLapGainRate([], GAIN_OPTS)).toEqual(unknown('insufficientData'));
  });

  it('minSamples comes from the options', () => {
    expect(perLapGainRate(gains([3, 3]), { window: 5, minSamples: 3 })).toEqual(unknown('insufficientData'));
  });

  it('one outlier lap among 5 leaves the rate at the others` value', () => {
    expect(perLapGainRate(gains([2, 2, 14, 2, 2]), GAIN_OPTS)).toMatchObject({ known: true, value: { perLap: 2 } });
    expect(perLapGainRate(gains([2, 2, -9, 2, 2]), GAIN_OPTS)).toMatchObject({ known: true, value: { perLap: 2 } });
  });

  it('only the last `window` gains count', () => {
    // the median of all 8 is 1; of the last 5 (1, 1, 3, 3, 3) it is 3
    const rate = perLapGainRate(gains([1, 1, 1, 1, 1, 3, 3, 3]), GAIN_OPTS);
    expect(rate).toEqual(known({ perLap: 3, samples: 5 }, atOf(8)));
  });

  it('gains of laps that are not consecutive count the same: a lap number gap does not scale the rate', () => {
    // laps 1, 2, 6, 7: the laps between them were no samples
    const samples = [1, 2, 6, 7].map((lap) => ({ lap, gain: 2, at: atOf(lap) }));
    expect(perLapGainRate(samples, GAIN_OPTS)).toEqual(known({ perLap: 2, samples: 4 }, atOf(7)));
  });

  it('property: equal gains g give the rate g', () => {
    fc.assert(
      fc.property(fc.double({ min: -1e6, max: 1e6, noNaN: true }), fc.integer({ min: 2, max: 9 }), (g, n) => {
        const rate = rateOf(perLapGainRate(gains(Array.from({ length: n }, () => g)), GAIN_OPTS));
        expect(rate.perLap).toBe(g);
        expect(rate.samples).toBe(Math.min(n, 5));
      }),
    );
  });

  it('property: the rate lies between the smallest and the largest gain of the window, whatever their order', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: -100, max: 100 }), { minLength: 2, maxLength: 9 }), (values) => {
        const window = values.slice(-5);
        const rate = rateOf(perLapGainRate(gains(values), GAIN_OPTS));
        expect(rate.perLap).toBeGreaterThanOrEqual(Math.min(...window));
        expect(rate.perLap).toBeLessThanOrEqual(Math.max(...window));
        const reversed = rateOf(perLapGainRate(gains([...values.slice(0, -5), ...[...window].reverse()]), GAIN_OPTS));
        expect(reversed.perLap).toBe(rate.perLap);
      }),
    );
  });
});

// Theil–Sen over values sampled at the line: the battle's closing rate (gaps at each line crossing) keeps this method.
describe('perLapRate (Theil–Sen slope)', () => {
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
