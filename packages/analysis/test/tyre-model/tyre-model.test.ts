// `tyre-model` (SP4.3c spec §5.2, O1; plan Task 12 rows 1–6, 9, 10b, 11; C3, C8, C41, C43, C44, C47, C62c): per car,
// compound and corner the tyre terms every planner reads, each with its source. The unit chooses the source (measured
// rate, else the game's prior k × 70 / usableLife with k from the driver's profile, the AI's or the human default),
// the limit and the fresh sets; one module per tyre type (`types/slick.ts`, `inter.ts`, `wet.ts`) adds its own terms.
//
// The rate-lap cases ported from `test/tyre-life/` (C82: the judgement moved here with them) keep their inputs; their
// expectations follow the measured rate's new rule (research 21 §2: the cumulative gain over the newest ≤ 5 green laps,
// from 3 gain laps and 5 % accrued at the corner; before that the prior). The median rule's own case (one outlier among
// five) went with the median (spec §5.2 "Deletes").
//
// Every case runs through the guarded view (C41). The type modules' inputs are pinned here (the plan names them
// `TypeRateInput`, `TypeLossInput`, `TypeOffsetInput`): a rate input is the rate the unit chose with its source, the
// track's wetness (ms) over the measured window and now, the carcass (°C) the rate assumes and now, and the config.
import { carId, known, NOISE_COMPOUNDS, unknown, type CarState, type LapRecord, type NoiseCompound, type StintRecord, type TyreTerm } from '@pitwall/domain';
import type { EngineView } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { INTER_CONFIG, SLICK_CONFIG, TYRE_MODEL, TYRE_MODEL_CONFIG, tyreModelCalculator, WET_CONFIG } from '../../src/tyre-model/index.ts';
import { inter } from '../../src/tyre-model/types/inter.ts';
import { slick } from '../../src/tyre-model/types/slick.ts';
import { wet } from '../../src/tyre-model/types/wet.ts';
import { LAP_CLASSES_CONFIG } from '../../src/lap-classes/index.ts';
import { carState, lap, realismHidden } from '../../../../test-support/builders/index.ts';
import { engineShaped } from '../engine-shaped.ts';
import { guardedQuick, NONE, PRACTICE, QUALIFYING } from '../situated.ts';
import {
  ACTUAL,
  carOf,
  CORNERS,
  endWear,
  everyCorner,
  gainLaps,
  LAP_MS,
  linkedDriver,
  liveSets,
  modelView,
  tyreSet,
  valueOf,
  wearFactorKey,
  type ModelCar,
} from './support.ts';

const calc = guardedQuick(tyreModelCalculator);

const AI_K = 0.86;
const HUMAN_K = 1.3;
/** The prior of a car whose fitted set's usable life is 28 laps (the builders' default). */
const AI_PRIOR_28 = (AI_K * 70) / 28;

/** The fitted compound's terms of car `car` in the output on `view`. */
const fittedOf = (view: EngineView, car = 0, compound: NoiseCompound = 'medium') => carOf(calc.compute(view), car).compounds[compound];

/** Car 0 (AI unless said) on mediums whose live wear is the laps' end wear, aged as many laps as the stint has, over `laps`. */
function runView(laps: LapRecord[], car: Partial<ModelCar> = {}, o: Parameters<typeof modelView>[1] = {}): EngineView {
  const own = laps.filter((l) => l.carId === carId(car.id ?? 0));
  return modelView([{ id: 0, compound: 'medium', age: own.at(-1) === undefined ? 0 : own.at(-1)!.tyreAgeAtStart + 1, wearPct: endWear(own), ...car }], { laps, ...o });
}

const stint = (over: Partial<StintRecord> & Pick<StintRecord, 'firstLap' | 'lastLap'>): StintRecord => ({
  carId: carId(0),
  actualCompound: ACTUAL.medium,
  visualCompound: 'medium',
  tyreAgeAtFitting: 0,
  frame: over.lastLap * LAP_MS,
  ...over,
});

/** The rate of a corner is measured, with `value`. */
const expectMeasured = (t: TyreTerm<number>, value: number): void => {
  expect(t.source).toBe('measured');
  expect(valueOf(t)).toBeCloseTo(value, 9);
};

/** The rate of a corner is the AI's game prior of a 28-lap set (no measured rate yet). */
const expectPrior = (t: TyreTerm<number>): void => {
  expect(t.source).toBe('game');
  expect(valueOf(t)).toBeCloseTo(AI_PRIOR_28, 9);
};

