import { carId, known, unknown, type LapRecord, type StintRecord } from '@pitwall/domain';
import type { EngineView } from '@pitwall/engine';
import { describe, expect, it } from 'vitest';
import { LAP_CLASSES_CONFIG } from '../../src/lap-classes/index.ts';
import { PER_LAP_RATE_CONFIG } from '../../src/per-lap-rate/index.ts';
import { ERS, ERS_CONFIG } from '../../src/ers/index.ts';
import { ersCalculator } from '../../src/ers/calculator.ts';
import { carState, engineView, lap, realismHidden } from '../../../../test-support/builders/index.ts';
import { engineShaped } from '../engine-shaped.ts';

const MJ = 1_000_000;

const stint = (over: Partial<StintRecord> & Pick<StintRecord, 'firstLap' | 'lastLap'>): StintRecord => ({
  carId: carId(0),
  actualCompound: 'C3',
  visualCompound: 'soft',
  tyreAgeAtFitting: 0,
  ...over,
});

/** A lap of car 0 whose store goes from `startMJ` to `endMJ`; `completedAt` is `n * 90 s`. */
const storedLap = (n: number, startMJ: number, endMJ: number, over: Partial<LapRecord> = {}): LapRecord =>
  lap({ lapNumber: n, ersStoreAtStartJ: known(startMJ * MJ, n * 90_000), ersStoreAtEndJ: known(endMJ * MJ, n * 90_000), ...over });

/** Consecutive laps from `from` on with the store at their lines `levelsMJ`: lap i runs from level i to level i + 1. */
const laps = (levelsMJ: number[], from = 1): LapRecord[] => levelsMJ.slice(1).map((end, i) => storedLap(from + i, levelsMJ[i]!, end));

type Live = { storeMJ?: number; deployedMJ?: number; mguk?: number; mguh?: number; mgukW?: number; mode?: 'none' | 'medium' | 'hotlap' | 'overtake' };

/** Car 0 with live ERS values (known at session time 7 000) and MGU-K power (known at 8 000). */
const carWith = ({ storeMJ = 4, deployedMJ = 0, mguk = 0, mguh = 0, mgukW = 0, mode = 'medium' }: Live = {}) =>
  carState({
    energy: {
      ers: known({ storeJ: storeMJ * MJ, mode, harvestedMgukJ: mguk, harvestedMguhJ: mguh, deployedJ: deployedMJ * MJ }, 7_000),
      power: known({ iceW: 400_000, mgukW }, 8_000),
    },
  });

const viewOf = (history: LapRecord[], live: Live = {}, stints: StintRecord[] = [], config: EngineView['config'] = {}): EngineView =>
  engineView({ cars: [carWith(live)], history: { laps: history, stints }, config });

const run = (view: EngineView) => ersCalculator.compute(view)[carId(0)]!;
const trendOf = (view: EngineView): number => {
  const t = run(view).storeTrendJPerLap;
  if (!t.known) throw new Error(`expected a known trend, got ${t.reason}`);
  return t.value;
};
const insufficient = { known: false, reason: 'insufficientData' };

