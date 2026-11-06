// `wearRatePerCorner` and `wearBasis` (contract C43, finding F2): the one wear rate per corner and the one wear/age basis,
// shared by `degradation` (its stints' `wearRatePctPerLap` and `basis`) and `tyre-life` (its corners' `ratePctPerLap` and
// `basis`), so both agree. The rule is today's `tyre-life`'s (the published one): per corner the median (`per-lap-rate`)
// of the rate laps' own wear gains (end minus start; `lap-classes`' `forRate`, which has no lap-1 rule), a lap whose
// start or end wear of the corner is unknown being no sample of that corner. The rows are taken from both units' wear
// tests (`test/tyre-life/tyre-life.test.ts`, the rate and laps-to-limit rows ported from `tyre-wear`; `degradation`'s
// `wearRates` in `src/degradation/stint-fit.ts`). Builder data only (C84).
import { carId, known, unknown, type ActualCompound, type Corners, type Known, type LapRecord, type Percent, type VisualCompound } from '@pitwall/domain';
import type { EngineView } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { DEGRADATION, type DegradationOutput } from '../../src/degradation/index.ts';
import { degradationCalculator } from '../../src/degradation/calculator.ts';
import { LAP_CLASSES_CONFIG } from '../../src/lap-classes/index.ts';
import { PER_LAP_RATE_CONFIG } from '../../src/per-lap-rate/index.ts';
import { wearBasis, wearRatePerCorner } from '../../src/shared/wear-rate.ts';
import { tyreLifeCalculator } from '../../src/tyre-life/calculator.ts';
import { carState, lap } from '../../../../test-support/builders/index.ts';
import { guardedQuick, situatedView } from '../situated.ts';

/** The default options: `lap-classes`' and `per-lap-rate`'s config defaults. */
const OPTS = { lapClasses: LAP_CLASSES_CONFIG.defaults, rate: PER_LAP_RATE_CONFIG.defaults };

const CORNERS = ['fl', 'fr', 'rl', 'rr'] as const;
const insufficient = unknown('insufficientData');

const everyCorner = <T>(make: () => T): Corners<T> => ({ fl: make(), fr: make(), rl: make(), rr: make() });
const perCorner = (w: number | Corners<number>): Corners<number> => (typeof w === 'number' ? { fl: w, fr: w, rl: w, rr: w } : w);
const knownCorners = (w: Corners<number>, at: number): Corners<Known<Percent>> => ({
  fl: known(w.fl as Percent, at),
  fr: known(w.fr as Percent, at),
  rl: known(w.rl as Percent, at),
  rr: known(w.rr as Percent, at),
});

/** A lap of car 0 whose wear goes from `start` to `end` % on every corner (or per corner); `completedAt` is `n * 90 s`. */
const wornLap = (n: number, start: number | Corners<number>, end: number | Corners<number>, over: Partial<LapRecord> = {}): LapRecord => {
  const at = n * 90_000;
  return lap({ lapNumber: n, completedAt: at, wearAtStartPct: knownCorners(perCorner(start), at), wearAtEndPct: knownCorners(perCorner(end), at), ...over });
};

/** Consecutive laps from `from` on, each starting at the wear the lap before ended at (the first at `startPct`) and gaining its `gains` entry. */
const chain = (gains: number[], { from = 1, startPct = 0, over = {} }: { from?: number; startPct?: number; over?: Partial<LapRecord> } = {}): LapRecord[] => {
  let wear = startPct;
  return gains.map((g, i) => {
    const l = wornLap(from + i, wear, wear + g, over);
    wear += g;
    return l;
  });
};

/** The rate of `corner` (`wearRatePerCorner`) over `laps` with `opts` (default `OPTS`). */
const rateOf = (laps: LapRecord[], corner: (typeof CORNERS)[number] = 'fl', opts = OPTS) => wearRatePerCorner(laps, opts)[corner];

