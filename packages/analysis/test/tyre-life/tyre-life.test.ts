// `tyre-life` (spec 4.2): the rate and laps-to-limit cases ported from `test/tyre-wear/` (same inputs, same expectations,
// on `tyre-life`'s output; C82), and its own rows: the age basis, the worst corner, the fresh-set life per compound and
// the set's overrides of the limits. Priors and `degradation`'s output are passed explicitly (C84).
import {
  carId,
  known,
  unknown,
  type ActualCompound,
  type Corners,
  type LapRecord,
  type Percent,
  type PriorsSnapshot,
  type StintRecord,
  type TyreSet,
  type VisualCompound,
} from '@pitwall/domain';
import type { EngineView } from '@pitwall/engine';
import { describe, expect, it } from 'vitest';
import { DEGRADATION, type DegradationOutput, type StintDegradation } from '../../src/degradation/index.ts';
import { LAP_CLASSES_CONFIG } from '../../src/lap-classes/index.ts';
import { PER_LAP_RATE_CONFIG } from '../../src/per-lap-rate/index.ts';
import * as tyreLifeUnit from '../../src/tyre-life/index.ts';
import { TYRE_LIFE, TYRE_LIFE_CONFIG } from '../../src/tyre-life/index.ts';
import { tyreLifeCalculator } from '../../src/tyre-life/calculator.ts';
import { carState, lap, realismHidden } from '../../../../test-support/builders/index.ts';
import { engineShaped } from '../engine-shaped.ts';
import { guardedQuick, NONE, PRACTICE, QUALIFYING, situatedView } from '../situated.ts';

/** The calculator through its guarded view (C41): every case fails on a read it does not declare. */
const calc = guardedQuick(tyreLifeCalculator);

const CORNERS = ['fl', 'fr', 'rl', 'rr'] as const;

const stint = (over: Partial<StintRecord> & Pick<StintRecord, 'firstLap' | 'lastLap'>): StintRecord => ({
  carId: carId(0),
  actualCompound: 'C3',
  visualCompound: 'soft',
  tyreAgeAtFitting: 0,
  frame: 0,
  ...over,
});

const everyCorner = <T>(make: () => T): Corners<T> => ({ fl: make(), fr: make(), rl: make(), rr: make() });
const perCorner = (w: number | Corners<number>): Corners<number> => (typeof w === 'number' ? { fl: w, fr: w, rl: w, rr: w } : w);
const knownCorners = (w: Corners<number>, at: number) => ({ fl: known(w.fl, at), fr: known(w.fr, at), rl: known(w.rl, at), rr: known(w.rr, at) });

/** A lap of car 0 whose wear goes from `start` to `end` % on every corner (or per corner); `completedAt` is `n * 90 s`. */
const wornLap = (n: number, start: number | Corners<number>, end: number | Corners<number>, over: Partial<LapRecord> = {}): LapRecord => {
  const at = n * 90_000;
  return lap({ lapNumber: n, wearAtStartPct: knownCorners(perCorner(start), at), wearAtEndPct: knownCorners(perCorner(end), at), ...over });
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

/** Car 0 with live wear `now` on every corner, on the given set (default: soft C3, age 0). */
const carWithWear = (now: number, set: { age?: number; actualCompound?: ActualCompound; visualCompound?: VisualCompound } = {}) =>
  carState({
    tyres: {
      ...set,
      corners: everyCorner(() => ({ wearPct: known(now as Percent, 0) })),
    },
  });

/** One stint of `degradation`'s output (spec 4.1): soft C3, `ν` 100 ms per lap unless `over` says otherwise. */
const degStint = (over: Partial<StintDegradation> = {}): StintDegradation => ({
  stint: 1,
  // the stint's first and last lap (G1); tyre-life reads neither
  firstLap: 1,
  lastLap: 3,
  actual: 'C3',
  visual: 'soft',
  basePaceMs: known(87_000, 0),
  nuMsPerLap: known(100, 0),
  nuSdMs: known(20, 0),
  basis: 'wear',
  fuelCorrected: true,
  wearRatePctPerLap: everyCorner(() => unknown('insufficientData')),
  source: { kind: 'session', sessionShare: 1, parts: '3 laps' },
  laps: [],
  // degradation's fit band and start prior (ruling R19); tyre-life reads neither
  cov: unknown('insufficientData'),
  startPrior: { nuMsPerLap: 60, nuSdMs: 60, alphaOffsetMs: unknown('notApplicable'), source: { kind: 'default', note: 'degradation config default (pitwall estimate)', sessionShare: 0, parts: 'config default' } },
  ...over,
});

/** `degradation`'s output as the view's `outputs` hold it; by default no car has a stint yet. */
const upstream = (degradation: DegradationOutput = {}): EngineView['outputs'] => new Map([[DEGRADATION, degradation]]);

/** A priors snapshot (C62a) of set "Zandvoort long runs" holding `entries` (key → value). */
const snapshot = (entries: Record<string, number>): EngineView['priors'] => {
  const value: PriorsSnapshot = {
    fingerprint: 'fp-long-runs',
    setId: 'long-runs',
    setName: 'Zandvoort long runs',
    sources: 2,
    entries: Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, known(v, 0)])),
  };
  return known(value, 0);
};

