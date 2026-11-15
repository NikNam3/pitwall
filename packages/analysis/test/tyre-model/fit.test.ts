// The split of `tyre-model` (SP4.3c Task 12s, ruling R53; C31, C32, C41, C42): a calculator `tyre-model-fit` computes
// every term that does not depend on the current wear (per car the compound terms, the fresh sets, the type deltas,
// the fitted set's life span, our cars' used sets), on `onChange: ['laps']` plus 1 Hz; `tyre-model` keeps its per-frame
// cadence and its output type, reads the fit, and builds each car's output by structural sharing: the fit's objects as
// they are, new objects only for what depends on the wear and the carcass now (the fitted compound's heat-dependent
// rates and what follows from them, `fittedLapsToLimit`).
//
// "Today's output" is `tyre-model` on a view without the fit's output (its own computation, as the as-of form runs it).
import { carId, NOISE_COMPOUNDS, unknown, type CarId, type TyreModelOutput } from '@pitwall/domain';
import type { EngineView } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { carState, realismHidden } from '../../../../test-support/builders/index.ts';
import { input, quick, sched } from '../../../engine/test/support/scheduler.ts';
import { TYRE_MODEL, TYRE_MODEL_FIT, tyreModelCalculator, tyreModelFitCalculator } from '../../src/tyre-model/index.ts';
import { guardedQuick } from '../situated.ts';
import { ACTUAL, carOf, gainLaps, liveSets, modelView, tyreSet, type ModelCar } from './support.ts';

const model = guardedQuick(tyreModelCalculator);
const fit = guardedQuick(tyreModelFitCalculator);

/** `value` and everything it holds frozen, as the scheduler hands an output to its readers (a reader never changes it). */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value as object)) deepFreeze(v);
  }
  return value;
}

/** `view` with `fitOut` as the fit's output among its outputs. */
const withFit = (view: EngineView, fitOut: unknown): EngineView => ({ ...view, outputs: new Map([...view.outputs, [TYRE_MODEL_FIT, fitOut]]) });

/** The sets of the scenario, one object per car so two frames share them (no set change between them). */
const SETS = {
  inter: liveSets([tyreSet('inter', { fitted: true, wearPct: 10, usableLifeLaps: 30 }), tyreSet('medium'), tyreSet('hard', { usableLifeLaps: 40, lapDeltaMs: 500 })], 1_000),
  medium: liveSets([tyreSet('medium', { fitted: true, wearPct: 10 }), tyreSet('medium', { lapDeltaMs: -1_500 }), tyreSet('soft', { usableLifeLaps: 18, lapDeltaMs: -600 }), tyreSet('hard', { wearPct: 22 })], 1_000),
  hard: liveSets([tyreSet('hard', { fitted: true, usableLifeLaps: 40 }), tyreSet('medium'), tyreSet('soft', { available: false })], 1_000),
};

/** The scenario's laps: car 0 five laps on inters at a 70 °C carcass mean, car 1 five on mediums; car 2 none (2 %/lap each). */
const LAPS = [...gainLaps([2, 2, 2, 2, 2], { compound: 'inter', carcassMeanC: 70 }), ...gainLaps([2, 2, 2, 2, 2], { car: 1, carcassMeanC: 70 })];

/**
 * One frame of the scenario: car 0 (the player, a human) on inters whose carcass is `carcassC` now (the heat term), car 1
 * an AI on mediums with a measured rate, car 2 an AI on a fresh hard, car 3 a rival under realism, car 4 without sets
 * received; every car's live wear `wearPct`. Two frames differ only in the wear and the carcass now: no lap, no set change.
 */
function frame(wearPct: number, carcassC: number): EngineView {
  const cars: (ModelCar | ReturnType<typeof carState>)[] = [
    { id: 0, driver: 'human', compound: 'inter', age: 5, wearPct, carcassC, sets: SETS.inter },
    { id: 1, compound: 'medium', age: 5, wearPct, sets: SETS.medium },
    { id: 2, compound: 'hard', age: 0, wearPct: wearPct - 10, sets: SETS.hard },
    realismHidden(carState({ id: carId(3), tyres: { actualCompound: ACTUAL.medium, visualCompound: 'medium', age: 4 } })),
    { id: 4, compound: 'medium', wearPct, sets: unknown('notReceived') },
  ];
  return modelView(cars, { laps: LAPS, sessionTime: 5 * 90_000 + 30_000 });
}

const A = (): EngineView => frame(10, 90);
const B = (): EngineView => frame(10.4, 95);