describe('wearRatePerCorner', () => {
  it('the rate is the median of the counted laps` own wear gains, as of the newest sample: gains 2, 2, 3, 2, 2 % give 2 %/lap', () => {
    const laps = chain([2, 2, 3, 2, 2]);
    const rates = wearRatePerCorner(laps, OPTS);
    for (const corner of CORNERS) expect(rates[corner]).toEqual({ known: true, value: { perLap: 2, samples: 5 }, at: laps[4]!.completedAt });
  });

  it('each corner has its own rate', () => {
    const at = (i: number) => ({ fl: 2 * i, fr: 3 * i, rl: i, rr: 4 * i });
    const rates = wearRatePerCorner([0, 1, 2].map((i) => wornLap(i + 1, at(i), at(i + 1))), OPTS);
    expect(rates.fl).toMatchObject({ known: true, value: { perLap: 2 } });
    expect(rates.fr).toMatchObject({ known: true, value: { perLap: 3 } });
    expect(rates.rl).toMatchObject({ known: true, value: { perLap: 1 } });
    expect(rates.rr).toMatchObject({ known: true, value: { perLap: 4 } });
  });

  it('a lap`s gain is its own end minus its own start: a jump between laps is in no lap', () => {
    // lap 2 starts 5 % above lap 1's end (wear the engine saw between the two samples): the gains are 2 and 2
    expect(rateOf([wornLap(1, 0, 2), wornLap(2, 7, 9)])).toMatchObject({ known: true, value: { perLap: 2 } });
  });

  it('two counted laps give a rate', () => {
    expect(rateOf(chain([2, 3]))).toMatchObject({ known: true, value: { perLap: 2.5, samples: 2 } });
  });

  it('one counted lap gives no rate: insufficientData', () => {
    expect(rateOf(chain([2]))).toEqual(insufficient);
  });

  it('no laps give no rate: insufficientData on every corner', () => {
    expect(wearRatePerCorner([], OPTS)).toEqual(everyCorner(() => insufficient));
  });

  it('the minimum of samples comes from the per-lap-rate options', () => {
    expect(rateOf(chain([2, 2]), 'fl', { ...OPTS, rate: { ...OPTS.rate, minSamples: 3 } })).toEqual(insufficient);
  });

  it('only the last 5 counted laps count (the window)', () => {
    // the median of all 8 gains is 1; of the last 5 (1, 1, 3, 3, 3) it is 3
    expect(rateOf(chain([1, 1, 1, 1, 1, 3, 3, 3]))).toMatchObject({ known: true, value: { perLap: 3, samples: 5 } });
  });

  it('the window counts per corner: a corner without a sample on the newest laps reads older laps for its window', () => {
    // laps 1-3 gain 1 %, laps 4-8 gain 3 %; fl's end wear is unknown on laps 6-8, so its last 5 samples are laps 1-5
    // (gains 1, 1, 1, 3, 3: median 1), while fr's are laps 4-8 (median 3)
    const laps = chain([1, 1, 1, 3, 3, 3, 3, 3]).map((l) => (l.lapNumber >= 6 ? { ...l, wearAtEndPct: { ...l.wearAtEndPct, fl: unknown('notReceived') } } : l));
    const rates = wearRatePerCorner(laps, OPTS);
    expect(rates.fl).toEqual({ known: true, value: { perLap: 1, samples: 5 }, at: laps[4]!.completedAt });
    expect(rates.fr).toEqual({ known: true, value: { perLap: 3, samples: 5 }, at: laps[7]!.completedAt });
  });

  it('one outlier lap among 5 (a lock-up, a slide) leaves the rate at the other laps` gain', () => {
    expect(rateOf(chain([2, 2, 9, 2, 2]))).toMatchObject({ known: true, value: { perLap: 2 } });
  });

  it('a lap with 2 s or more under SC or VSC is no sample, and its low wear does not pull the rate down', () => {
    // lap 1 green +3 %, laps 2-4 neutralised +0.5 % each, laps 5-6 green +3 %
    const laps = [
      wornLap(1, 0, 3),
      wornLap(2, 3, 3.5, { vscShare: 0.2 }),
      wornLap(3, 3.5, 4, { scShare: 0.97, vscShare: 0.03 }),
      wornLap(4, 4, 4.5, { scShare: 1 }),
      wornLap(5, 4.5, 7.5),
      wornLap(6, 7.5, 10.5),
    ];
    expect(rateOf(laps)).toMatchObject({ known: true, value: { perLap: 3, samples: 3 } });
  });

  it('a lap with under 2 s under SC (the flag lag at a restart) is a sample', () => {
    // lap 2 is green but for 0.9 s: scShare 0.01 of 90 s
    expect(rateOf([wornLap(1, 0, 2.5), wornLap(2, 2.5, 5, { scShare: 0.01 })])).toMatchObject({ known: true, value: { perLap: 2.5 } });
  });

  it('the neutralised time a sample may have comes from the lap-classes options', () => {
    const laps = [wornLap(1, 0, 2.5), wornLap(2, 2.5, 5, { scShare: 0.01 })];
    expect(rateOf(laps, 'fl', { ...OPTS, lapClasses: { ...OPTS.lapClasses, maxNeutralisedMs: 500 } })).toEqual(insufficient);
  });

  it('an in lap and an out lap are no samples', () => {
    const laps = [...chain([2, 2, 2]), wornLap(4, 6, 16, { inLap: true }), wornLap(5, 16, 24, { outLap: true })];
    expect(rateOf(laps)).toMatchObject({ known: true, value: { perLap: 2, samples: 3 } });
  });

  it('lap 1 is a sample: a rate has no lap-1 rule', () => {
    expect(rateOf(chain([2, 2]))).toMatchObject({ known: true, value: { perLap: 2, samples: 2 } });
  });

  it('a lap whose start wear is unknown (the engine joined it after its start) is no sample', () => {
    const joined = wornLap(1, 0, 9, { wearAtStartPct: everyCorner(() => unknown('notReceived')) });
    expect(rateOf([joined, wornLap(2, 9, 11)])).toEqual(insufficient);
    expect(rateOf([joined, wornLap(2, 9, 11), wornLap(3, 11, 13)])).toMatchObject({ known: true, value: { perLap: 2 } });
  });

  it('a lap with an unknown start or end wear on one corner is no sample for that corner only', () => {
    const [first, second] = chain([2, 2]);
    const noStart = { ...second!, wearAtStartPct: { ...second!.wearAtStartPct, fl: unknown('notReceived') } };
    const noEnd = { ...second!, wearAtEndPct: { ...second!.wearAtEndPct, rr: unknown('notReceived') } };
    const a = wearRatePerCorner([first!, noStart], OPTS);
    expect(a.fl).toEqual(insufficient);
    expect(a.fr).toMatchObject({ known: true, value: { perLap: 2 } });
    const b = wearRatePerCorner([first!, noEnd], OPTS);
    expect(b.rr).toEqual(insufficient);
    expect(b.rl).toMatchObject({ known: true, value: { perLap: 2 } });
  });

  it('a corner whose wear is hidden on every lap has no rate: insufficientData, as tyre-life`s rule today (not the hiding reason)', () => {
    // `degradation`'s `wearRates` gave the reason the newest hiding lap hid it (here `realism`); the shared rule keeps
    // `tyre-life`'s, the published one (brief F2), until the supervisor rules otherwise
    const hidden = unknown('realism');
    const laps = [1, 2, 3].map((n) => wornLap(n, 0, 0, { wearAtStartPct: everyCorner(() => hidden), wearAtEndPct: everyCorner(() => hidden) }));
    expect(wearRatePerCorner(laps, OPTS)).toEqual(everyCorner(() => insufficient));
  });

  it('wear that does not grow has a rate of 0', () => {
    expect(rateOf(chain([0, 0, 0], { startPct: 5 }))).toMatchObject({ known: true, value: { perLap: 0 } });
  });
});

