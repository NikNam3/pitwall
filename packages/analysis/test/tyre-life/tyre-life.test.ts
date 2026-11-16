// `tyre-life` (spec 4.2; SP4.3c Task 12, O1): a reader of `tyre-model`. Per car its set now: per corner the wear now
// (the live state's), the rate (`tyre-model`'s for the fitted compound and corner) and the laps until `tyre-model`'s limit
// (0 at or past it); the set's laps to the limit and its game life span, both `tyre-model`'s.
//
// Ported in SP4.3c Task 12 (C82): the rate-lap cases (which laps count, the current stint, a new set, engine-shaped
// history) moved with the rate to `test/tyre-model/tyre-model.test.ts`; the age basis, the fresh-set life per compound,
// the wear-rate priors, the age-loss limit and `minLaps` were deleted with their mechanisms (spec §5.2 "Deletes": the
// prior covers a stint's first laps, and a set past the limit at a restart is 0 laps from it, Review Focus 2). The
// limit is `tyre-model`'s (`limitPct`). `tyre-model`'s output is passed explicitly (C84). Supervisor ruling (95a9a1b4):
// the set's laps to the limit is `tyre-model`'s `fittedLapsToLimit` and its game life span `tyre-model`'s
// `fittedLifeSpanLaps` (tyre-life reads no tyre set: the owners guard's "tyre rates, offsets and availability" row).
import { carId, known, unknown, type CarState, type Corners, type NoiseCompound, type Percent, type TyreModelCar, type TyreModelOutput } from '@pitwall/domain';
import type { EngineView } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import * as tyreLifeUnit from '../../src/tyre-life/index.ts';
import { TYRE_LIFE } from '../../src/tyre-life/index.ts';
import { tyreLifeCalculator } from '../../src/tyre-life/calculator.ts';
import { TYRE_MODEL } from '../../src/tyre-model/index.ts';
import { tyreModelCalculator } from '../../src/tyre-model/calculator.ts';
import { lapsToLimitOf } from '../../src/shared/tyre-prior.ts';
import { carState, realismHidden } from '../../../../test-support/builders/index.ts';
import { guardedQuick, NONE, PRACTICE, QUALIFYING, situatedView } from '../situated.ts';
import { carOf as carOfModel, liveSets, modelView, plainModelCar, tyreSet } from '../tyre-model/support.ts';

/** The calculator through its guarded view (C41): every case fails on a read it does not declare. */
const calc = guardedQuick(tyreLifeCalculator);

const CORNERS = ['fl', 'fr', 'rl', 'rr'] as const;
const everyCorner = <T>(make: () => T): Corners<T> => ({ fl: make(), fr: make(), rl: make(), rr: make() });

/** Car `id` with live wear `now` on every corner (or per corner), on soft C3 (default) at age `age`. */
const carWithWear = (now: number | Corners<number>, o: { id?: number; age?: number; visualCompound?: NoiseCompound } = {}): CarState => {
  const w = typeof now === 'number' ? { fl: now, fr: now, rl: now, rr: now } : now;
  return carState({
    id: carId(o.id ?? 0),
    tyres: {
      age: o.age ?? 3,
      ...(o.visualCompound !== undefined && { visualCompound: o.visualCompound }),
      corners: { fl: { wearPct: known(w.fl as Percent, 0) }, fr: { wearPct: known(w.fr as Percent, 0) }, rl: { wearPct: known(w.rl as Percent, 0) }, rr: { wearPct: known(w.rr as Percent, 0) } },
    },
  });
};

/**
 * A model car whose `compound` wears `rates` per corner (every other compound 2 %/lap), the limit `limitPct`, the fitted
 * set's laps to the limit `fittedLapsToLimit` (default `insufficientData`: the per-corner cases do not read it).
 */
function modelWith(compound: NoiseCompound, rates: number | Corners<number>, limitPct = 70, fittedLapsToLimit?: number): TyreModelCar {
  const car = plainModelCar({ limitPct, ...(fittedLapsToLimit !== undefined && { fittedLapsToLimit }) });
  const r = typeof rates === 'number' ? { fl: rates, fr: rates, rl: rates, rr: rates } : rates;
  const terms = car.compounds[compound];
  return {
    ...car,
    compounds: { ...car.compounds, [compound]: { ...terms, wearRatePct: { fl: { value: known(r.fl, 90_000), source: 'measured' }, fr: { value: known(r.fr, 90_000), source: 'measured' }, rl: { value: known(r.rl, 90_000), source: 'measured' }, rr: { value: known(r.rr, 90_000), source: 'measured' } } } },
  };
}

/** `tyre-model`'s output as the view's `outputs` hold it. */
const upstream = (model: TyreModelOutput): EngineView['outputs'] => new Map([[TYRE_MODEL, model]]);