describe('tyre-model: the unit', () => {
  it('is the quick calculator `tyre-model` over the tyres, laps, stints, decisions, drivers, the four sub-machines, degradation and track-wetness', () => {
    expect(tyreModelCalculator.id).toBe(TYRE_MODEL);
    expect(TYRE_MODEL).toBe('tyre-model');
    expect(tyreModelCalculator.kind).toBe('quick');
    expect(tyreModelCalculator.reads).toEqual(
      expect.arrayContaining(['tyres', 'laps', 'stints', 'decisions', 'drivers', 'spans:car-driver', 'spans:car-activity-race', 'spans:car-status', 'spans:weekend-phase']),
    );
    expect(tyreModelCalculator.reads).toContainEqual({ calculator: 'degradation' });
    expect(tyreModelCalculator.reads).toContainEqual({ calculator: 'track-wetness' });
  });

  it('config: the limit, the factors, the measured-rate rule, the loss threshold (research 21 §2, 22 §1.2, §1.6)', () => {
    expect(TYRE_MODEL_CONFIG.key).toBe('tyre-model');
    expect(TYRE_MODEL_CONFIG.defaults).toMatchObject({
      limitPct: 70,
      aiWearFactor: 0.86,
      humanWearFactor: 1.3,
      minGainLaps: 3,
      minAccruedPct: 5,
      rateWindowLaps: 5,
      minWearForLossPct: 8,
    });
    expect(SLICK_CONFIG.defaults).toMatchObject({ heatPctPerLapPerC: 0, convexFromPct: 40, convexMsPerPct2: 2.5 });
    expect(INTER_CONFIG.defaults).toMatchObject({ heatPctPerLapPerC: 0.042, dryingPerSecond: 0.06 });
    expect(WET_CONFIG.defaults).toMatchObject({ heatPctPerLapPerC: 0 });
    // each type its own section
    expect(new Set([TYRE_MODEL_CONFIG.key, SLICK_CONFIG.key, INTER_CONFIG.key, WET_CONFIG.key]).size).toBe(4);
  });

  it('ruling R20: the carcass reference temperatures are car-bands\' (one key per threshold, C43): no tyre-model section declares one', () => {
    for (const section of [TYRE_MODEL_CONFIG, SLICK_CONFIG, INTER_CONFIG, WET_CONFIG]) {
      expect(Object.keys(section.defaults).filter((k) => /ref.*temp|temp.*ref/i.test(k)), section.key).toEqual([]);
    }
  });

  it('every car in the session gets every compound; a slot without a car-status span none', () => {
    const out = calc.compute(modelView([{ id: 0 }, { id: 3, compound: 'hard' }]));
    for (const car of [0, 3]) expect(Object.keys(carOf(out, car).compounds).sort(), `car ${car}`).toEqual([...NOISE_COMPOUNDS].sort());
    expect(out[carId(5)]).toBeUndefined();
    expect(carOf(out, 0).limitPct).toBe(70);
  });
});