describe('wearBasis', () => {
  it('every corner`s wear known: the wear basis', () => {
    expect(wearBasis(knownCorners(perCorner(10), 0))).toBe('wear');
  });

  it('one corner`s wear unknown: the age basis', () => {
    expect(wearBasis({ ...knownCorners(perCorner(10), 0), rl: unknown('notReceived') })).toBe('age');
  });

  it('a rival whose wear realism hides: the age basis', () => {
    expect(wearBasis(everyCorner(() => unknown('realism')))).toBe('age');
  });
});

describe('degradation and tyre-life', () => {
  const degradation = guardedQuick(degradationCalculator);
  const tyreLife = guardedQuick(tyreLifeCalculator);

  it('degradation and tyre-life agree on a stint`s wear rate per corner', () => {
    // one stint of car 0 on a new soft C3 set, laps 1-7 (a race): per corner its own gains (fl 2, fr 3, rl 1, rr 4 %/lap),
    // a lock-up on lap 3 (+9 % at fr), lap 5 under SC (no sample), and fl's start wear unknown on every lap (the engine
    // never saw it), so fl has no sample on any lap while its live wear is known
    const gains = { fl: 2, fr: 3, rl: 1, rr: 4 };
    let wear: Corners<number> = { fl: 0, fr: 0, rl: 0, rr: 0 };
    const laps: LapRecord[] = [];
    for (let n = 1; n <= 7; n++) {
      const end = { fl: wear.fl + gains.fl, fr: wear.fr + gains.fr + (n === 3 ? 9 : 0), rl: wear.rl + gains.rl, rr: wear.rr + gains.rr };
      const l = wornLap(n, wear, end, { tyreAgeAtStart: n - 1, fuelAtStartKg: known(100 - 1.5 * (n - 1), n * 90_000), ...(n === 5 && { scShare: 1 }) });
      laps.push({ ...l, wearAtStartPct: { ...l.wearAtStartPct, fl: unknown('notReceived') } });
      wear = end;
    }
    const set: { actualCompound: ActualCompound; visualCompound: VisualCompound; age: number } = { actualCompound: 'C3', visualCompound: 'soft', age: 7 };
    const car = carState({ tyres: { ...set, corners: { fl: { wearPct: known(wear.fl as Percent, 0) }, fr: { wearPct: known(wear.fr as Percent, 0) }, rl: { wearPct: known(wear.rl as Percent, 0) }, rr: { wearPct: known(wear.rr as Percent, 0) } } } });
    const base = { cars: [car], history: { laps } };
    const degOut: DegradationOutput = degradation.compute(situatedView(base));
    const outputs: EngineView['outputs'] = new Map([[DEGRADATION, degOut]]);
    const lifeOut = tyreLife.compute(situatedView({ ...base, outputs }));

    const stint = degOut[carId(0)]?.at(-1);
    const life = lifeOut[carId(0)];
    expect(stint).toBeDefined();
    expect(life).toBeDefined();
    const shared = wearRatePerCorner(laps, OPTS);
    for (const corner of CORNERS) {
      const rate = shared[corner];
      const expected = rate.known ? known(rate.value.perLap, rate.at) : rate;
      expect(life!.corners[corner].ratePctPerLap, `tyre-life ${corner}`).toEqual(expected);
      expect(stint!.wearRatePctPerLap[corner], `degradation ${corner}`).toEqual(expected);
    }
    // the case's corners: fr's lock-up is an outlier, fl has no sample at all
    expect(shared.fr).toMatchObject({ known: true, value: { perLap: 3 } });
    expect(shared.fl).toEqual(insufficient);
  });
});