const viewOf = (cars: CarState[], model: TyreModelOutput, o: Partial<Parameters<typeof situatedView>[0]> = {}): EngineView => situatedView({ cars, outputs: upstream(model), ...o });

const run = (view: EngineView) => calc.compute(view)[carId(0)]!;

describe('tyre-life calculator (a reader of tyre-model)', () => {
  it('is the quick calculator `tyre-life` at 4 Hz over tyre-model, the tyres and car-status; no session, no degradation (the age basis is gone)', () => {
    expect(tyreLifeCalculator.id).toBe(TYRE_LIFE);
    expect(tyreLifeCalculator.kind).toBe('quick');
    expect(tyreLifeCalculator.cadence).toEqual({ hz: 4 });
    expect(tyreLifeCalculator.reads).toEqual(expect.arrayContaining(['tyres', 'spans:car-status']));
    expect(tyreLifeCalculator.reads).toContainEqual({ calculator: TYRE_MODEL });
    expect(tyreLifeCalculator.reads).not.toContainEqual({ calculator: 'degradation' });
    expect(tyreLifeCalculator.reads).not.toContain('session');
  });

  it('the rate is tyre-model`s for the fitted compound: 2 %/lap at 11 % → 29.5 laps to the 70 % limit on every corner', () => {
    const out = run(viewOf([carWithWear(11)], { [carId(0)]: modelWith('soft', 2) }));
    for (const corner of CORNERS) {
      expect(out.corners[corner].wearPct).toEqual({ known: true, value: 11, at: 0 });
      expect(out.corners[corner].ratePctPerLap).toMatchObject({ known: true, value: 2 });
      expect(out.corners[corner].lapsToLimit).toMatchObject({ known: true, value: 29.5 });
    }
    expect(out.limitPct).toBe(70);
  });

  it('each corner has its own rate: fl 2, fr 3, rl 1, rr 4 at 6 % → (70 − 6) / 4 = 16 laps at rr; the set`s 16 (tyre-model`s)', () => {
    const out = run(viewOf([carWithWear(6)], { [carId(0)]: modelWith('soft', { fl: 2, fr: 3, rl: 1, rr: 4 }, 70, 16) }));
    expect(out.corners.fl.ratePctPerLap).toMatchObject({ known: true, value: 2 });
    expect(out.corners.fr.ratePctPerLap).toMatchObject({ known: true, value: 3 });
    expect(out.corners.rl.ratePctPerLap).toMatchObject({ known: true, value: 1 });
    expect(out.corners.rr.lapsToLimit).toMatchObject({ known: true, value: 16 });
    expect(out.lapsToLimit).toMatchObject({ known: true, value: 16 });
  });

  it('the set`s laps to the limit is tyre-model`s fittedLapsToLimit as it is (tyre-life judges no second one, C43)', () => {
    // tyre-model says 12.5 although the live wear and rate here would give 29.5: tyre-life shows tyre-model's
    expect(run(viewOf([carWithWear(11)], { [carId(0)]: modelWith('soft', 2, 70, 12.5) })).lapsToLimit).toEqual(known(12.5, 0));
    const unknownFitted: TyreModelCar = { ...modelWith('soft', 2), fittedLapsToLimit: unknown('restricted') };
    expect(run(viewOf([carWithWear(11)], { [carId(0)]: unknownFitted })).lapsToLimit).toEqual(unknown('restricted'));
  });

  it('the rate of the fitted compound only: a medium fitted reads the medium terms', () => {
    const model = modelWith('medium', 4);
    const out = run(viewOf([carWithWear(10, { visualCompound: 'medium' })], { [carId(0)]: model }));
    expect(out.corners.fl.ratePctPerLap).toMatchObject({ known: true, value: 4 });
    expect(out.corners.fl.lapsToLimit).toMatchObject({ known: true, value: 15 });
  });

  it('the limit is tyre-model`s: limitPct 80 → (80 − 10) / 2 = 35 laps', () => {
    const out = run(viewOf([carWithWear(10)], { [carId(0)]: modelWith('soft', 2, 80) }));
    expect(out.limitPct).toBe(80);
    expect(out.corners.fl.lapsToLimit).toMatchObject({ known: true, value: 35 });
  });

  it('at or past the limit the laps to it are 0, so the wear alarm stays raised (also with no lap of the stint yet: a restart)', () => {
    for (const wear of [70, 76]) {
      const out = run(viewOf([carWithWear(wear, { age: 0 })], { [carId(0)]: modelWith('soft', 2, 70, 0) }));
      expect(out.corners.fl.lapsToLimit, `${wear} %`).toMatchObject({ known: true, value: 0 });
      expect(out.lapsToLimit, `${wear} %`).toMatchObject({ known: true, value: 0 });
    }
  });

  it('a rate tyre-model does not know leaves the laps to the limit unknown with its reason; the wear stays known (C3)', () => {
    const model = plainModelCar();
    const unknownRate = { ...model, compounds: { ...model.compounds, soft: { ...model.compounds.soft, wearRatePct: everyCorner(() => ({ value: unknown('notReceived'), source: 'default' as const })) } } };
    const out = run(viewOf([carWithWear(10)], { [carId(0)]: unknownRate }));
    expect(out.corners.fl.ratePctPerLap).toEqual(unknown('notReceived'));
    expect(out.corners.fl.lapsToLimit).toEqual(unknown('notReceived'));
    expect(out.corners.fl.wearPct).toMatchObject({ known: true, value: 10 });
  });

  it('gameLifeSpanLaps is tyre-model`s fittedLifeSpanLaps; unknown with its reason', () => {
    const model: TyreModelCar = { ...modelWith('soft', 2), fittedLifeSpanLaps: known(22, 1_000) };
    expect(run(viewOf([carWithWear(6)], { [carId(0)]: model })).gameLifeSpanLaps).toEqual({ known: true, value: 22, at: 1_000 });
    expect(run(viewOf([carWithWear(6)], { [carId(0)]: modelWith('soft', 2) })).gameLifeSpanLaps).toEqual({ known: false, reason: 'notReceived' });
  });

  it('reads no tyre set: live sets that contradict tyre-model change nothing', () => {
    const base = carWithWear(6);
    const car: CarState = { ...base, tyres: { ...base.tyres, sets: liveSets([tyreSet('soft', { fitted: true, lifeSpanLaps: 9 })]) } };
    const model: TyreModelCar = { ...modelWith('soft', 2, 70, 32), fittedLifeSpanLaps: known(30, 0) };
    const out = run(viewOf([car], { [carId(0)]: model }));
    expect(out.gameLifeSpanLaps).toEqual(known(30, 0));
    expect(out).toEqual(run(viewOf([base], { [carId(0)]: model })));
  });

  it('realism: a rival`s wear and laps to the limit are unknown(realism); its rate is tyre-model`s (our car`s game values, row 9)', () => {
    const hidden = unknown('realism');
    const rivalModel: TyreModelCar = { ...modelWith('soft', 2.15), fittedLapsToLimit: hidden, fittedLifeSpanLaps: hidden };
    const view = viewOf([carWithWear(6), realismHidden(carState({ id: carId(1) }))], { [carId(0)]: modelWith('soft', 2), [carId(1)]: rivalModel });
    const out = calc.compute(view);
    for (const corner of CORNERS) {
      expect(out[carId(1)]!.corners[corner].wearPct).toEqual(hidden);
      expect(out[carId(1)]!.corners[corner].lapsToLimit).toEqual(hidden);
      expect(out[carId(1)]!.corners[corner].ratePctPerLap).toMatchObject({ known: true, value: 2.15 });
    }
    expect(out[carId(1)]!.gameLifeSpanLaps).toEqual(hidden);
    expect(out[carId(1)]!.lapsToLimit).toEqual(hidden);
    // our own car is unaffected
    expect(out[carId(0)]!.corners.fl.ratePctPerLap).toMatchObject({ known: true, value: 2 });
  });

  it('keeps cars apart and gives no entry to a slot without a car in the session (no car-status span)', () => {
    const view = viewOf([carWithWear(4), carWithWear(9, { id: 1 })], { [carId(0)]: modelWith('soft', 2), [carId(1)]: modelWith('soft', 3) });
    const out = calc.compute(view);
    expect(out[carId(0)]!.corners.fl.ratePctPerLap).toMatchObject({ value: 2 });
    expect(out[carId(1)]!.corners.fl.ratePctPerLap).toMatchObject({ value: 3 });
    expect(out[carId(2)]).toBeUndefined();
  });

  describe('behaviour table (C44): a row per car-status kind', () => {
    it('exports TYRE_LIFE_BEHAVIOUR over car-status alone, the one sub-machine it reads', () => {
      const table = (tyreLifeUnit as unknown as Record<string, object | undefined>)['TYRE_LIFE_BEHAVIOUR'];
      expect(table).toBeDefined();
      expect(Object.keys(table ?? {})).toEqual(['car-status']);
    });

    const statusView = (kind: string) => viewOf([carWithWear(6)], { [carId(0)]: modelWith('soft', 2) }, { status: { 0: kind } });

    it('competing: the car has its wear, rate and laps to the limit', () => {
      const out = calc.compute(statusView('competing'))[carId(0)];
      expect(out?.corners.fl.wearPct).toEqual({ known: true, value: 6, at: 0 });
      expect(out?.corners.fl.ratePctPerLap).toMatchObject({ known: true, value: 2 });
      expect(out?.corners.fl.lapsToLimit).toMatchObject({ known: true, value: 32 });
    });

    it('retired and disqualified: the car is still in the session and keeps its entry', () => {
      for (const kind of ['retired', 'disqualified']) expect(calc.compute(statusView(kind))[carId(0)]?.corners.fl.ratePctPerLap, kind).toMatchObject({ known: true, value: 2 });
    });

    it('absent: no entry', () => {
      expect(calc.compute(statusView('absent'))[carId(0)]).toBeUndefined();
    });
  });

  it('runs in every weekend phase without reading the session', () => {
    for (const phase of [PRACTICE, QUALIFYING, NONE]) {
      expect(run(viewOf([carWithWear(6)], { [carId(0)]: modelWith('soft', 2) }, { phase })).corners.fl.ratePctPerLap, phase.kind).toMatchObject({ known: true, value: 2 });
    }
  });

  it('the deleted mechanisms are gone from the output: no basis, no age-loss limit, no fresh-set life (tyre-model`s lapsToLimit per compound)', () => {
    const out = run(viewOf([carWithWear(6)], { [carId(0)]: modelWith('soft', 2) })) as unknown as Record<string, unknown>;
    for (const key of ['basis', 'ageLossLimitMs', 'freshLifeLaps']) expect(out, key).not.toHaveProperty(key);
  });
});

