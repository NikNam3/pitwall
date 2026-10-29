import { carId, known, unknown, type Corners, type LapRecord, type Percent, type StintRecord, type TyreSet } from '@pitwall/domain';
import type { EngineView } from '@pitwall/engine';
import { describe, expect, it } from 'vitest';
import { PER_LAP_RATE_CONFIG } from '../../src/per-lap-rate/index.ts';
import { TYRE_WEAR, TYRE_WEAR_CONFIG } from '../../src/tyre-wear/index.ts';
import { tyreWearCalculator } from '../../src/tyre-wear/calculator.ts';
import { carState, engineView, lap, realismHidden } from '../../../../test-support/builders/index.ts';
import { engineShaped } from '../engine-shaped.ts';

const stint = (over: Partial<StintRecord> & Pick<StintRecord, 'firstLap' | 'lastLap'>): StintRecord => ({
  carId: carId(0),
  actualCompound: 'C3',
  visualCompound: 'soft',
  tyreAgeAtFitting: 0,
  ...over,
});

const everyCorner = <T>(make: () => T): Corners<T> => ({ fl: make(), fr: make(), rl: make(), rr: make() });

/** A lap of car 0 whose lap-end wear is `wear` on every corner (or per corner); `completedAt` is `n * 90 s`. */
const wornLap = (n: number, wear: number | Corners<number>, over: Partial<LapRecord> = {}): LapRecord => {
  const at = n * 90_000;
  const w = typeof wear === 'number' ? { fl: wear, fr: wear, rl: wear, rr: wear } : wear;
  return lap({
    lapNumber: n,
    wearAtEndPct: { fl: known(w.fl, at), fr: known(w.fr, at), rl: known(w.rl, at), rr: known(w.rr, at) },
    ...over,
  });
};

/** Car 0 with live wear `now` on every corner. */
const carWithWear = (now: number) =>
  carState({
    tyres: {
      corners: everyCorner(() => ({ wearPct: known(now as Percent, 0) })),
    },
  });

const viewOf = (laps: LapRecord[], now: number, stints: StintRecord[] = [], config: EngineView['config'] = {}): EngineView =>
  engineView({ cars: [carWithWear(now)], history: { laps, stints }, config });

const run = (view: EngineView) => tyreWearCalculator.compute(view)[carId(0)]!;

