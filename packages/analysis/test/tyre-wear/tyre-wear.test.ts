import { carId, known, unknown, type ActualCompound, type Corners, type LapRecord, type Percent, type StintRecord, type TyreSet, type VisualCompound } from '@pitwall/domain';
import type { EngineView } from '@pitwall/engine';
import { describe, expect, it } from 'vitest';
import { LAP_CLASSES_CONFIG } from '../../src/lap-classes/index.ts';
import { PER_LAP_RATE_CONFIG } from '../../src/per-lap-rate/index.ts';
import { TYRE_WEAR, TYRE_WEAR_CONFIG } from '../../src/tyre-wear/index.ts';
import { tyreWearCalculator } from '../../src/tyre-wear/calculator.ts';
import { carState, engineView, lap, realismHidden } from '../../../../test-support/builders/index.ts';
import { engineShaped } from '../engine-shaped.ts';

const CORNERS = ['fl', 'fr', 'rl', 'rr'] as const;

const stint = (over: Partial<StintRecord> & Pick<StintRecord, 'firstLap' | 'lastLap'>): StintRecord => ({
  carId: carId(0),
  actualCompound: 'C3',
  visualCompound: 'soft',
  tyreAgeAtFitting: 0,
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

/** Car 0 with wear `now`, on a set as old as its newest lap (fitted new at the start of lap 1), over `laps`. */
const viewOf = (laps: LapRecord[], now: number, stints: StintRecord[] = [], config: EngineView['config'] = {}): EngineView => {
  const age = Math.max(0, ...laps.filter((l) => l.carId === carId(0)).map((l) => l.lapNumber));
  return engineView({ cars: [carWithWear(now, { age })], history: { laps, stints }, config });
};

const run = (view: EngineView) => tyreWearCalculator.compute(view)[carId(0)]!;
const insufficient = { known: false, reason: 'insufficientData' };

describe('tyre-wear calculator', () => {
  it('is the quick calculator `tyre-wear` at 4 Hz over laps, stints and tyres', () => {
    expect(tyreWearCalculator.id).toBe(TYRE_WEAR);
    expect(tyreWearCalculator.kind).toBe('quick');
    expect(tyreWearCalculator.cadence).toEqual({ hz: 4 });
    expect(tyreWearCalculator.reads).toEqual(expect.arrayContaining(['laps', 'stints', 'tyres']));
  });

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

  it('warnLaps is the alarms config default (3)', () => {
    expect(run(viewOf(chain([2, 2, 2]), 6)).warnLaps).toBe(3);
  });

  it('warnLaps follows the alarms config override', () => {
    expect(run(viewOf(chain([2, 2, 2]), 6, [], { alarms: { wearLapsWarning: 5 } })).warnLaps).toBe(5);
  });

  it('the limit comes from the config', () => {
    const out = run(viewOf(chain([2, 2, 2, 2, 2]), 10, [], { [TYRE_WEAR_CONFIG.key]: { limitPct: 80 } }));
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
    const view = engineView({ cars: [carWithWear(7, { age: 4 })], history: { laps, stints: closed } });
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
      run(engineView({ cars: [carWithWear(0, set)], history: { laps, stints } }));

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
    const view = engineView({ cars: [car], history: { laps: chain([1]) } });
    expect(run(view).gameLifeSpanLaps).toEqual({ known: true, value: 22, at: 1_000 });
  });

  it('gameLifeSpanLaps is unknown without a fitted set in the list', () => {
    // the builder's car has `sets` known with an empty list
    const view = engineView({ cars: [carState()], history: { laps: chain([1]) } });
    expect(run(view).gameLifeSpanLaps).toEqual({ known: false, reason: 'notReceived' });
  });

  it('realism: a rival`s corners are unknown(`realism`)', () => {
    const hidden = unknown('realism');
    const rivalLaps = [1, 2, 3, 4].map((n) =>
      wornLap(n, 0, 0, { carId: carId(1), wearAtStartPct: everyCorner(() => hidden), wearAtEndPct: everyCorner(() => hidden) }),
    );
    const view = engineView({
      cars: [carWithWear(6, { age: 3 }), realismHidden(carState({ id: carId(1) }))],
      history: { laps: [...chain([2, 2, 2]), ...rivalLaps] },
    });
    const out = tyreWearCalculator.compute(view);
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

  it('keeps cars apart and gives no entry to an inactive slot', () => {
    const second = carState({ id: carId(1), tyres: { age: 2, corners: everyCorner(() => ({ wearPct: known(9 as Percent, 0) })) } });
    const laps = [...chain([2, 2]), ...chain([3, 3], { over: { carId: carId(1) } })];
    const out = tyreWearCalculator.compute(engineView({ cars: [carWithWear(4, { age: 2 }), second], history: { laps } }));
    expect(out[carId(0)]!.corners.fl.ratePctPerLap).toMatchObject({ value: 2 });
    expect(out[carId(1)]!.corners.fl.ratePctPerLap).toMatchObject({ value: 3 });
    expect(out[carId(2)]).toBeUndefined();
  });
});