describe('row 1: the measured rate (research 21 §2)', () => {
  it('gains 2, 3, 2, 3, 2 on the worst corner → 2.4 %/lap (cumulative), source measured', () => {
    // rr: lap 1 gains 9 (outside the newest five), then 2, 3, 2, 3, 2; the other corners 1 a lap
    const gains = [9, 2, 3, 2, 3, 2].map((rr) => ({ fl: 1, fr: 1, rl: 1, rr }));
    const m = fittedOf(runView(gainLaps(gains)));
    expectMeasured(m.wearRatePct.rr, 2.4);
  });

  it('after 2 gain laps (5 % accrued) the prior; after 3 gain laps with 4 % accrued the prior', () => {
    expectPrior(fittedOf(runView(gainLaps([{ fl: 2, fr: 2, rl: 2, rr: 2 }, { fl: 3, fr: 3, rl: 3, rr: 3 }]))).wearRatePct.rr);
    expectPrior(fittedOf(runView(gainLaps([1, 1, 2]))).wearRatePct.rr);
    // 3 gain laps and 5 % accrued: measured
    expectMeasured(fittedOf(runView(gainLaps([1, 2, 2]))).wearRatePct.rr, 5 / 3);
  });

  it('the thresholds and the window come from the config', () => {
    const laps = gainLaps([2, 2, 2]);
    expectPrior(fittedOf(runView(laps, {}, { config: { [TYRE_MODEL_CONFIG.key]: { minGainLaps: 4 } } })).wearRatePct.fl);
    expectPrior(fittedOf(runView(laps, {}, { config: { [TYRE_MODEL_CONFIG.key]: { minAccruedPct: 7 } } })).wearRatePct.fl);
    // window 3: gains 1, 1, 3, 3, 3 → the newest three, 3 %/lap
    expectMeasured(fittedOf(runView(gainLaps([1, 1, 3, 3, 3]), {}, { config: { [TYRE_MODEL_CONFIG.key]: { rateWindowLaps: 3 } } })).wearRatePct.fl, 3);
  });

  describe('which laps are rate laps (ported from tyre-life)', () => {
    it('gains 2, 2, 3, 2, 2 % give 2.2 %/lap (was the median 2)', () => {
      const m = fittedOf(runView(gainLaps([2, 2, 3, 2, 2])));
      for (const corner of CORNERS) expectMeasured(m.wearRatePct[corner], 2.2);
    });

    it('each corner has its own rate', () => {
      const m = fittedOf(runView(gainLaps([0, 1, 2, 3, 4].map(() => ({ fl: 2, fr: 3, rl: 1, rr: 4 })))));
      expectMeasured(m.wearRatePct.fl, 2);
      expectMeasured(m.wearRatePct.fr, 3);
      expectMeasured(m.wearRatePct.rl, 1);
      expectMeasured(m.wearRatePct.rr, 4);
    });

    it('a lap`s gain is its own end minus its own start: a jump between laps is in no lap', () => {
      // lap 2 starts 5 % above lap 1's end (wear the engine saw between the two samples): the gains are 2, 2, 2
      const laps = [...gainLaps([2]), ...gainLaps([2, 2], { from: 2, startPct: 7 })];
      expectMeasured(fittedOf(runView(laps)).wearRatePct.fl, 2);
    });

    it('only the newest 5 rate laps count (the window): gains 1, 1, 1, 1, 1, 3, 3, 3 → (1 + 1 + 3 + 3 + 3) / 5', () => {
      expectMeasured(fittedOf(runView(gainLaps([1, 1, 1, 1, 1, 3, 3, 3]))).wearRatePct.fl, 11 / 5);
    });

    it('a lap with 2 s or more under SC or VSC is no rate lap, and its low wear does not pull the rate down', () => {
      const laps = [
        ...gainLaps([3]),
        ...gainLaps([0.5], { from: 2, startPct: 3, over: { vscShare: 0.2 } }),
        ...gainLaps([0.5], { from: 3, startPct: 3.5, over: { scShare: 0.97, vscShare: 0.03 } }),
        ...gainLaps([0.5], { from: 4, startPct: 4, over: { scShare: 1 } }),
        ...gainLaps([3, 3], { from: 5, startPct: 4.5 }),
      ];
      expectMeasured(fittedOf(runView(laps)).wearRatePct.fl, 3);
    });

    it('a lap with under 2 s under SC (the flag lag at a restart) is a rate lap; the neutralised time allowed comes from the lap-classes config', () => {
      const laps = [...gainLaps([2.5]), ...gainLaps([2.5], { from: 2, startPct: 2.5, over: { scShare: 0.01 } }), ...gainLaps([2.5], { from: 3, startPct: 5 })];
      expectMeasured(fittedOf(runView(laps)).wearRatePct.fl, 2.5);
      expectPrior(fittedOf(runView(laps, {}, { config: { [LAP_CLASSES_CONFIG.key]: { maxNeutralisedMs: 500 } } })).wearRatePct.fl);
    });

    it('an in lap and an out lap are no rate laps', () => {
      const laps = [...gainLaps([2, 2, 2]), ...gainLaps([10], { from: 4, startPct: 6, over: { inLap: true } }), ...gainLaps([8], { from: 5, startPct: 16, over: { outLap: true } })];
      expectMeasured(fittedOf(runView(laps)).wearRatePct.fl, 2);
    });

    it('a lap whose start wear is unknown (the engine joined it after its start) is no rate lap', () => {
      const joined = gainLaps([9], { over: { wearAtStartPct: everyCorner(() => unknown('notReceived')) } });
      expectPrior(fittedOf(runView([...joined, ...gainLaps([2, 2], { from: 2, startPct: 9 })])).wearRatePct.fl);
      expectMeasured(fittedOf(runView([...joined, ...gainLaps([2, 2, 2], { from: 2, startPct: 9 })])).wearRatePct.fl, 2);
    });

    it('a lap with an unknown start or end wear on one corner is no rate lap for that corner only', () => {
      const [a, b, c] = gainLaps([2, 2, 2]);
      const noStart = { ...c!, wearAtStartPct: { ...c!.wearAtStartPct, fl: unknown('notReceived') } };
      const m = fittedOf(runView([a!, b!, noStart]));
      expectPrior(m.wearRatePct.fl);
      expectMeasured(m.wearRatePct.fr, 2);
      const noEnd = { ...c!, wearAtEndPct: { ...c!.wearAtEndPct, rr: unknown('notReceived') } };
      const n = fittedOf(runView([a!, b!, noEnd], { wearPct: 6 }));
      expectPrior(n.wearRatePct.rr);
      expectMeasured(n.wearRatePct.rl, 2);
    });

    it('the rate uses only the current stint', () => {
      // stop at the end of lap 4 (in lap 4, out lap 5): the old set wore 3 %/lap, the new one wears 2 %/lap
      const laps = [
        ...gainLaps([3, 3, 3]),
        ...gainLaps([3], { from: 4, startPct: 9, over: { inLap: true } }),
        ...gainLaps([1], { from: 5, age: 0, over: { outLap: true } }),
        ...gainLaps([2, 2, 2], { from: 6, age: 1, startPct: 1 }),
      ];
      const view = runView(laps, { age: 4, wearPct: 7 }, { stints: [stint({ firstLap: 1, lastLap: 4 })] });
      expectMeasured(fittedOf(view).wearRatePct.fl, 2);
    });

    it('right after a stop the prior, however long the previous stint was', () => {
      const laps = [...gainLaps([3, 3, 3, 3]), ...gainLaps([3], { from: 5, startPct: 12, over: { inLap: true } }), ...gainLaps([1], { from: 6, age: 0, over: { outLap: true } }), ...gainLaps([2], { from: 7, age: 1, startPct: 1 })];
      expectPrior(fittedOf(runView(laps, { age: 2, wearPct: 3 }, { stints: [stint({ firstLap: 1, lastLap: 5 })] })).wearRatePct.fl);
    });

    it('a stint record that ends on the newest lap (the session ended) is the current stint', () => {
      const laps = [...gainLaps([4, 4]), ...gainLaps([2, 2, 2, 2], { from: 3, age: 0 })];
      const stints = [stint({ firstLap: 1, lastLap: 2 }), stint({ firstLap: 3, lastLap: 6 })];
      expectMeasured(fittedOf(runView(laps, { age: 4, wearPct: 8 }, { stints })).wearRatePct.fl, 2);
    });

    describe('no old-set rate on a new set (user ruling 2026-10-30)', () => {
      // laps 1-4 on medium from new (age 0 to 3 at the lap starts) wear 3 %/lap: 12 % accrued, a measured rate on that set
      const oldSet = (): LapRecord[] => gainLaps([3, 3, 3, 3]);

      it('a new set fitted at a stop whose in lap has not been followed by a completed lap: the prior, not the old set`s rate', () => {
        const laps = [...oldSet(), ...gainLaps([3], { from: 5, startPct: 12, over: { inLap: true } })];
        const m = fittedOf(runView(laps, { age: 0, wearPct: 0 }, { stints: [stint({ firstLap: 1, lastLap: 5 })] }));
        for (const corner of CORNERS) expectPrior(m.wearRatePct[corner]);
      });

      it('a new set fitted in the garage on the same lap number (no stint record yet): the prior', () => {
        expectPrior(fittedOf(runView(oldSet(), { age: 0, wearPct: 0 })).wearRatePct.fl);
      });

      it('a used set of another compound with more laps on it: its compound`s prior', () => {
        expectPrior(fittedOf(runView(oldSet(), { compound: 'soft', age: 6, wearPct: 20 }), 0, 'soft').wearRatePct.fl);
      });

      it('the same set after a garage visit keeps its rate', () => {
        expectMeasured(fittedOf(runView(oldSet(), { age: 4, wearPct: 12 })).wearRatePct.fl, 3);
      });

      it('after a stop whose in lap is the newest lap, a used set of the same compound has no rate laps from the old set', () => {
        const laps = [...oldSet(), ...gainLaps([3], { from: 5, startPct: 12, over: { inLap: true } })];
        const m = fittedOf(runView(laps, { age: 3, wearPct: 9 }, { stints: [stint({ firstLap: 1, lastLap: 5 })] }));
        for (const corner of CORNERS) expectPrior(m.wearRatePct[corner]);
      });

      it('a stint without a stop keeps its rate (an SC lap on the set is no rate lap, but no set change)', () => {
        const laps = [...gainLaps([3, 3]), ...gainLaps([0.5], { from: 3, startPct: 6, over: { scShare: 1 } }), ...gainLaps([3, 3, 3], { from: 4, startPct: 6.5 })];
        const m = fittedOf(runView(laps, { age: 6, wearPct: 15.5 }, { stints: [stint({ firstLap: 1, lastLap: 6 })] }));
        for (const corner of CORNERS) expectMeasured(m.wearRatePct[corner], 3);
      });
    });

    describe('on engine-shaped history: every lap provisional then confirmed, no record for the open stint', () => {
      it('the rate uses only the open stint', () => {
        const laps = engineShaped([
          ...gainLaps([3, 3, 3]),
          ...gainLaps([3], { from: 4, startPct: 9, over: { inLap: true } }),
          ...gainLaps([1], { from: 5, age: 0, over: { outLap: true } }),
          ...gainLaps([2, 2, 2], { from: 6, age: 1, startPct: 1 }),
        ]);
        expectMeasured(fittedOf(runView(laps, { age: 4, wearPct: 7 }, { stints: [stint({ firstLap: 1, lastLap: 4 })] })).wearRatePct.fl, 2);
      });

      it('a lap counts once: two laps of 3 %, each written twice, are below minGainLaps (3)', () => {
        expectPrior(fittedOf(runView(engineShaped(gainLaps([3, 3])), { age: 2, wearPct: 6 })).wearRatePct.fl);
      });

      it('the confirmed record wins over the provisional one', () => {
        const laps = engineShaped(gainLaps([2, 2, 2]), { wearAtEndPct: everyCorner(() => known(60, 1)) });
        expectMeasured(fittedOf(runView(laps, { age: 3, wearPct: 6 })).wearRatePct.fl, 2);
      });
    });

    it('wear that does not grow is no measured rate: the prior', () => {
      expectPrior(fittedOf(runView(gainLaps([0, 0, 0], { startPct: 5 }), { wearPct: 5 })).wearRatePct.fl);
    });

    it('keeps cars apart', () => {
      const laps = [...gainLaps([2, 2, 2]), ...gainLaps([3, 3, 3], { car: 1 })];
      const out = calc.compute(modelView([{ id: 0, age: 3, wearPct: 6 }, { id: 1, age: 3, wearPct: 9 }], { laps }));
      expectMeasured(carOf(out, 0).compounds.medium.wearRatePct.fl, 2);
      expectMeasured(carOf(out, 1).compounds.medium.wearRatePct.fl, 3);
    });

    it('runs in practice, qualifying and a session without a phase too (no lap 1 rule for a rate)', () => {
      for (const phase of [PRACTICE, QUALIFYING, NONE]) {
        expectMeasured(fittedOf(runView(gainLaps([2, 2, 2]), { age: 3, wearPct: 6 }, { phase })).wearRatePct.fl, 2);
      }
    });
  });
});