describe('tyre-model-fit: the unit (ruling R53)', () => {
  it('is the quick calculator `tyre-model-fit`, apart from tyre-model, on a laps change and at 1 Hz', () => {
    expect(TYRE_MODEL_FIT).toBe('tyre-model-fit');
    expect(tyreModelFitCalculator.id).toBe(TYRE_MODEL_FIT);
    expect(tyreModelFitCalculator.kind).toBe('quick');
    expect(tyreModelFitCalculator.cadence).toEqual({ onChange: ['laps'], hz: 1 });
    // what the terms are computed from: the sets (live state), the laps, the two upstream calculators
    expect(tyreModelFitCalculator.reads).toEqual(expect.arrayContaining(['tyres', 'laps', 'stints', 'drivers']));
    expect(tyreModelFitCalculator.reads).toContainEqual({ calculator: 'degradation' });
    expect(tyreModelFitCalculator.reads).toContainEqual({ calculator: 'track-wetness' });
  });

  it('tyre-model keeps its per-frame cadence and reads the fit', () => {
    expect(tyreModelCalculator.cadence).toEqual({ onChange: ['laps', 'tyres'] });
    expect(tyreModelCalculator.reads).toContainEqual({ calculator: TYRE_MODEL_FIT });
  });

  it('the fit`s cadence through the scheduler: a laps change at once; a tyres change alone at most once a second of session time', () => {
    const s = sched([quick(TYRE_MODEL_FIT, { reads: ['laps', 'tyres'], cadence: tyreModelFitCalculator.cadence, compute: () => ({}) })]);
    const ran = (t: number, changed: Parameters<typeof input>[1]): boolean => s.run(input(t, changed)).ran.includes(TYRE_MODEL_FIT);
    expect(ran(0, ['tyres'])).toBe(true); // the first run
    expect([100, 200, 500, 900].map((t) => ran(t, ['tyres']))).toEqual([false, false, false, false]);
    expect(ran(1_000, ['tyres'])).toBe(true); // a second after its last run: a new set reaches it within a second
    expect(ran(1_100, ['laps'])).toBe(true); // a lap completed: at once
    expect(ran(1_200, ['tyres'])).toBe(false);
    expect(ran(2_100, ['timing'])).toBe(true);
  });
});

describe('tyre-model-fit: the output', () => {
  it('per car in the session, the terms that do not depend on the wear now: equal to tyre-model`s on the same view', () => {
    const view = A();
    const f = fit.compute(view) as Record<CarId, unknown>;
    const today = model.compute(view);
    for (const id of [0, 1, 2, 3, 4].map(carId)) {
      const t = today[id];
      expect(t, `car ${id}`).toBeDefined();
      expect(f[id], `car ${id}`).toMatchObject({
        compounds: t!.compounds,
        freshSets: t!.freshSets,
        typeDeltaMs: t!.typeDeltaMs,
        fittedLifeSpanLaps: t!.fittedLifeSpanLaps,
        usedSets: t!.usedSets,
      });
    }
    // a slot without a car-status span has none
    expect(f[carId(5)]).toBeUndefined();
  });

  it('a value the fit carries as of its run: the sets` own `at` (no set change, no new `at`)', () => {
    const f = fit.compute(A()) as Record<CarId, { freshSets: TyreModelOutput[CarId]['freshSets'] }>;
    expect(f[carId(1)]!.freshSets.medium).toEqual({ known: true, value: 1, at: 1_000 });
  });
});

describe('tyre-model on the fit`s output', () => {
  it('equals today`s output when the fit ran on the same view', () => {
    for (const view of [A(), B()]) {
      const f = deepFreeze(fit.compute(view));
      expect(model.compute(withFit(view, f))).toEqual(model.compute(view));
    }
  });

  it('on a later frame without a lap or set change, with the fit of the earlier one: equals today`s output on the later frame', () => {
    const f = deepFreeze(fit.compute(A()));
    const later = B();
    const out = model.compute(withFit(later, f));
    expect(out).toEqual(model.compute(later));
    // the wear and the carcass now moved what depends on them: the human's inter rates (heat), the fitted set's laps
    const earlier = model.compute(withFit(A(), f));
    expect(carOf(out, 0).compounds.inter.wearRatePct.fl).not.toEqual(carOf(earlier, 0).compounds.inter.wearRatePct.fl);
    expect(carOf(out, 1).fittedLapsToLimit).not.toEqual(carOf(earlier, 1).fittedLapsToLimit);
  });

  it('shares the fit`s objects by identity across two frames: everything that does not depend on the wear now', () => {
    const f = deepFreeze(fit.compute(A())) as Record<CarId, TyreModelOutput[CarId]>;
    const first = model.compute(withFit(A(), f));
    const second = model.compute(withFit(B(), f));
    for (const out of [first, second]) {
      for (const id of [0, 1, 2, 3, 4].map(carId)) {
        const car = carOf(out, id);
        const held = f[id]!;
        expect(car.freshSets, `car ${id} freshSets`).toBe(held.freshSets);
        expect(car.typeDeltaMs, `car ${id} typeDeltaMs`).toBe(held.typeDeltaMs);
        expect(car.fittedLifeSpanLaps, `car ${id} fittedLifeSpanLaps`).toBe(held.fittedLifeSpanLaps);
        expect(car.usedSets, `car ${id} usedSets`).toBe(held.usedSets);
      }
      // a compound the car is not on depends on no wear or carcass now: the fit's object as it is
      for (const c of NOISE_COMPOUNDS.filter((c) => c !== 'inter')) expect(carOf(out, 0).compounds[c], `car 0 ${c}`).toBe(f[carId(0)]!.compounds[c]);
      for (const c of NOISE_COMPOUNDS.filter((c) => c !== 'hard')) expect(carOf(out, 2).compounds[c], `car 2 ${c}`).toBe(f[carId(2)]!.compounds[c]);
      // an AI car's fitted compound has no heat term (research 20 §1): shared whole
      expect(carOf(out, 1).compounds.medium, 'car 1 medium').toBe(f[carId(1)]!.compounds.medium);
      // the human's fitted compound: a new object, but its fresh offset (no wear in it) is the fit's
      expect(carOf(out, 0).compounds.inter.freshOffsetMs).toBe(f[carId(0)]!.compounds.inter.freshOffsetMs);
    }
    // and so across the two frames
    expect(carOf(second, 2).compounds.medium).toBe(carOf(first, 2).compounds.medium);
    expect(carOf(second, 1).freshSets).toBe(carOf(first, 1).freshSets);
  });

  it('keeps `TYRE_MODEL` as the id of its output (no reader changes)', () => {
    expect(tyreModelCalculator.id).toBe(TYRE_MODEL);
  });
});