describe('tyre-wear calculator', () => {
  it('is the quick calculator `tyre-wear` at 4 Hz over laps, stints and tyres', () => {
    expect(tyreWearCalculator.id).toBe(TYRE_WEAR);
    expect(tyreWearCalculator.kind).toBe('quick');
    expect(tyreWearCalculator.cadence).toEqual({ hz: 4 });
    expect(tyreWearCalculator.reads).toEqual(expect.arrayContaining(['laps', 'stints', 'tyres']));
  });

  it('wear 0, 2, 4, 6, 8 % at lap ends gives 2 %/lap and laps to the 70 % limit 31', () => {
    const laps = [0, 2, 4, 6, 8].map((w, i) => wornLap(i + 1, w));
    const out = run(viewOf(laps, 8));
    for (const corner of ['fl', 'fr', 'rl', 'rr'] as const) {
      expect(out.corners[corner].wearPct).toEqual({ known: true, value: 8, at: 0 });
      // the rate and the laps to the limit are as of the newest lap used
      expect(out.corners[corner].ratePctPerLap).toEqual({ known: true, value: 2, at: laps[4]!.completedAt });
      expect(out.corners[corner].lapsToLimit).toEqual({ known: true, value: 31, at: laps[4]!.completedAt });
    }
    expect(out.limitPct).toBe(70);
  });

  it('each corner has its own rate', () => {
    const laps = [0, 1, 2, 3].map((i) => wornLap(i + 1, { fl: i * 2, fr: i * 3, rl: i, rr: i * 4 }));
    const { corners } = run(viewOf(laps, 6));
    expect(corners.fl.ratePctPerLap).toMatchObject({ known: true, value: 2 });
    expect(corners.fr.ratePctPerLap).toMatchObject({ known: true, value: 3 });
    expect(corners.rl.ratePctPerLap).toMatchObject({ known: true, value: 1 });
    expect(corners.rr.ratePctPerLap).toMatchObject({ known: true, value: 4 });
  });

  it('warnLaps is the alarms config default (3)', () => {
    const laps = [0, 2, 4, 6, 8].map((w, i) => wornLap(i + 1, w));
    expect(run(viewOf(laps, 8)).warnLaps).toBe(3);
  });

  it('warnLaps follows the alarms config override', () => {
    const laps = [0, 2, 4, 6, 8].map((w, i) => wornLap(i + 1, w));
    const out = run(viewOf(laps, 8, [], { alarms: { wearLapsWarning: 5 } }));
    expect(out.warnLaps).toBe(5);
  });

  it('the limit comes from the config', () => {
    const laps = [0, 2, 4, 6, 8].map((w, i) => wornLap(i + 1, w));
    const out = run(viewOf(laps, 8, [], { [TYRE_WEAR_CONFIG.key]: { limitPct: 80 } }));
    expect(out.limitPct).toBe(80);
    expect(out.corners.fl.lapsToLimit).toMatchObject({ known: true, value: 36 });
  });

  it('the minimum of samples comes from the per-lap-rate config', () => {
    const laps = [wornLap(1, 0), wornLap(2, 2)];
    expect(run(viewOf(laps, 2)).corners.fl.ratePctPerLap).toEqual({ known: false, reason: 'insufficientData' });
    const lenient = viewOf(laps, 2, [], { [PER_LAP_RATE_CONFIG.key]: { minSamples: 2 } });
    expect(run(lenient).corners.fl.ratePctPerLap).toMatchObject({ known: true, value: 2 });
  });

  it('the rate uses only the current stint', () => {
    // stop at the end of lap 4 (in lap 4, out lap 5): the new set wears 2 %/lap, the old one wore 3 %/lap
    const laps = [
      wornLap(1, 0),
      wornLap(2, 3),
      wornLap(3, 6),
      wornLap(4, 9, { inLap: true }),
      wornLap(5, 1, { outLap: true }),
      wornLap(6, 2),
      wornLap(7, 4),
      wornLap(8, 6),
    ];
    const closed = [stint({ firstLap: 1, lastLap: 4 })]; // the open stint (lap 5 on) is not a record yet
    const out = run(viewOf(laps, 6, closed));
    expect(out.corners.fl.ratePctPerLap).toMatchObject({ known: true, value: 2 });
    expect(out.corners.fl.lapsToLimit).toMatchObject({ known: true, value: 32 });
  });

  it('right after a stop the rate is insufficientData however long the previous stint was', () => {
    const laps = [
      ...[0, 3, 6, 9, 12].map((w, i) => wornLap(i + 1, w, i === 4 ? { inLap: true } : {})),
      wornLap(6, 1, { outLap: true }),
      wornLap(7, 2),
      wornLap(8, 4),
    ];
    const out = run(viewOf(laps, 4, [stint({ firstLap: 1, lastLap: 5 })]));
    expect(out.corners.fl.ratePctPerLap).toEqual({ known: false, reason: 'insufficientData' });
    expect(out.corners.fl.lapsToLimit).toEqual({ known: false, reason: 'insufficientData' });
    expect(out.corners.fl.wearPct).toMatchObject({ known: true, value: 4 });
  });

  it('a stint record that ends on the newest lap (the session ended) is the current stint', () => {
    const laps = [wornLap(1, 9), wornLap(2, 12), wornLap(3, 0), wornLap(4, 2), wornLap(5, 4), wornLap(6, 6)];
    const stints = [stint({ firstLap: 1, lastLap: 2 }), stint({ firstLap: 3, lastLap: 6 })];
    expect(run(viewOf(laps, 6, stints)).corners.fl.ratePctPerLap).toMatchObject({ known: true, value: 2 });
  });

  describe('on engine-shaped history: every lap provisional then confirmed, no record for the open stint', () => {
    it('the rate uses only the open stint', () => {
      const laps = engineShaped([
        wornLap(1, 0),
        wornLap(2, 3),
        wornLap(3, 6),
        wornLap(4, 9, { inLap: true }),
        wornLap(5, 1, { outLap: true }),
        wornLap(6, 2),
        wornLap(7, 4),
        wornLap(8, 6),
      ]);
      const out = run(viewOf(laps, 6, [stint({ firstLap: 1, lastLap: 4 })]));
      expect(out.corners.fl.ratePctPerLap).toMatchObject({ known: true, value: 2 });
    });

    it('a lap counts once: two laps, each written twice, are below minSamples (3)', () => {
      const out = run(viewOf(engineShaped([wornLap(1, 0), wornLap(2, 2)]), 2));
      expect(out.corners.fl.ratePctPerLap).toEqual({ known: false, reason: 'insufficientData' });
    });
  });

  it('without a stint record the history counts as one stint', () => {
    const laps = [0, 2, 4].map((w, i) => wornLap(i + 1, w));
    expect(run(viewOf(laps, 4)).corners.fl.ratePctPerLap).toMatchObject({ known: true, value: 2 });
  });

  it('an SC lap is not a rate sample', () => {
    const laps = [
      wornLap(1, 0),
      wornLap(2, 2),
      wornLap(3, 40, { scShare: 0.5 }),
      wornLap(4, 6, { vscShare: 0.2 }),
      wornLap(5, 8),
      wornLap(6, 10),
      wornLap(7, 12),
    ];
    // usable laps 1, 2, 5, 6, 7 (the window of 5): wear 0, 2, 8, 10, 12 over laps 1, 2, 5, 6, 7
    const rate = run(viewOf(laps, 12)).corners.fl.ratePctPerLap;
    expect(rate).toMatchObject({ known: true });
    // the 40 % lap would pull a slope-2 series far off
    expect(rate.known && rate.value).toBeLessThan(2.5);
  });

  it('an in lap and an out lap are not rate samples', () => {
    const laps = [wornLap(1, 0), wornLap(2, 2), wornLap(3, 4), wornLap(4, 50, { inLap: true }), wornLap(5, 60, { outLap: true })];
    expect(run(viewOf(laps, 4)).corners.fl.ratePctPerLap).toMatchObject({ known: true, value: 2 });
  });

  it('fewer than 3 laps in the stint: rate insufficientData', () => {
    const out = run(viewOf([wornLap(1, 0), wornLap(2, 2)], 2));
    expect(out.corners.fl.ratePctPerLap).toEqual({ known: false, reason: 'insufficientData' });
    expect(out.corners.fl.lapsToLimit).toEqual({ known: false, reason: 'insufficientData' });
    expect(out.corners.fl.wearPct).toMatchObject({ known: true, value: 2 });
  });

  it('wear that does not grow has no laps to the limit', () => {
    const laps = [5, 5, 5].map((w, i) => wornLap(i + 1, w));
    const { fl } = run(viewOf(laps, 5)).corners;
    expect(fl.ratePctPerLap).toMatchObject({ known: true, value: 0 });
    expect(fl.lapsToLimit).toMatchObject({ known: false });
  });

  it('a lap record with an unknown wear is no sample for that corner only', () => {
    const laps = [wornLap(1, 0), wornLap(2, 2, { wearAtEndPct: { ...wornLap(2, 2).wearAtEndPct, fl: unknown('notReceived') } }), wornLap(3, 4), wornLap(4, 6)];
    const { corners } = run(viewOf(laps, 6));
    expect(corners.fl.ratePctPerLap).toMatchObject({ known: true, value: 2 }); // laps 1, 3, 4
    expect(corners.fr.ratePctPerLap).toMatchObject({ known: true, value: 2 });
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
    const view = engineView({ cars: [car], history: { laps: [wornLap(1, 0)] } });
    expect(run(view).gameLifeSpanLaps).toEqual({ known: true, value: 22, at: 1_000 });
  });

  it('gameLifeSpanLaps is unknown without a fitted set in the list', () => {
    // the builder's car has `sets` known with an empty list
    const view = engineView({ cars: [carState()], history: { laps: [wornLap(1, 0)] } });
    expect(run(view).gameLifeSpanLaps).toEqual({ known: false, reason: 'notReceived' });
  });

  it('realism: a rival`s corners are unknown(`realism`)', () => {
    const hidden = unknown('realism');
    const rivalLaps = [1, 2, 3, 4].map((n) =>
      wornLap(n, 0, { carId: carId(1), wearAtEndPct: everyCorner(() => hidden) }),
    );
    const view = engineView({
      cars: [carWithWear(6), realismHidden(carState({ id: carId(1) }))],
      history: { laps: [...[0, 2, 4, 6].map((w, i) => wornLap(i + 1, w)), ...rivalLaps] },
    });
    const out = tyreWearCalculator.compute(view);
    for (const corner of ['fl', 'fr', 'rl', 'rr'] as const) {
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
    const second = carState({ id: carId(1), tyres: { corners: everyCorner(() => ({ wearPct: known(9 as Percent, 0) })) } });
    const laps = [
      ...[0, 2, 4].map((w, i) => wornLap(i + 1, w)),
      ...[0, 3, 6].map((w, i) => wornLap(i + 1, w, { carId: carId(1) })),
    ];
    const out = tyreWearCalculator.compute(engineView({ cars: [carWithWear(4), second], history: { laps } }));
    expect(out[carId(0)]!.corners.fl.ratePctPerLap).toMatchObject({ value: 2 });
    expect(out[carId(1)]!.corners.fl.ratePctPerLap).toMatchObject({ value: 3 });
    expect(out[carId(2)]).toBeUndefined();
  });
});