describe('row 2: the game prior k × 70 / usableLife (research 22 §1.2)', () => {
  /** Car 0 with no lap yet on a fresh medium of usable life 28: the driver as given. */
  const priorView = (driver: 'ai' | 'human', drivers?: EngineView['drivers']): EngineView =>
    modelView([{ id: 0, driver, sets: liveSets([tyreSet('medium', { fitted: true, usableLifeLaps: 28 })]) }], drivers === undefined ? {} : { drivers });

  it('usableLife 28, AI → 0.86 × 70 / 28 = 2.15 %/lap, source game', () => {
    const m = fittedOf(priorView('ai'));
    for (const corner of CORNERS) {
      expect(valueOf(m.wearRatePct[corner])).toBeCloseTo(2.15, 9);
      expect(m.wearRatePct[corner].source).toBe('game');
    }
  });

  it('a human without a profile → 1.3 × 70 / 28', () => {
    const m = fittedOf(priorView('human'));
    for (const corner of CORNERS) expect(valueOf(m.wearRatePct[corner])).toBeCloseTo((HUMAN_K * 70) / 28, 9);
  });

  it('a human with profile k 1.19 → 1.19 × 70 / 28, source profile (the profile entry tyreModel.wearFactor.<compound>, C62c)', () => {
    const m = fittedOf(priorView('human', linkedDriver(0, 'dr', { [wearFactorKey('medium')]: 1.19 })));
    for (const corner of CORNERS) {
      expect(valueOf(m.wearRatePct[corner])).toBeCloseTo((1.19 * 70) / 28, 9);
      expect(m.wearRatePct[corner].source).toBe('profile');
    }
    // another compound's k is the human default while the profile has none for it
    const other = modelView(
      [{ id: 0, driver: 'human', sets: liveSets([tyreSet('medium', { fitted: true }), tyreSet('hard', { usableLifeLaps: 40 })]) }],
      { drivers: linkedDriver(0, 'dr', { [wearFactorKey('medium')]: 1.19 }) },
    );
    expect(valueOf(fittedOf(other, 0, 'hard').wearRatePct.fl)).toBeCloseTo((HUMAN_K * 70) / 40, 9);
  });

  it('the AI factor, the human factor and the limit come from the config', () => {
    const config = { [TYRE_MODEL_CONFIG.key]: { aiWearFactor: 1, humanWearFactor: 2, limitPct: 56 } };
    expect(valueOf(fittedOf(modelView([{ id: 0, driver: 'ai', sets: liveSets([tyreSet('medium', { fitted: true })]) }], { config })).wearRatePct.fl)).toBeCloseTo(56 / 28, 9);
    expect(valueOf(fittedOf(modelView([{ id: 0, driver: 'human', sets: liveSets([tyreSet('medium', { fitted: true })]) }], { config })).wearRatePct.fl)).toBeCloseTo((2 * 56) / 28, 9);
    expect(carOf(calc.compute(modelView([{ id: 0 }], { config })), 0).limitPct).toBe(56);
  });

  it('every compound of the car takes its own sets\' usable life: a fresh hard of 40 laps → 0.86 × 70 / 40', () => {
    const view = modelView([{ id: 0, sets: liveSets([tyreSet('medium', { fitted: true }), tyreSet('hard', { usableLifeLaps: 40 }), tyreSet('soft', { usableLifeLaps: 14 })]) }]);
    const car = carOf(calc.compute(view), 0);
    expect(valueOf(car.compounds.hard.wearRatePct.fl)).toBeCloseTo((AI_K * 70) / 40, 9);
    expect(valueOf(car.compounds.soft.wearRatePct.fl)).toBeCloseTo((AI_K * 70) / 14, 9);
  });

  it('a fresh set\'s laps to the limit per compound: the limit over its rate (a prior: usableLife / k; measured: 70 / the worst corner)', () => {
    const view = modelView([{ id: 0, sets: liveSets([tyreSet('medium', { fitted: true }), tyreSet('hard', { usableLifeLaps: 40 })]) }]);
    expect(valueOf(carOf(calc.compute(view), 0).compounds.hard.lapsToLimit)).toBeCloseTo(40 / AI_K, 6);
    // measured: the worst corner rr 4 %/lap (the others 2) → 17.5 laps for a fresh set
    const measured = fittedOf(runView(gainLaps([2, 2, 2, 2, 2].map(() => ({ fl: 2, fr: 2, rl: 2, rr: 4 })))));
    expect(valueOf(measured.lapsToLimit)).toBeCloseTo(70 / 4, 6);
  });
});

