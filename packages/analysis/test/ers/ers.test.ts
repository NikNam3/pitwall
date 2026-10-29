import { carId, known, unknown, type LapRecord, type StintRecord } from '@pitwall/domain';
import type { EngineView } from '@pitwall/engine';
import { describe, expect, it } from 'vitest';
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

/** A lap of car 0 whose store at the lap end is `storeMJ`; `completedAt` is `n * 90 s`. */
const storedLap = (n: number, storeMJ: number, over: Partial<LapRecord> = {}): LapRecord =>
  lap({ lapNumber: n, ersStoreAtEndJ: known(storeMJ * MJ, n * 90_000), ...over });

const laps = (stores: number[], from = 1): LapRecord[] => stores.map((s, i) => storedLap(from + i, s));

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

describe('ers calculator', () => {
  it('is the quick calculator `ers` at 4 Hz over laps and energy', () => {
    expect(ersCalculator.id).toBe(ERS);
    expect(ersCalculator.kind).toBe('quick');
    expect(ersCalculator.cadence).toEqual({ hz: 4 });
    expect(ersCalculator.reads).toEqual(expect.arrayContaining(['laps', 'energy']));
  });

  it('store 4.0, 3.6, 3.2 MJ at lap ends: trend -0.4 MJ/lap', () => {
    const history = laps([4, 3.6, 3.2]);
    const out = run(viewOf(history, { storeMJ: 3.2 }));
    // the trend is as of the newest lap used
    const trend = out.storeTrendJPerLap;
    expect(trend).toMatchObject({ known: true, at: history[2]!.completedAt });
    expect(trend.known && trend.value).toBeCloseTo(-0.4 * MJ, 3);
  });

  it('store 2.0 MJ rising 0.4 MJ/lap: lapsToAttackLevel 1 (attack level 2.4 MJ)', () => {
    const history = laps([1.2, 1.6, 2.0]);
    const out = run(viewOf(history, { storeMJ: 2 }));
    expect(out.attackLevelJ).toBe(2_400_000);
    expect(out.lapsToAttackLevel).toMatchObject({ known: true, at: history[2]!.completedAt });
    const laps_ = out.lapsToAttackLevel;
    expect(laps_.known && laps_.value).toBeCloseTo(1, 6);
  });

  it('store falling: lapsToAttackLevel notApplicable', () => {
    const out = run(viewOf(laps([2.8, 2.4, 2.0]), { storeMJ: 2 }));
    expect(out.lapsToAttackLevel).toEqual({ known: false, reason: 'notApplicable' });
  });

  it('a store already at or above the attack level has 0 laps to it, falling or not ("attack ready")', () => {
    const above = run(viewOf(laps([4, 3.6, 3.2]), { storeMJ: 3.2 }));
    expect(above.lapsToAttackLevel).toEqual({ known: true, value: 0, at: 7_000 });
    const at = run(viewOf(laps([3.2, 2.8, 2.4]), { storeMJ: 2.4 }));
    expect(at.lapsToAttackLevel).toEqual({ known: true, value: 0, at: 7_000 });
  });

  it('a store above the attack level has 0 laps to it even without a trend', () => {
    const out = run(viewOf(laps([3]), { storeMJ: 3 }));
    expect(out.storeTrendJPerLap).toEqual({ known: false, reason: 'insufficientData' });
    expect(out.lapsToAttackLevel).toEqual({ known: true, value: 0, at: 7_000 });
  });

  it('a store below the level without a trend: insufficientData', () => {
    const out = run(viewOf(laps([1]), { storeMJ: 1 }));
    expect(out.lapsToAttackLevel).toEqual({ known: false, reason: 'insufficientData' });
  });

  describe('attack (ready at or above the level; while rising below it, the whole laps to it)', () => {
    it('is ready at and above the level, rising or falling, as of the ERS reading', () => {
      expect(run(viewOf(laps([4, 3.6, 3.2]), { storeMJ: 3.2 })).attack).toEqual({ known: true, value: { ready: true }, at: 7_000 });
      expect(run(viewOf(laps([3.2, 2.8, 2.4]), { storeMJ: 2.4 })).attack).toEqual({ known: true, value: { ready: true }, at: 7_000 });
      expect(run(viewOf(laps([1.6, 2.0, 2.6]), { storeMJ: 2.6 })).attack).toEqual({ known: true, value: { ready: true }, at: 7_000 });
    });

    it('is ready above the level even without a trend', () => {
      expect(run(viewOf(laps([3]), { storeMJ: 3 })).attack).toEqual({ known: true, value: { ready: true }, at: 7_000 });
    });

    it('rising below the level: the laps to it rounded up to whole laps, as of the trend', () => {
      // 1 MJ to go at 0.4 MJ/lap is 2.5 laps
      const history = laps([0.6, 1.0, 1.4]);
      expect(run(viewOf(history, { storeMJ: 1.4 })).attack).toEqual({ known: true, value: { ready: false, inLaps: 3 }, at: history[2]!.completedAt });
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
      expect(run(viewOf(laps([1]), { storeMJ: 1 })).attack).toEqual({ known: false, reason: 'insufficientData' });
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
    const l = out.lapsToAttackLevel;
    expect(l.known && l.value).toBeCloseTo(2, 6); // 1 MJ at 0.5 MJ/lap
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

  it('the window and minimum of samples come from the per-lap-rate config', () => {
    const history = laps([4, 3.6]);
    expect(run(viewOf(history, { storeMJ: 3.6 })).storeTrendJPerLap).toEqual({ known: false, reason: 'insufficientData' });
    const lenient = viewOf(history, { storeMJ: 3.6 }, [], { [PER_LAP_RATE_CONFIG.key]: { minSamples: 2 } });
    const t = run(lenient).storeTrendJPerLap;
    expect(t.known && t.value).toBeCloseTo(-0.4 * MJ, 3);
  });

  it('a new stint restarts the trend samples', () => {
    // stop at the end of lap 4 (in lap 4, out lap 5): the old stint's store fell, the new one rises 0.4 MJ/lap
    const history = [
      ...laps([4, 3.6, 3.2]),
      storedLap(4, 2.8, { inLap: true }),
      storedLap(5, 4, { outLap: true }),
      ...laps([1, 1.4, 1.8], 6),
    ];
    const out = run(viewOf(history, { storeMJ: 1.8 }, [stint({ firstLap: 1, lastLap: 4 })]));
    const t = out.storeTrendJPerLap;
    expect(t.known && t.value).toBeCloseTo(0.4 * MJ, 3);
    const l = out.lapsToAttackLevel;
    expect(l.known && l.value).toBeCloseTo(1.5, 6);
  });

  it('right after a stop the trend is insufficientData however long the previous stint was', () => {
    const history = [...laps([4, 3.6, 3.2, 2.8, 2.4]), storedLap(6, 4, { outLap: true }), ...laps([3.6, 3.2], 7)];
    const out = run(viewOf(history, { storeMJ: 3.2 }, [stint({ firstLap: 1, lastLap: 5 })]));
    expect(out.storeTrendJPerLap).toEqual({ known: false, reason: 'insufficientData' });
  });

  it('a stint record that ends on the newest lap is the current stint', () => {
    const history = [...laps([4, 3.6, 3.2]), ...laps([1, 1.4, 1.8, 2.2], 4)];
    const stints = [stint({ firstLap: 1, lastLap: 3 }), stint({ firstLap: 4, lastLap: 7 })];
    const t = run(viewOf(history, { storeMJ: 2.2 }, stints)).storeTrendJPerLap;
    expect(t.known && t.value).toBeCloseTo(0.4 * MJ, 3);
  });

  describe('on engine-shaped history: every lap provisional then confirmed, no record for the open stint', () => {
    it('a new stint restarts the trend samples', () => {
      const history = engineShaped([
        ...laps([4, 3.6, 3.2]),
        storedLap(4, 2.8, { inLap: true }),
        storedLap(5, 4, { outLap: true }),
        ...laps([1, 1.4, 1.8], 6),
      ]);
      const t = run(viewOf(history, { storeMJ: 1.8 }, [stint({ firstLap: 1, lastLap: 4 })])).storeTrendJPerLap;
      expect(t.known && t.value).toBeCloseTo(0.4 * MJ, 3);
    });

    it('a lap counts once: two laps, each written twice, are below minSamples (3)', () => {
      const out = run(viewOf(engineShaped(laps([1.2, 1.6])), { storeMJ: 1.6 }));
      expect(out.storeTrendJPerLap).toEqual({ known: false, reason: 'insufficientData' });
    });
  });

  it('without a stint record the history counts as one stint', () => {
    const t = run(viewOf(laps([4, 3.6, 3.2]), { storeMJ: 3.2 })).storeTrendJPerLap;
    expect(t.known && t.value).toBeCloseTo(-0.4 * MJ, 3);
  });

  it('in laps, out laps and SC laps are not trend samples', () => {
    const history = [
      ...laps([4, 3.6, 3.2]),
      storedLap(4, 0.5, { scShare: 0.5 }),
      storedLap(5, 0.2, { vscShare: 0.2 }),
      storedLap(6, 4, { outLap: true }),
      storedLap(7, 4, { inLap: true }),
    ];
    const t = run(viewOf(history, { storeMJ: 3.2 })).storeTrendJPerLap;
    expect(t.known && t.value).toBeCloseTo(-0.4 * MJ, 3);
  });

  it('a lap record with an unknown store is no sample', () => {
    const history = [storedLap(1, 4), storedLap(2, 0, { ersStoreAtEndJ: unknown('notReceived') }), storedLap(3, 3.2), storedLap(4, 2.8)];
    const t = run(viewOf(history, { storeMJ: 2.8 })).storeTrendJPerLap;
    expect(t.known && t.value).toBeCloseTo(-0.4 * MJ, 3);
  });

  it('realism: a rival`s store is unknown(`realism`)', () => {
    const hidden = unknown('realism');
    const rivalLaps = [1, 2, 3, 4].map((n) =>
      storedLap(n, 0, { carId: carId(1), ersStoreAtEndJ: hidden, ersDeployedJ: hidden, ersHarvestedJ: hidden }),
    );
    const view = engineView({
      cars: [carWith({ storeMJ: 3.2 }), realismHidden(carState({ id: carId(1) }))],
      history: { laps: [...laps([4, 3.6, 3.2]), ...rivalLaps] },
    });
    const out = ersCalculator.compute(view);
    const rival = out[carId(1)]!;
    for (const field of ['storeJ', 'deployedThisLapJ', 'harvestedThisLapJ', 'storeTrendJPerLap', 'lapsToAttackLevel', 'attack', 'mode', 'flow'] as const) {
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