describe('fix round 2: the limit and the laps to it are tyre-model`s (C43, C47, C3)', () => {
  it('without tyre-model`s car the laps to the limit are unknown(insufficientData): no limit of tyre-life`s own (no literal 70)', () => {
    // 10 % and 76 % wear: with a literal 70 % limit the second would read 0 laps
    for (const wear of [10, 76]) {
      const out = run(viewOf([carWithWear(wear)], {}));
      for (const corner of CORNERS) {
        expect(out.corners[corner].lapsToLimit, `${wear} % ${corner}`).toEqual(unknown('insufficientData'));
        // the wear stays the live state's
        expect(out.corners[corner].wearPct, `${wear} % ${corner}`).toEqual({ known: true, value: wear, at: 0 });
      }
      expect(out.lapsToLimit, `${wear} %`).toEqual(unknown('insufficientData'));
    }
  });

  it('tyre-life and tyre-model give equal laps to the limit, both lapsToLimitOf over tyre-model`s rates and limit', () => {
    const modelCalc = guardedQuick(tyreModelCalculator);
    const cases: { wear: Corners<number>; usableLifeLaps: number }[] = [
      { wear: { fl: 10, fr: 12, rl: 6, rr: 20 }, usableLifeLaps: 28 },
      { wear: { fl: 0, fr: 0, rl: 0, rr: 0 }, usableLifeLaps: 40 },
      { wear: { fl: 64, fr: 71, rl: 30, rr: 69.5 }, usableLifeLaps: 22 },
    ];
    for (const { wear, usableLifeLaps } of cases) {
      const worst = Math.max(wear.fl, wear.fr, wear.rl, wear.rr);
      const base = modelView([{ id: 0, compound: 'medium', wearPct: wear, sets: liveSets([tyreSet('medium', { fitted: true, wearPct: worst, usableLifeLaps })]) }]);
      const model = carOfModel(modelCalc.compute(base), 0);
      const life = run({ ...base, outputs: upstream({ [carId(0)]: model }) });
      expect(life.limitPct).toBe(model.limitPct);
      const medium = model.compounds.medium;
      for (const corner of CORNERS) {
        const rate = medium.wearRatePct[corner].value;
        const expected = lapsToLimitOf(known(wear[corner], 0), rate, model.limitPct);
        expect(life.corners[corner].lapsToLimit, `${corner}`).toEqual(expected);
      }
      // the set's laps: the fewest corner's, tyre-model's and tyre-life's alike
      const fewest = Math.min(...CORNERS.map((c) => (life.corners[c].lapsToLimit.known ? (life.corners[c].lapsToLimit as { value: number }).value : Infinity)));
      expect(model.fittedLapsToLimit).toMatchObject({ known: true });
      expect((model.fittedLapsToLimit as { value: number }).value).toBeCloseTo(fewest, 9);
      expect(life.lapsToLimit).toEqual(model.fittedLapsToLimit);
      // a fresh set's laps (the compound's): lapsToLimitOf from 0 % at the worst corner's rate
      const worstRate = Math.max(...CORNERS.map((c) => (medium.wearRatePct[c].value as { value: number }).value));
      const fresh = lapsToLimitOf(known(0, 0), known(worstRate, 0), model.limitPct);
      expect(medium.lapsToLimit).toMatchObject({ known: true });
      expect((medium.lapsToLimit as { value: number }).value).toBeCloseTo((fresh as { value: number }).value, 9);
    }
  });
});