describe('row 3: one module per tyre type (modularity)', () => {
  const base = (value: number): TyreTerm<number> => ({ value: known(value, 0), source: 'measured' });

  it('a slick, an inter and a wet module have the same three terms, as functions', () => {
    for (const [name, module] of Object.entries({ slick, inter, wet })) {
      expect(Object.keys(module).sort(), name).toEqual(['freshOffsetMs', 'lossMsPerPct', 'wearRatePct']);
      for (const fn of Object.values(module)) expect(typeof fn, name).toBe('function');
    }
  });

  it('changing inter.dryingPerSecond in config changes only the inter rate', () => {
    const input = (config: EngineView['config']) => ({ base: base(2), wetnessMs: { window: 18_000, now: 10_000 }, config });
    const changed = { [INTER_CONFIG.key]: { dryingPerSecond: 0.1 } };
    expect(valueOf(inter.wearRatePct(input(changed)))).toBeCloseTo(2 * (1 + 0.1 * 8), 9);
    expect(valueOf(inter.wearRatePct(input(changed)))).not.toBeCloseTo(valueOf(inter.wearRatePct(input({}))), 6);
    expect(slick.wearRatePct(input(changed))).toEqual(slick.wearRatePct(input({})));
    expect(wet.wearRatePct(input(changed))).toEqual(wet.wearRatePct(input({})));
  });

  it('changing inter.heatPctPerLapPerC through the unit changes only the inter cars\' rates', () => {
    // a human on inters and a human on mediums, each 5 laps of 2 %/lap at a 70 °C carcass mean, 90 °C now
    const laps = [...gainLaps([2, 2, 2, 2, 2], { compound: 'inter', carcassMeanC: 70 }), ...gainLaps([2, 2, 2, 2, 2], { car: 1, carcassMeanC: 70 })];
    const cars: ModelCar[] = [
      { id: 0, driver: 'human', compound: 'inter', age: 5, wearPct: 10, carcassC: 90 },
      { id: 1, driver: 'human', compound: 'medium', age: 5, wearPct: 10, carcassC: 90 },
    ];
    const plain = calc.compute(modelView(cars, { laps }));
    const changed = calc.compute(modelView(cars, { laps, config: { [INTER_CONFIG.key]: { heatPctPerLapPerC: 0.1 } } }));
    expect(valueOf(carOf(changed, 0).compounds.inter.wearRatePct.fl)).toBeCloseTo(2 + 0.1 * 20, 9);
    expect(carOf(changed, 1).compounds.medium).toEqual(carOf(plain, 1).compounds.medium);
  });
});