describe('ers calculator', () => {
  it('is the quick calculator `ers` at 4 Hz over laps and energy', () => {
    expect(ersCalculator.id).toBe(ERS);
    expect(ersCalculator.kind).toBe('quick');
    expect(ersCalculator.cadence).toEqual({ hz: 4 });
    expect(ersCalculator.reads).toEqual(expect.arrayContaining(['laps', 'stints', 'energy', 'session']));
  });

  it('store 4.0, 3.6, 3.2 MJ at the lines (two laps of -0.4 MJ): trend -0.4 MJ/lap, as of the newest lap', () => {
    const history = laps([4, 3.6, 3.2]);
    const trend = run(viewOf(history, { storeMJ: 3.2 })).storeTrendJPerLap;
    expect(trend).toMatchObject({ known: true, at: history[1]!.completedAt });
    expect(trend.known && trend.value).toBeCloseTo(-0.4 * MJ, 3);
  });

  it('the trend is the median of the counted laps` own store changes', () => {
    // changes -0.4, -0.2, -0.6, -0.4, -0.3 MJ: sorted -0.6, -0.4, -0.4, -0.3, -0.2
    expect(trendOf(viewOf(laps([4, 3.6, 3.4, 2.8, 2.4, 2.1]), { storeMJ: 2.1 }))).toBeCloseTo(-0.4 * MJ, 3);
  });

  it('a lap`s change is its own end minus its own start: a jump between laps is in no lap', () => {
    // lap 2 starts 1 MJ above lap 1's end: both laps lose 0.4 MJ
    const history = [storedLap(1, 4, 3.6), storedLap(2, 4.6, 4.2)];
    expect(trendOf(viewOf(history, { storeMJ: 4.2 }))).toBeCloseTo(-0.4 * MJ, 3);
  });

  it('one counted lap gives no trend; two do', () => {
    expect(run(viewOf(laps([4, 3.6]), { storeMJ: 3.6 })).storeTrendJPerLap).toEqual(insufficient);
    expect(trendOf(viewOf(laps([4, 3.6, 3.4]), { storeMJ: 3.4 }))).toBeCloseTo(-0.3 * MJ, 3);
  });

  describe('attack (ready at or above the level; while rising below it, the whole laps to it)', () => {
    it('is ready at and above the level, rising or falling, as of the ERS reading', () => {
      expect(run(viewOf(laps([4, 3.6, 3.2]), { storeMJ: 3.2 })).attack).toEqual({ known: true, value: { ready: true }, at: 7_000 });
      expect(run(viewOf(laps([3.2, 2.8, 2.4]), { storeMJ: 2.4 })).attack).toEqual({ known: true, value: { ready: true }, at: 7_000 });
      expect(run(viewOf(laps([1.6, 2.0, 2.6]), { storeMJ: 2.6 })).attack).toEqual({ known: true, value: { ready: true }, at: 7_000 });
    });

    it('is ready above the level even without a trend', () => {
      expect(run(viewOf([], { storeMJ: 3 })).attack).toEqual({ known: true, value: { ready: true }, at: 7_000 });
    });

    it('rising below the level: the laps to it rounded up to whole laps, as of the trend', () => {
      // 1 MJ to go at 0.4 MJ/lap is 2.5 laps
      const history = laps([0.6, 1.0, 1.4]);
      expect(run(viewOf(history, { storeMJ: 1.4 })).attack).toEqual({ known: true, value: { ready: false, inLaps: 3 }, at: history[1]!.completedAt });
      // 1.2 MJ to go at 0.4 MJ/lap is 3 laps
      expect(run(viewOf(laps([0.4, 0.8, 1.2]), { storeMJ: 1.2 })).attack).toMatchObject({ known: true, value: { ready: false, inLaps: 3 } });
    });

    it('rising just below the level: at least 1 lap', () => {
      // 0.1 MJ to go at 0.4 MJ/lap is a quarter lap
      expect(run(viewOf(laps([1.5, 1.9, 2.3]), { storeMJ: 2.3 })).attack).toMatchObject({ known: true, value: { ready: false, inLaps: 1 } });
    });

    it('falling below the level: notApplicable (no attack line)', () => {
      expect(run(viewOf(laps([2.8, 2.4, 2.0]), { storeMJ: 2 })).attack).toEqual({ known: false, reason: 'notApplicable' });
    });

    it('flat below the level: notApplicable (no attack line)', () => {
      expect(run(viewOf(laps([2, 2, 2]), { storeMJ: 2 })).attack).toEqual({ known: false, reason: 'notApplicable' });
    });

    it('below the level without a trend: insufficientData', () => {
      expect(run(viewOf(laps([0.6, 1]), { storeMJ: 1 })).attack).toEqual(insufficient);
    });
  });

  it('deployedThisLapJ is the car state`s deployedJ; the limit is 4 MJ', () => {
    const out = run(viewOf([], { deployedMJ: 1.5 }));
    expect(out.deployedThisLapJ).toEqual({ known: true, value: 1.5 * MJ, at: 7_000 });
    expect(out.deployLimitJ).toBe(4 * MJ);
    expect(out.capacityJ).toBe(4 * MJ);
  });

  it('harvestedThisLapJ is the MGU-K and MGU-H harvest of this lap added up', () => {
    const out = run(viewOf([], { mguk: 600_000, mguh: 250_000 }));
    expect(out.harvestedThisLapJ).toEqual({ known: true, value: 850_000, at: 7_000 });
  });

  it('storeJ and mode are the car state`s, known at the time of the ERS reading', () => {
    const out = run(viewOf([], { storeMJ: 3.3, mode: 'overtake' }));
    expect(out.storeJ).toEqual({ known: true, value: 3.3 * MJ, at: 7_000 });
    expect(out.mode).toEqual({ known: true, value: 'overtake', at: 7_000 });
  });

  it('limit, capacity and attack level come from the config', () => {
    const config = { [ERS_CONFIG.key]: { deployLimitJ: 3 * MJ, capacityJ: 5 * MJ, attackLevelJ: 3 * MJ } };
    const out = run(viewOf(laps([1, 1.5, 2]), { storeMJ: 2 }, [], config));
    expect(out.deployLimitJ).toBe(3 * MJ);
    expect(out.capacityJ).toBe(5 * MJ);
    expect(out.attackLevelJ).toBe(3 * MJ);
    expect(out.attack).toMatchObject({ known: true, value: { ready: false, inLaps: 2 } }); // 1 MJ at 0.5 MJ/lap
  });

  describe('flow (positive MGU-K power is deploying, negative is harvesting, zero is idle)', () => {
    it('deploying', () => {
      expect(run(viewOf([], { mgukW: 120_000 })).flow).toEqual({ known: true, value: 'deploying', at: 8_000 });
    });
    it('harvesting', () => {
      expect(run(viewOf([], { mgukW: -80_000 })).flow).toEqual({ known: true, value: 'harvesting', at: 8_000 });
    });
    it('idle', () => {
      expect(run(viewOf([], { mgukW: 0 })).flow).toEqual({ known: true, value: 'idle', at: 8_000 });
    });
    it('unknown power: the flow is unknown with the same reason', () => {
      const car = carState({ energy: { power: unknown('notReceived') } });
      const out = ersCalculator.compute(engineView({ cars: [car] }))[carId(0)]!;
      expect(out.flow).toEqual({ known: false, reason: 'notReceived' });
    });
  });

  it('the minimum of samples comes from the per-lap-rate config', () => {
    const strict = viewOf(laps([4, 3.6, 3.2]), { storeMJ: 3.2 }, [], { [PER_LAP_RATE_CONFIG.key]: { minSamples: 3 } });
    expect(run(strict).storeTrendJPerLap).toEqual(insufficient);
  });

  it('only the last 5 counted laps count (the window)', () => {
    // changes +0.1 x 5, then -0.3 x 3: the median of all 8 is +0.1, of the last 5 it is -0.3
    const history = laps([1, 1.1, 1.2, 1.3, 1.4, 1.5, 1.2, 0.9, 0.6]);
    expect(trendOf(viewOf(history, { storeMJ: 0.6 }))).toBeCloseTo(-0.3 * MJ, 3);
  });

  it('one outlier lap among 5 leaves the trend at the other laps`', () => {
    // changes -0.4, -0.4, +1.6 (a lift-and-coast lap), -0.4, -0.4
    expect(trendOf(viewOf(laps([4, 3.6, 3.2, 4.8, 4.4, 4]), { storeMJ: 4 }))).toBeCloseTo(-0.4 * MJ, 3);
  });

  it('a stop keeps the trend samples: the store is not tied to the tyre set', () => {
    // laps 1-2 lose 0.4 MJ, stop at the end of lap 3 (in lap 3, out lap 4), laps 5-6 gain 0.2 MJ: median of -0.4, -0.4, 0.2, 0.2
    const history = [
      ...laps([4, 3.6, 3.2]),
      storedLap(3, 3.2, 3.6, { inLap: true }),
      storedLap(4, 3.6, 4, { outLap: true }),
      ...laps([2, 2.2, 2.4], 5),
    ];
    expect(trendOf(viewOf(history, { storeMJ: 2.4 }, [stint({ firstLap: 1, lastLap: 3 })]))).toBeCloseTo(-0.1 * MJ, 3);
  });

  it('in laps, out laps and SC laps are not trend samples', () => {
    const history = [
      ...laps([4, 3.6, 3.2]),
      storedLap(3, 3.2, 0.5, { scShare: 0.5 }),
      storedLap(4, 0.5, 0.2, { vscShare: 0.2 }),
      storedLap(5, 0.2, 4, { outLap: true }),
      storedLap(6, 4, 4, { inLap: true }),
    ];
    expect(trendOf(viewOf(history, { storeMJ: 3.2 }))).toBeCloseTo(-0.4 * MJ, 3);
  });

  it('a lap with 2 s or more under SC or VSC is no sample, and its harvest does not leak into the trend', () => {
    // lap 1 green -0.4, laps 2-3 under SC +0.2 each, laps 4-5 green -0.4
    const history = [
      storedLap(1, 4, 3.6),
      storedLap(2, 3.6, 3.8, { scShare: 1 }),
      storedLap(3, 3.8, 4, { scShare: 0.6, vscShare: 0.4 }),
      storedLap(4, 4, 3.6),
      storedLap(5, 3.6, 3.2),
    ];
    expect(trendOf(viewOf(history, { storeMJ: 3.2 }))).toBeCloseTo(-0.4 * MJ, 3);
  });

  it('a lap with under 2 s under SC (the flag lag at a restart) is a sample; the limit comes from the lap-classes config', () => {
    // lap 2 is green but for 0.9 s: scShare 0.01 of the builder's 90 s lap
    const history = [storedLap(1, 4, 3.6), storedLap(2, 3.6, 3.2, { scShare: 0.01 })];
    expect(trendOf(viewOf(history, { storeMJ: 3.2 }))).toBeCloseTo(-0.4 * MJ, 3);
    const strict = viewOf(history, { storeMJ: 3.2 }, [], { [LAP_CLASSES_CONFIG.key]: { maxNeutralisedMs: 500 } });
    expect(run(strict).storeTrendJPerLap).toEqual(insufficient);
  });

  it('a lap whose start or end store is unknown is no sample', () => {
    const joined = storedLap(1, 0, 3.6, { ersStoreAtStartJ: unknown('notReceived') });
    expect(run(viewOf([joined, storedLap(2, 3.6, 3.2)], { storeMJ: 3.2 })).storeTrendJPerLap).toEqual(insufficient);
    const noEnd = storedLap(2, 3.6, 0, { ersStoreAtEndJ: unknown('notReceived') });
    expect(run(viewOf([storedLap(1, 4, 3.6), noEnd], { storeMJ: 3.2 })).storeTrendJPerLap).toEqual(insufficient);
    expect(trendOf(viewOf([storedLap(1, 4, 3.6), noEnd, storedLap(3, 3.2, 2.8)], { storeMJ: 2.8 }))).toBeCloseTo(-0.4 * MJ, 3);
  });

  describe('on engine-shaped history: every lap provisional then confirmed, no record for the open stint', () => {
    it('a stop keeps the trend samples', () => {
      const history = engineShaped([
        ...laps([4, 3.6, 3.2]),
        storedLap(3, 3.2, 3.6, { inLap: true }),
        storedLap(4, 3.6, 4, { outLap: true }),
        ...laps([2, 2.2, 2.4], 5),
      ]);
      expect(trendOf(viewOf(history, { storeMJ: 2.4 }, [stint({ firstLap: 1, lastLap: 3 })]))).toBeCloseTo(-0.1 * MJ, 3);
    });

    it('a lap counts once: one lap, written twice, is below minSamples (2)', () => {
      expect(run(viewOf(engineShaped(laps([1.2, 1.6])), { storeMJ: 1.6 })).storeTrendJPerLap).toEqual(insufficient);
    });

    it('the confirmed record wins over the provisional one', () => {
      const history = engineShaped(laps([4, 3.6, 3.2]), { ersStoreAtEndJ: known(0, 1) });
      expect(trendOf(viewOf(history, { storeMJ: 3.2 }))).toBeCloseTo(-0.4 * MJ, 3);
    });
  });

  it('realism: a rival`s store is unknown(`realism`)', () => {
    const hidden = unknown('realism');
    const rivalLaps = [1, 2, 3, 4].map((n) =>
      storedLap(n, 0, 0, { carId: carId(1), ersStoreAtStartJ: hidden, ersStoreAtEndJ: hidden, ersDeployedJ: hidden, ersHarvestedJ: hidden }),
    );
    const view = engineView({
      cars: [carWith({ storeMJ: 3.2 }), realismHidden(carState({ id: carId(1) }))],
      history: { laps: [...laps([4, 3.6, 3.2]), ...rivalLaps] },
    });
    const out = ersCalculator.compute(view);
    const rival = out[carId(1)]!;
    for (const field of ['storeJ', 'deployedThisLapJ', 'harvestedThisLapJ', 'storeTrendJPerLap', 'attack', 'mode', 'flow'] as const) {
      expect(rival[field]).toEqual(hidden);
    }
    // constants stay known
    expect(rival.capacityJ).toBe(4 * MJ);
    expect(rival.deployLimitJ).toBe(4 * MJ);
    expect(rival.attackLevelJ).toBe(2_400_000);
    // our own car is unaffected
    expect(out[carId(0)]!.storeTrendJPerLap).toMatchObject({ known: true });
  });

  it('keeps cars apart and gives no entry to an inactive slot', () => {
    const second = carWith({ storeMJ: 2 });
    second.id = carId(1);
    const history = [...laps([4, 3.6, 3.2]), ...laps([1, 1.5, 2]).map((l) => ({ ...l, carId: carId(1) }))];
    const out = ersCalculator.compute(engineView({ cars: [carWith({ storeMJ: 3.2 }), second], history: { laps: history } }));
    const a = out[carId(0)]!.storeTrendJPerLap;
    const b = out[carId(1)]!.storeTrendJPerLap;
    expect(a.known && a.value).toBeCloseTo(-0.4 * MJ, 3);
    expect(b.known && b.value).toBeCloseTo(0.5 * MJ, 3);
    expect(out[carId(2)]).toBeUndefined();
  });

  it('is stateless: the same view gives the same output', () => {
    const view = viewOf(laps([4, 3.6, 3.2]), { storeMJ: 3.2 });
    expect(ersCalculator.compute(view)).toEqual(ersCalculator.compute(view));
  });
});