/** Wear-rate priors of `compound` per corner, as `tyreLife.wearPerLapPct.<compound>.<corner>` entries. */
const wearPriors = (compound: VisualCompound, rates: Corners<number>): Record<string, number> =>
  Object.fromEntries(CORNERS.map((c) => [`tyreLife.wearPerLapPct.${compound}.${c}`, rates[c]]));

/** Car 0 with wear `now`, on a set as old as its newest lap (fitted new at the start of lap 1), over `laps`. */
const viewOf = (laps: LapRecord[], now: number, stints: StintRecord[] = [], config: EngineView['config'] = {}): EngineView => {
  const age = Math.max(0, ...laps.filter((l) => l.carId === carId(0)).map((l) => l.lapNumber));
  return situatedView({ cars: [carWithWear(now, { age })], history: { laps, stints }, config, outputs: upstream() });
};

const run = (view: EngineView) => calc.compute(view)[carId(0)]!;
const insufficient = { known: false, reason: 'insufficientData' };

describe('tyre-life calculator', () => {
  it('is the quick calculator `tyre-life` at 4 Hz over laps, stints, tyres, car-status, decisions and degradation, not the session', () => {
    expect(tyreLifeCalculator.id).toBe(TYRE_LIFE);
    expect(tyreLifeCalculator.kind).toBe('quick');
    expect(tyreLifeCalculator.cadence).toEqual({ hz: 4 });
    expect(tyreLifeCalculator.reads).toEqual(expect.arrayContaining(['laps', 'stints', 'tyres', 'spans:car-status', 'decisions']));
    expect(tyreLifeCalculator.reads).toContainEqual({ calculator: 'degradation' });
    expect(tyreLifeCalculator.reads).not.toContain('session');
  });

  describe('ported from tyre-wear: the wear rate and the laps to the limit per corner', () => {
    it('the rate is the median of the counted laps` own wear gains: gains 2, 2, 3, 2, 2 % give 2 %/lap, 29.5 laps from 11 % to 70 %', () => {
      const laps = chain([2, 2, 3, 2, 2]);
      const out = run(viewOf(laps, 11));
      for (const corner of CORNERS) {
        expect(out.corners[corner].wearPct).toEqual({ known: true, value: 11, at: 0 });
        // the rate and the laps to the limit are as of the newest lap used
        expect(out.corners[corner].ratePctPerLap).toEqual({ known: true, value: 2, at: laps[4]!.completedAt });
        expect(out.corners[corner].lapsToLimit).toEqual({ known: true, value: 29.5, at: laps[4]!.completedAt });
      }
      expect(out.limitPct).toBe(70);
    });

    it('each corner has its own rate', () => {
      const at = (i: number) => ({ fl: 2 * i, fr: 3 * i, rl: i, rr: 4 * i });
      const laps = [0, 1, 2].map((i) => wornLap(i + 1, at(i), at(i + 1)));
      const { corners } = run(viewOf(laps, 6));
      expect(corners.fl.ratePctPerLap).toMatchObject({ known: true, value: 2 });
      expect(corners.fr.ratePctPerLap).toMatchObject({ known: true, value: 3 });
      expect(corners.rl.ratePctPerLap).toMatchObject({ known: true, value: 1 });
      expect(corners.rr.ratePctPerLap).toMatchObject({ known: true, value: 4 });
    });

    it('a lap`s gain is its own end minus its own start: a jump between laps is in no lap', () => {
      // lap 2 starts 5 % above lap 1's end (wear the engine saw between the two samples): the gains are 2 and 2
      const laps = [wornLap(1, 0, 2), wornLap(2, 7, 9)];
      expect(run(viewOf(laps, 9)).corners.fl.ratePctPerLap).toMatchObject({ known: true, value: 2 });
    });

    it('the limit comes from the config', () => {
      const out = run(viewOf(chain([2, 2, 2, 2, 2]), 10, [], { [TYRE_LIFE_CONFIG.key]: { wearLimitPct: 80 } }));
      expect(out.limitPct).toBe(80);
      expect(out.corners.fl.lapsToLimit).toMatchObject({ known: true, value: 35 });
    });

    it('two counted laps give a rate', () => {
      expect(run(viewOf(chain([2, 3]), 5)).corners.fl.ratePctPerLap).toMatchObject({ known: true, value: 2.5 });
    });

    it('one counted lap gives no rate: rate and laps to the limit insufficientData, the wear stays known', () => {
      const out = run(viewOf(chain([2]), 2));
      expect(out.corners.fl.ratePctPerLap).toEqual(insufficient);
      expect(out.corners.fl.lapsToLimit).toEqual(insufficient);
      expect(out.corners.fl.wearPct).toMatchObject({ known: true, value: 2 });
    });

    it('the minimum of samples comes from the per-lap-rate config', () => {
      const strict = viewOf(chain([2, 2]), 4, [], { [PER_LAP_RATE_CONFIG.key]: { minSamples: 3 } });
      expect(run(strict).corners.fl.ratePctPerLap).toEqual(insufficient);
    });

    it('only the last 5 counted laps count (the window)', () => {
      // the median of all 8 gains is 1; of the last 5 (1, 1, 3, 3, 3) it is 3
      expect(run(viewOf(chain([1, 1, 1, 1, 1, 3, 3, 3]), 14)).corners.fl.ratePctPerLap).toMatchObject({ known: true, value: 3 });
    });

    it('one outlier lap among 5 (a lock-up, a slide) leaves the rate at the other laps` gain', () => {
      expect(run(viewOf(chain([2, 2, 9, 2, 2]), 17)).corners.fl.ratePctPerLap).toMatchObject({ known: true, value: 2 });
    });

    it('a lap with 2 s or more under SC or VSC is no sample, and its low wear does not pull the rate down', () => {
      // race: lap 1 green +3 %, laps 2-4 neutralised +0.5 % each, laps 5-6 green +3 %
      const laps = [
        wornLap(1, 0, 3),
        wornLap(2, 3, 3.5, { vscShare: 0.2 }),
        wornLap(3, 3.5, 4, { scShare: 0.97, vscShare: 0.03 }),
        wornLap(4, 4, 4.5, { scShare: 1 }),
        wornLap(5, 4.5, 7.5),
        wornLap(6, 7.5, 10.5),
      ];
      expect(run(viewOf(laps, 10.5)).corners.fl.ratePctPerLap).toMatchObject({ known: true, value: 3 });
    });

    it('a lap with under 2 s under SC (the flag lag at a restart) is a sample', () => {
      // lap 2 is green but for 0.9 s: scShare 0.01 of 90 s
      const laps = [wornLap(1, 0, 2.5), wornLap(2, 2.5, 5, { scShare: 0.01 })];
      expect(run(viewOf(laps, 5)).corners.fl.ratePctPerLap).toMatchObject({ known: true, value: 2.5 });
    });

    it('the neutralised time a sample may have comes from the lap-classes config', () => {
      const laps = [wornLap(1, 0, 2.5), wornLap(2, 2.5, 5, { scShare: 0.01 })];
      const strict = viewOf(laps, 5, [], { [LAP_CLASSES_CONFIG.key]: { maxNeutralisedMs: 500 } });
      expect(run(strict).corners.fl.ratePctPerLap).toEqual(insufficient);
    });

    it('an in lap and an out lap are no samples', () => {
      const laps = [...chain([2, 2, 2]), wornLap(4, 6, 16, { inLap: true }), wornLap(5, 16, 24, { outLap: true })];
      expect(run(viewOf(laps, 24)).corners.fl.ratePctPerLap).toMatchObject({ known: true, value: 2 });
    });

    it('a lap whose start wear is unknown (the engine joined it after its start) is no sample', () => {
      const joined = wornLap(1, 0, 9, { wearAtStartPct: everyCorner(() => unknown('notReceived')) });
      expect(run(viewOf([joined, wornLap(2, 9, 11)], 11)).corners.fl.ratePctPerLap).toEqual(insufficient);
      expect(run(viewOf([joined, wornLap(2, 9, 11), wornLap(3, 11, 13)], 13)).corners.fl.ratePctPerLap).toMatchObject({ known: true, value: 2 });
    });

    it('a lap with an unknown start or end wear on one corner is no sample for that corner only', () => {
      const [first, second] = chain([2, 2]);
      const noStart = { ...second!, wearAtStartPct: { ...second!.wearAtStartPct, fl: unknown('notReceived') } };
      const noEnd = { ...second!, wearAtEndPct: { ...second!.wearAtEndPct, rr: unknown('notReceived') } };
      const a = run(viewOf([first!, noStart], 4)).corners;
      expect(a.fl.ratePctPerLap).toEqual(insufficient);
      expect(a.fr.ratePctPerLap).toMatchObject({ known: true, value: 2 });
      const b = run(viewOf([first!, noEnd], 4)).corners;
      expect(b.rr.ratePctPerLap).toEqual(insufficient);
      expect(b.rl.ratePctPerLap).toMatchObject({ known: true, value: 2 });
    });

    it('the rate uses only the current stint', () => {
      // stop at the end of lap 4 (in lap 4, out lap 5): the old set wore 3 %/lap, the new one wears 2 %/lap
      const laps = [
        ...chain([3, 3, 3]).map((l, i) => ({ ...l, tyreAgeAtStart: i })),
        wornLap(4, 9, 12, { inLap: true, tyreAgeAtStart: 3 }),
        wornLap(5, 0, 1, { outLap: true, tyreAgeAtStart: 0 }),
        ...chain([2, 2, 2], { from: 6, startPct: 1 }).map((l, i) => ({ ...l, tyreAgeAtStart: i + 1 })),
      ];
      const closed = [stint({ firstLap: 1, lastLap: 4 })]; // the open stint (lap 5 on) is not a record yet
      const view = situatedView({ cars: [carWithWear(7, { age: 4 })], history: { laps, stints: closed }, outputs: upstream() });
      const out = run(view);
      expect(out.corners.fl.ratePctPerLap).toMatchObject({ known: true, value: 2 });
      expect(out.corners.fl.lapsToLimit).toMatchObject({ known: true, value: 31.5 });
    });

    it('right after a stop the rate is insufficientData however long the previous stint was', () => {
      const laps = [...chain([3, 3, 3, 3]), wornLap(5, 12, 15, { inLap: true }), wornLap(6, 0, 1, { outLap: true }), wornLap(7, 1, 3)];
      const out = run(viewOf(laps, 3, [stint({ firstLap: 1, lastLap: 5 })]));
      expect(out.corners.fl.ratePctPerLap).toEqual(insufficient);
      expect(out.corners.fl.lapsToLimit).toEqual(insufficient);
      expect(out.corners.fl.wearPct).toMatchObject({ known: true, value: 3 });
    });

    it('a stint record that ends on the newest lap (the session ended) is the current stint', () => {
      const laps = [...chain([4, 4]), ...chain([2, 2, 2, 2], { from: 3 })];
      const stints = [stint({ firstLap: 1, lastLap: 2 }), stint({ firstLap: 3, lastLap: 6 })];
      expect(run(viewOf(laps, 8, stints)).corners.fl.ratePctPerLap).toMatchObject({ known: true, value: 2 });
    });

    describe('no old-set rate on a new set (user ruling 2026-10-30)', () => {
      // laps 1-4 on soft C3 from new (age 0 to 3 at the lap starts) wear 3 %/lap
      const oldSet = () => chain([3, 3, 3, 3]).map((l, i) => ({ ...l, tyreAgeAtStart: i }));
      const withCar = (laps: LapRecord[], set: Parameters<typeof carWithWear>[1], stints: StintRecord[] = []) =>
        run(situatedView({ cars: [carWithWear(0, set)], history: { laps, stints }, outputs: upstream() }));

      it('a new set fitted at a stop whose in lap has not been followed by a completed lap: insufficientData, not the old set`s rate', () => {
        // the stint record reaches the newest lap (the in lap 5), so the closed stint is still the current one
        const laps = [...oldSet(), wornLap(5, 12, 15, { inLap: true, tyreAgeAtStart: 4 })];
        const out = withCar(laps, { age: 0 }, [stint({ firstLap: 1, lastLap: 5 })]);
        for (const corner of CORNERS) {
          expect(out.corners[corner].ratePctPerLap).toEqual(insufficient);
          expect(out.corners[corner].lapsToLimit).toEqual(insufficient);
          expect(out.corners[corner].wearPct).toMatchObject({ known: true, value: 0 });
        }
      });

      it('a new set fitted in the garage on the same lap number (no stint record yet): insufficientData', () => {
        expect(withCar(oldSet(), { age: 0 }).corners.fl.ratePctPerLap).toEqual(insufficient);
      });

      it('a used set of another compound with more laps on it: insufficientData', () => {
        const out = withCar(oldSet(), { age: 6, actualCompound: 'C2', visualCompound: 'medium' });
        expect(out.corners.fl.ratePctPerLap).toEqual(insufficient);
      });

      it('the same set after a garage visit keeps its rate', () => {
        // the car is back out on the set its samples were taken on: age 4, soft C3
        expect(withCar(oldSet(), { age: 4 }).corners.fl.ratePctPerLap).toMatchObject({ known: true, value: 3 });
      });

      // finding fx1: the set change is looked for over the stint's laps, in lap included, before the rate laps are taken
      it('after a stop whose in lap is the newest lap, a used set of the same compound has no samples from the old set', () => {
        // the in lap 5 (age 4 at its start) is the newest lap; the stint record still reaches it. The fitted set is a used
        // soft C3 of age 3: at least lap 4's age (3), below the in lap's own (4), so only the in lap shows the change
        const laps = [...oldSet(), wornLap(5, 12, 15, { inLap: true, tyreAgeAtStart: 4 })];
        const out = withCar(laps, { age: 3 }, [stint({ firstLap: 1, lastLap: 5 })]);
        for (const corner of CORNERS) {
          expect(out.corners[corner].ratePctPerLap).toEqual(insufficient);
          expect(out.corners[corner].lapsToLimit).toEqual(insufficient);
        }
      });

      it('a stint without a stop keeps its rate', () => {
        // laps 1-6 on the fitted soft C3 from new, lap 3 under SC (no rate lap, but on the set): 3 %/lap on the green laps
        const laps = [
          ...oldSet().slice(0, 2),
          wornLap(3, 6, 6.5, { scShare: 1, tyreAgeAtStart: 2 }),
          ...chain([3, 3, 3], { from: 4, startPct: 6.5 }).map((l, i) => ({ ...l, tyreAgeAtStart: i + 3 })),
        ];
        const out = withCar(laps, { age: 6 }, [stint({ firstLap: 1, lastLap: 6 })]);
        for (const corner of CORNERS) expect(out.corners[corner].ratePctPerLap).toMatchObject({ known: true, value: 3 });
      });
    });

    describe('on engine-shaped history: every lap provisional then confirmed, no record for the open stint', () => {
      it('the rate uses only the open stint', () => {
        const laps = engineShaped([
          ...chain([3, 3, 3]),
          wornLap(4, 9, 12, { inLap: true }),
          wornLap(5, 0, 1, { outLap: true }),
          ...chain([2, 2, 2], { from: 6, startPct: 1 }),
        ]);
        const out = run(viewOf(laps, 7, [stint({ firstLap: 1, lastLap: 4 })]));
        expect(out.corners.fl.ratePctPerLap).toMatchObject({ known: true, value: 2 });
      });

      it('a lap counts once: one lap, written twice, is below minSamples (2)', () => {
        expect(run(viewOf(engineShaped(chain([2])), 2)).corners.fl.ratePctPerLap).toEqual(insufficient);
      });

      it('the confirmed record wins over the provisional one', () => {
        const laps = engineShaped(chain([2, 2, 2]), { wearAtEndPct: everyCorner(() => known(60, 1)) });
        expect(run(viewOf(laps, 6)).corners.fl.ratePctPerLap).toMatchObject({ known: true, value: 2 });
      });
    });

    it('without a stint record the history counts as one stint', () => {
      expect(run(viewOf(chain([2, 2]), 4)).corners.fl.ratePctPerLap).toMatchObject({ known: true, value: 2 });
    });

    it('at or past the limit the laps to it are 0 as of the wear reading, so the wear alarm stays raised', () => {
      const laps = chain([4, 4, 4], { startPct: 60 });
      expect(run(viewOf(laps, 76)).corners.fl.lapsToLimit).toEqual({ known: true, value: 0, at: 0 });
      expect(run(viewOf(laps, 70)).corners.fl.lapsToLimit).toEqual({ known: true, value: 0, at: 0 });
      // even before there is a rate
      expect(run(viewOf([wornLap(1, 68, 72)], 76)).corners.fl.lapsToLimit).toEqual({ known: true, value: 0, at: 0 });
    });

    it('wear that does not grow has no laps to the limit', () => {
      const { fl } = run(viewOf(chain([0, 0, 0], { startPct: 5 }), 5)).corners;
      expect(fl.ratePctPerLap).toMatchObject({ known: true, value: 0 });
      expect(fl.lapsToLimit).toEqual({ known: false, reason: 'notApplicable' });
    });

    it('gameLifeSpanLaps is the fitted set`s lifeSpanLaps', () => {
      const set = (over: Partial<TyreSet>): TyreSet => ({
        actualCompound: 'C3',
        visualCompound: 'soft',
        wearPct: 0,
        available: true,
        fitted: false,
        recommendedSession: 0,
        lifeSpanLaps: 9,
        usableLifeLaps: 7,
        lapDeltaMs: 0,
        ...over,
      });
      const car = carState({
        tyres: { sets: known({ sets: [set({}), set({ fitted: true, lifeSpanLaps: 22 }), set({ lifeSpanLaps: 14 })], fittedIdx: 1 }, 1_000) },
      });
      const view = situatedView({ cars: [car], history: { laps: chain([1]) }, outputs: upstream() });
      expect(run(view).gameLifeSpanLaps).toEqual({ known: true, value: 22, at: 1_000 });
    });

    it('gameLifeSpanLaps is unknown without a fitted set in the list', () => {
      // the builder's car has `sets` known with an empty list
      const view = situatedView({ cars: [carState()], history: { laps: chain([1]) }, outputs: upstream() });
      expect(run(view).gameLifeSpanLaps).toEqual({ known: false, reason: 'notReceived' });
    });

    it('realism: a rival`s corners are unknown(`realism`)', () => {
      const hidden = unknown('realism');
      const rivalLaps = [1, 2, 3, 4].map((n) =>
        wornLap(n, 0, 0, { carId: carId(1), wearAtStartPct: everyCorner(() => hidden), wearAtEndPct: everyCorner(() => hidden) }),
      );
      const view = situatedView({
        cars: [carWithWear(6, { age: 3 }), realismHidden(carState({ id: carId(1) }))],
        history: { laps: [...chain([2, 2, 2]), ...rivalLaps] },
        outputs: upstream(),
      });
      const out = calc.compute(view);
      for (const corner of CORNERS) {
        expect(out[carId(1)]!.corners[corner]).toEqual({
          wearPct: hidden,
          ratePctPerLap: hidden,
          lapsToLimit: hidden,
        });
      }
      expect(out[carId(1)]!.gameLifeSpanLaps).toEqual(hidden);
      // our own car is unaffected
      expect(out[carId(0)]!.corners.fl.ratePctPerLap).toMatchObject({ known: true, value: 2 });
    });

    it('keeps cars apart and gives no entry to a slot without a car in the session (no car-status span)', () => {
      const second = carState({ id: carId(1), tyres: { age: 2, corners: everyCorner(() => ({ wearPct: known(9 as Percent, 0) })) } });
      const laps = [...chain([2, 2]), ...chain([3, 3], { over: { carId: carId(1) } })];
      const out = calc.compute(situatedView({ cars: [carWithWear(4, { age: 2 }), second], history: { laps }, outputs: upstream() }));
      expect(out[carId(0)]!.corners.fl.ratePctPerLap).toMatchObject({ value: 2 });
      expect(out[carId(1)]!.corners.fl.ratePctPerLap).toMatchObject({ value: 3 });
      expect(out[carId(2)]).toBeUndefined();
    });

    describe('behaviour table (C44): a row per car-status kind', () => {
      it('exports TYRE_LIFE_BEHAVIOUR over car-status alone, the one sub-machine it reads (laps by activity come from the lap records)', () => {
        const table = (tyreLifeUnit as unknown as Record<string, object | undefined>)['TYRE_LIFE_BEHAVIOUR'];
        expect(table).toBeDefined();
        expect(Object.keys(table ?? {})).toEqual(['car-status']);
      });

      // car 0 on a set as old as its three laps of 2 %/lap; car-status decides (C43)
      const statusView = (kind: string) =>
        situatedView({ cars: [carWithWear(6, { age: 3 })], history: { laps: chain([2, 2, 2]) }, status: { 0: kind }, outputs: upstream() });

      it('competing: the car has its wear, rate and laps to the limit', () => {
        const out = calc.compute(statusView('competing'))[carId(0)];
        expect(out?.corners.fl.wearPct).toEqual({ known: true, value: 6, at: 0 });
        expect(out?.corners.fl.ratePctPerLap).toMatchObject({ known: true, value: 2 });
        expect(out?.corners.fl.lapsToLimit).toMatchObject({ known: true, value: 32 });
      });

      it('retired: the car is still in the session and keeps its entry, its rate as of its laps', () => {
        expect(calc.compute(statusView('retired'))[carId(0)]?.corners.fl.ratePctPerLap).toMatchObject({ known: true, value: 2 });
      });

      it('disqualified: the car is still in the session and keeps its entry', () => {
        expect(calc.compute(statusView('disqualified'))[carId(0)]?.corners.fl.ratePctPerLap).toMatchObject({ known: true, value: 2 });
      });

      it('absent: no entry, though the slot has laps', () => {
        expect(calc.compute(statusView('absent'))[carId(0)]).toBeUndefined();
      });
    });

    it('runs in every weekend phase without reading the session: practice, qualifying and none give the race`s rate (no lap 1 rule for a rate)', () => {
      const laps = chain([2, 2, 2]);
      for (const phase of [PRACTICE, QUALIFYING, NONE]) {
        const view = situatedView({ cars: [carWithWear(6, { age: 3 })], history: { laps }, phase, outputs: upstream() });
        expect(run(view).corners.fl.ratePctPerLap, phase.kind).toMatchObject({ known: true, value: 2 });
      }
    });
  });

  describe('the set`s laps to its limit', () => {
    it('the worst corner limits: on the wear basis the car`s laps to the limit are its corner with the fewest', () => {
      // wear 6 % on every corner; rates fl 2, fr 3, rl 1, rr 4 %/lap: (70 − 6) / 4 = 16 laps at rr
      const at = (i: number) => ({ fl: 2 * i, fr: 3 * i, rl: i, rr: 4 * i });
      const laps = [0, 1, 2].map((i) => wornLap(i + 1, at(i), at(i + 1)));
      // `degradation`'s `ν` for the stint changes nothing while the wear is visible
      const view = situatedView({ cars: [carWithWear(6, { age: 3 })], history: { laps }, outputs: upstream({ [carId(0)]: [degStint()] }) });
      const out = run(view);
      expect(out.basis).toBe('wear');
      expect(out.corners.rr.lapsToLimit).toMatchObject({ known: true, value: 16 });
      expect(out.lapsToLimit).toEqual(out.corners.rr.lapsToLimit);
      // without a rate on any corner the car's laps are insufficientData
      expect(run(viewOf(chain([2]), 2)).lapsToLimit).toEqual(insufficient);
    });

    it('age basis: a rival whose wear realism hides reaches the limit where ν · age is ageLossLimitMs (ν 100, limit 2000, age 12 → 8 laps)', () => {
      const rival = realismHidden(carState({ id: carId(1), tyres: { age: 12, actualCompound: 'C3', visualCompound: 'soft' } }));
      const view = situatedView({
        cars: [carWithWear(6, { age: 3 }), rival],
        history: { laps: chain([2, 2, 2]) },
        outputs: upstream({ [carId(1)]: [degStint({ basis: 'age', fuelCorrected: false })] }),
      });
      const out = calc.compute(view)[carId(1)]!;
      expect(out.basis).toBe('age');
      expect(out.ageLossLimitMs).toBe(2000);
      expect(out.lapsToLimit).toMatchObject({ known: true, value: 8 });
      // its corners stay hidden
      expect(out.corners.fl.lapsToLimit).toEqual(unknown('realism'));
    });
  });

  describe('fresh-set life per compound (for the pit window)', () => {
    it('from the priors` wear rates: laps from 0 to the limit at the worst corner, ahead of ν', () => {
      // soft: fl 2, fr 2.5, rl 1.6, rr 2 %/lap → 70 / 2.5 = 28 laps; ν 100 on soft would give 20
      const view = situatedView({
        cars: [carWithWear(6, { age: 3 })],
        history: { laps: chain([2, 2, 2]) },
        outputs: upstream({ [carId(0)]: [degStint()] }),
        priors: snapshot(wearPriors('soft', { fl: 2, fr: 2.5, rl: 1.6, rr: 2 })),
      });
      const fresh = run(view).freshLifeLaps;
      expect(fresh.soft).toMatchObject({ known: true, value: 28 });
      for (const compound of ['hard', 'inter', 'wet'] as const) expect(fresh[compound], compound).toEqual(insufficient);
    });

    it('from ν without wear priors (age basis): ageLossLimitMs / ν; a compound without either is insufficientData', () => {
      // no priors snapshot; `degradation` has a medium stint with ν 100: 2000 / 100 = 20 laps
      const view = situatedView({
        cars: [carWithWear(6, { age: 3, actualCompound: 'C2', visualCompound: 'medium' })],
        history: { laps: chain([2, 2, 2], { over: { actualCompound: 'C2', visualCompound: 'medium' } }) },
        outputs: upstream({ [carId(0)]: [degStint({ actual: 'C2', visual: 'medium' })] }),
      });
      const fresh = run(view).freshLifeLaps;
      expect(fresh.medium).toMatchObject({ known: true, value: 20 });
      for (const compound of ['soft', 'hard', 'inter', 'wet'] as const) expect(fresh[compound], compound).toEqual(insufficient);
    });

    it('fresh life from priors needs all four corners; with one missing it falls back to ν', () => {
      // ruling R21. medium: fl 2, fr 2.5, rl 1.6 %/lap → the wear rule would give 70 / 2.5 = 28 laps; ν 100 gives 2000 / 100 = 20
      const threeCorners = Object.fromEntries(Object.entries(wearPriors('medium', { fl: 2, fr: 2.5, rl: 1.6, rr: 2 })).filter(([k]) => !k.endsWith('.rr')));
      const rrKey = 'tyreLife.wearPerLapPct.medium.rr';
      const mediumView = (priors: EngineView['priors'], stints: StintDegradation[] = [degStint({ actual: 'C2', visual: 'medium' })]) =>
        situatedView({
          cars: [carWithWear(6, { age: 3, actualCompound: 'C2', visualCompound: 'medium' })],
          history: { laps: chain([2, 2, 2], { over: { actualCompound: 'C2', visualCompound: 'medium' } }) },
          outputs: upstream({ [carId(0)]: stints }),
          priors,
        });
      const withEntries = (entries: PriorsSnapshot['entries']): EngineView['priors'] =>
        known({ fingerprint: 'fp-long-runs', setId: 'long-runs', setName: 'Zandvoort long runs', sources: 2, entries }, 0);

      // rr absent: ν of the car's newest medium stint
      expect(run(mediumView(snapshot(threeCorners))).freshLifeLaps.medium).toMatchObject({ known: true, value: 20 });
      // rr present but unknown: the same
      const rrUnknown = { ...Object.fromEntries(Object.entries(threeCorners).map(([k, v]) => [k, known(v, 0)])), [rrKey]: unknown('insufficientData') };
      expect(run(mediumView(withEntries(rrUnknown))).freshLifeLaps.medium).toMatchObject({ known: true, value: 20 });
      // rr absent and no medium stint of the car: the priors' ν (80 → 25 laps)
      const priorNu = snapshot({ ...threeCorners, 'degradation.nuMsPerLap.medium': 80 });
      expect(run(mediumView(priorNu, [])).freshLifeLaps.medium).toMatchObject({ known: true, value: 25 });
      // rr absent, no ν anywhere: insufficientData, not the worst of the three known corners
      expect(run(mediumView(snapshot(threeCorners), [])).freshLifeLaps.medium).toEqual(insufficient);
      // all four known: the wear rule (28), ahead of ν
      expect(run(mediumView(snapshot({ ...threeCorners, [rrKey]: 2 }))).freshLifeLaps.medium).toMatchObject({ known: true, value: 28 });
    });
  });

  describe('the set`s overrides of the limits (override-only priors keys)', () => {
    it('tyreLife.wearLimitPct replaces the config`s wear limit: the laps to it and the fresh life follow', () => {
      // config 60, the set 80: from 10 % at 2 %/lap, 35 laps; fresh soft at 2.5 %/lap worst, 32 laps
      const view = situatedView({
        cars: [carWithWear(10, { age: 5 })],
        history: { laps: chain([2, 2, 2, 2, 2]) },
        config: { [TYRE_LIFE_CONFIG.key]: { wearLimitPct: 60 } },
        outputs: upstream(),
        priors: snapshot({ 'tyreLife.wearLimitPct': 80, ...wearPriors('soft', { fl: 2, fr: 2.5, rl: 2, rr: 2 }) }),
      });
      const out = run(view);
      expect(out.limitPct).toBe(80);
      expect(out.corners.fl.lapsToLimit).toMatchObject({ known: true, value: 35 });
      expect(out.freshLifeLaps.soft).toMatchObject({ known: true, value: 32 });
    });

    it('tyreLife.ageLossLimitMs replaces the config`s loss limit: ν 100, limit 3000, age 12 → 18 laps; fresh life 30', () => {
      const rival = realismHidden(carState({ id: carId(1), tyres: { age: 12, actualCompound: 'C3', visualCompound: 'soft' } }));
      const view = situatedView({
        cars: [carWithWear(6, { age: 3 }), rival],
        history: { laps: chain([2, 2, 2]) },
        outputs: upstream({ [carId(1)]: [degStint({ basis: 'age', fuelCorrected: false })] }),
        priors: snapshot({ 'tyreLife.ageLossLimitMs': 3000 }),
      });
      const out = calc.compute(view)[carId(1)]!;
      expect(out.ageLossLimitMs).toBe(3000);
      expect(out.lapsToLimit).toMatchObject({ known: true, value: 18 });
      expect(out.freshLifeLaps.soft).toMatchObject({ known: true, value: 30 });
    });

    it('a set that does not override a limit (its entry unknown) leaves the config`s', () => {
      const unset: EngineView['priors'] = known(
        {
          fingerprint: 'fp-empty',
          setId: 'empty',
          setName: 'Empty',
          sources: 0,
          entries: { 'tyreLife.wearLimitPct': unknown('notApplicable'), 'tyreLife.ageLossLimitMs': unknown('notApplicable') },
        },
        0,
      );
      const view = situatedView({
        cars: [carWithWear(10, { age: 5 })],
        history: { laps: chain([2, 2, 2, 2, 2]) },
        config: { [TYRE_LIFE_CONFIG.key]: { wearLimitPct: 80, ageLossLimitMs: 2500 } },
        outputs: upstream(),
        priors: unset,
      });
      const out = run(view);
      expect(out.limitPct).toBe(80);
      expect(out.ageLossLimitMs).toBe(2500);
      expect(out.corners.fl.lapsToLimit).toMatchObject({ known: true, value: 35 });
    });
  });
});