describe('row 4: the drying term (inter only, research 21 §3)', () => {
  const base: TyreTerm<number> = { value: known(2, 0), source: 'measured' };

  it('wetness falling 18 → 10 s raises the inter rate by 0.06 × 8 = 48 % of its measured value; a slick`s and a wet`s are unchanged', () => {
    const input = { base, wetnessMs: { window: 18_000, now: 10_000 }, config: {} };
    const out = inter.wearRatePct(input);
    expect(valueOf(out)).toBeCloseTo(2 * 1.48, 9);
    expect(out.source).toBe('measured');
    expect(valueOf(slick.wearRatePct(input))).toBeCloseTo(2, 9);
    expect(valueOf(wet.wearRatePct(input))).toBeCloseTo(2, 9);
  });

  it('a steady track adds nothing; an unknown wetness adds nothing', () => {
    expect(valueOf(inter.wearRatePct({ base, wetnessMs: { window: 10_000, now: 10_000 }, config: {} }))).toBeCloseTo(2, 9);
    expect(valueOf(inter.wearRatePct({ base, config: {} }))).toBeCloseTo(2, 9);
  });
});

describe('row 5: the heat term (research 20 §6)', () => {
  /** Car 0 on `compound`, 5 laps of 2 %/lap at a 70 °C carcass mean, 90 °C now; `driver` as given. */
  const heatView = (driver: 'ai' | 'human', compound: NoiseCompound): EngineView =>
    modelView([{ id: 0, driver, compound, age: 5, wearPct: 10, carcassC: 90 }], { laps: gainLaps([2, 2, 2, 2, 2], { compound, carcassMeanC: 70 }) });

  it('a human inter 20 °C over its window\'s mean carcass → +0.84 %/lap on the measured rate', () => {
    const m = fittedOf(heatView('human', 'inter'), 0, 'inter');
    for (const corner of CORNERS) expectMeasured(m.wearRatePct[corner], 2 + 0.042 * 20);
  });

  it('an AI car → no heat term (the game simulates no AI temperatures, research 20 §1)', () => {
    expectMeasured(fittedOf(heatView('ai', 'inter'), 0, 'inter').wearRatePct.fl, 2);
  });

  it('a slick human → +0 (config 0, "not measured yet")', () => {
    expectMeasured(fittedOf(heatView('human', 'medium')).wearRatePct.fl, 2);
  });

  it('the prior assumes the reference carcass (car-bands\', ruling R20): a human inter 85 °C now (ref 65) → 1.3 × 70 / 20 + 0.042 × 20', () => {
    const view = modelView([{ id: 0, driver: 'human', compound: 'inter', carcassC: 85, sets: liveSets([tyreSet('inter', { fitted: true, usableLifeLaps: 20 })]) }]);
    expect(valueOf(fittedOf(view, 0, 'inter').wearRatePct.fl)).toBeCloseTo((HUMAN_K * 70) / 20 + 0.042 * 20, 9);
    // car-bands' reference moved: the term follows
    const moved = modelView([{ id: 0, driver: 'human', compound: 'inter', carcassC: 85, sets: liveSets([tyreSet('inter', { fitted: true, usableLifeLaps: 20 })]) }], {
      config: { 'car-bands': { refTempInterC: 75 } },
    });
    expect(valueOf(fittedOf(moved, 0, 'inter').wearRatePct.fl)).toBeCloseTo((HUMAN_K * 70) / 20 + 0.042 * 10, 9);
  });

  it('the inter module adds heatPctPerLapPerC × (now − basis); the slick and wet modules 0', () => {
    const input = { base: { value: known(2, 0), source: 'measured' } as TyreTerm<number>, carcassC: { basis: 70, now: 90 }, config: {} };
    expect(valueOf(inter.wearRatePct(input))).toBeCloseTo(2.84, 9);
    expect(valueOf(slick.wearRatePct(input))).toBeCloseTo(2, 9);
    expect(valueOf(wet.wearRatePct(input))).toBeCloseTo(2, 9);
  });
});

describe('row 6: the loss per % of wear (research 22 §1.6)', () => {
  /** Car 0 on a medium C3 at `wearPct`, a fresh medium beside it `freshDeltaMs` faster. */
  const lossView = (wearPct: number, freshDeltaMs: number): EngineView =>
    modelView([{ id: 0, wearPct, sets: liveSets([tyreSet('medium', { fitted: true, wearPct, lapDeltaMs: 0 }), tyreSet('medium', { lapDeltaMs: freshDeltaMs })]) }]);

  it('fitted delta 0, fresh delta −1,140 ms at 20 % wear → 57 ms/%, source game; −1,500 ms → 75', () => {
    const m = fittedOf(lossView(20, -1_140));
    expect(valueOf(m.lossMsPerPct)).toBeCloseTo(57, 9);
    expect(m.lossMsPerPct.source).toBe('game');
    expect(valueOf(fittedOf(lossView(20, -1_500)).lossMsPerPct)).toBeCloseTo(75, 9);
  });

  it('at 6 % wear (below minWearForLossPct) → the default 57 for C3 (C3: never 0), source default', () => {
    const m = fittedOf(lossView(6, -1_140));
    expect(valueOf(m.lossMsPerPct)).toBeCloseTo(57, 9);
    expect(m.lossMsPerPct.source).toBe('default');
    // the threshold comes from the config
    expect(fittedOf(modelView([{ id: 0, wearPct: 20, sets: liveSets([tyreSet('medium', { fitted: true, wearPct: 20 }), tyreSet('medium', { lapDeltaMs: -1_500 })]) }], {
      config: { [TYRE_MODEL_CONFIG.key]: { minWearForLossPct: 25 } },
    })).lossMsPerPct.source).toBe('default');
  });

  it('the defaults per actual compound: C4 75, C3 57, C2 35, C1 22, inter 11, wet 11 ms/%', () => {
    const cases: [NoiseCompound, CarState['tyres']['actualCompound'], number][] = [
      ['soft', 'C4', 75],
      ['medium', 'C3', 57],
      ['hard', 'C2', 35],
      ['hard', 'C1', 22],
      ['inter', 'inter', 11],
      ['wet', 'wet', 11],
    ];
    for (const [visual, actual, loss] of cases) {
      const view = modelView([{ id: 0, compound: visual, actual, sets: liveSets([tyreSet(visual, { fitted: true, actualCompound: actual })]) }]);
      const m = fittedOf(view, 0, visual);
      expect(valueOf(m.lossMsPerPct), `${visual} ${actual}`).toBeCloseTo(loss, 9);
      expect(m.lossMsPerPct.source, `${visual} ${actual}`).toBe('default');
    }
  });

  it('ν is the loss per % × the wear rate (research 22 §2)', () => {
    const m = fittedOf(modelView([{ id: 0, sets: liveSets([tyreSet('medium', { fitted: true })]) }]));
    expect(valueOf(m.nuMsPerLap)).toBeCloseTo(57 * AI_PRIOR_28, 6);
  });
});

describe('row 9: a rival under realism', () => {
  it('every set and wear unknown(realism) → rates from our car\'s game values on that compound, source game, no throw', () => {
    const ours = modelView([{ id: 0, driver: 'human', sets: liveSets([tyreSet('medium', { fitted: true, usableLifeLaps: 28 }), tyreSet('hard', { usableLifeLaps: 40 })]) }]);
    const rival = realismHidden(carState({ id: carId(1), tyres: { actualCompound: ACTUAL.medium, visualCompound: 'medium', age: 6 } }));
    expect(rival.tyres.sets).toEqual(unknown('realism'));
    const hidden = everyCorner(() => unknown('realism'));
    const laps = gainLaps([2, 2, 2, 2, 2, 2], { car: 1, over: { wearAtStartPct: hidden, wearAtEndPct: hidden, tyreSets: unknown('realism') } });
    const view = modelView([{ id: 0, driver: 'human', sets: (ours.live.cars[0] as CarState).tyres.sets }, rival], { laps });
    let out: ReturnType<typeof calc.compute> | undefined;
    expect(() => (out = calc.compute(view))).not.toThrow();
    const r = carOf(out!, 1);
    for (const corner of CORNERS) {
      expect(valueOf(r.compounds.medium.wearRatePct[corner])).toBeCloseTo(AI_PRIOR_28, 9);
      expect(r.compounds.medium.wearRatePct[corner].source).toBe('game');
    }
    expect(valueOf(r.compounds.hard.wearRatePct.fl)).toBeCloseTo((AI_K * 70) / 40, 9);
    // its fresh sets are hidden (C8)
    for (const c of NOISE_COMPOUNDS) expect(r.freshSets[c]).toEqual(unknown('realism'));
  });
});

describe('row 10b: the available fresh sets', () => {
  it('two fresh mediums, one used medium, one unavailable hard → freshSets medium 2, hard 0; the fitted soft is no fresh set', () => {
    const sets = liveSets([
      tyreSet('soft', { fitted: true, wearPct: 10 }),
      tyreSet('medium'),
      tyreSet('medium'),
      tyreSet('medium', { wearPct: 30 }),
      tyreSet('hard', { available: false }),
    ]);
    const car = carOf(calc.compute(modelView([{ id: 0, compound: 'soft', wearPct: 10, sets }])), 0);
    expect(car.freshSets.medium).toMatchObject({ known: true, value: 2 });
    expect(car.freshSets.hard).toMatchObject({ known: true, value: 0 });
    expect(car.freshSets.soft).toMatchObject({ known: true, value: 0 });
  });

  it('sets not received → freshSets notReceived (C3: never 0)', () => {
    const car = carOf(calc.compute(modelView([{ id: 0, sets: unknown('notReceived') }])), 0);
    for (const c of NOISE_COMPOUNDS) expect(car.freshSets[c]).toEqual(unknown('notReceived'));
  });
});

describe('row 11: the prior\'s error on synthetic stints (research 22 §1.2)', () => {
  /** A seeded generator (mulberry32) and a standard normal draw from it (Box–Muller): the test's own, C2. */
  const rng = (seed: number) => {
    let a = seed >>> 0;
    const next = (): number => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    return { next, normal: (): number => Math.sqrt(-2 * Math.log(1 - next())) * Math.cos(2 * Math.PI * next()) };
  };

  it('on stints whose rate is 0.86 × 70 / usableLife × noise (σ 10 %), the prior\'s p50 error ≤ 12 %', () => {
    const r = rng(22);
    const errors: number[] = [];
    for (let i = 0; i < 200; i++) {
      const usableLifeLaps = 12 + Math.floor(r.next() * 40);
      const truth = ((AI_K * 70) / usableLifeLaps) * (1 + 0.1 * r.normal());
      const view = modelView([{ id: 0, sets: liveSets([tyreSet('medium', { fitted: true, usableLifeLaps })]) }]);
      const prior = valueOf(fittedOf(view).wearRatePct.fl);
      errors.push(Math.abs(prior - truth) / truth);
    }
    errors.sort((a, b) => a - b);
    expect(errors[errors.length >> 1]!).toBeLessThanOrEqual(0.12);
  });
});

describe('the behaviour table (C44)', () => {
  it('the unit exports TYRE_MODEL_BEHAVIOUR over the sub-machines it reads', async () => {
    const index = (await import('../../src/tyre-model/index.ts')) as Record<string, unknown>;
    const table = index['TYRE_MODEL_BEHAVIOUR'] as Record<string, unknown> | undefined;
    expect(table).toBeDefined();
    const read = tyreModelCalculator.reads.flatMap((r) => (typeof r === 'string' && r.startsWith('spans:') ? [r.slice('spans:'.length)] : []));
    expect(Object.keys(table ?? {}).sort()).toEqual([...read].sort());
  });

  it('a car whose status is absent has no entry; a retired one keeps its terms', () => {
    const view = (kind: string) => {
      const v = modelView([{ id: 0 }]);
      const byMachine = { ...v.situation.byMachine, 'car-status': [{ ...v.situation.byMachine['car-status']![0]!, kind }] };
      return { ...v, situation: { ...v.situation, byMachine } } as EngineView;
    };
    expect(calc.compute(view('absent'))[carId(0)]).toBeUndefined();
    expect(calc.compute(view('competing'))[carId(0)]).toBeDefined();
    void lap;
  });
});
