// The 70 % limit (SP4.3c spec §5.2 "a hard rule", plan Task 12 rows 7 and 10; Review Focus 2; C43): `tyre-model` gives
// the rate and the limit, and every reader (`tyre-life`, `pit-window`, `forecast-field`) shows the same laps to it, run
// as a chain on one builder view: tyre-model → tyre-life → pit-window, and the starting point from tyre-model's output.
import { carId, known, NOISE_COMPOUNDS, tyreIndex, type MiniSectorCrossing, type PitWindow, type StartingPoint } from '@pitwall/domain';
import { asOfNow, type EngineView } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { pitWindowCalculator } from '../../src/pit-window/calculator.ts';
import { buildStartingPoint } from '../../src/shared/forecast-field/index.ts';
import { DRIVER_NOISE } from '../../src/driver-noise/index.ts';
import { RACE_INTERACTION } from '../../src/race-interaction/index.ts';
import { TYRE_LIFE } from '../../src/tyre-life/index.ts';
import { tyreLifeCalculator } from '../../src/tyre-life/calculator.ts';
import { TYRE_MODEL, tyreModelCalculator } from '../../src/tyre-model/index.ts';
import { crossings } from '../../../../test-support/builders/index.ts';
import { materialised, plainInteraction, plainNoise, TRACK } from '../shared/forecast-field/support.ts';
import { guardedQuick, openSpan } from '../situated.ts';
import { CORNERS, gainLaps, LAP_MS, liveSets, modelView, tyreSet, valueOf } from './support.ts';

const FLAG = 50;

/** The view of our car 0 (AI) on lap `lap` + 1 on mediums at `wearPct`, over `laps`; a fresh hard and a fresh medium left. */
function limitView(laps: ReturnType<typeof gainLaps>, wearPct: number, lap: number): EngineView {
  const view = modelView(
    [{ id: 0, compound: 'medium', age: laps.length, wearPct, sets: liveSets([tyreSet('medium', { fitted: true, wearPct }), tyreSet('hard', { usableLifeLaps: 40 }), tyreSet('medium')]) }],
    {
      laps,
      spans: [openSpan('compound-rule', 'required', { car: 0 }), openSpan('car-activity-race', 'racingLap', { car: 0, start: lap * LAP_MS })],
      sessionTime: lap * LAP_MS + 30_000,
    },
  );
  const cars = view.live.cars.map((c) => (c.id === carId(0) ? { ...c, timing: { ...c.timing, lap: lap + 1 } } : c));
  return { ...view, live: { ...view.live, cars, session: { ...view.live.session, totalLaps: FLAG } } };
}

/** The chain on `view`: tyre-model, then tyre-life on it, then pit-window on both (each through its guarded view, C41). */
function chain(view: EngineView) {
  const tm = guardedQuick(tyreModelCalculator).compute(view);
  const withTm = { ...view, outputs: new Map<string, unknown>([[TYRE_MODEL, tm]]) };
  const tl = guardedQuick(tyreLifeCalculator).compute(withTm);
  const withBoth = { ...view, outputs: new Map<string, unknown>([[TYRE_MODEL, tm], [TYRE_LIFE, tl]]) };
  const pw = guardedQuick(pitWindowCalculator).compute(withBoth)[carId(0)];
  if (pw === undefined || !pw.known) throw new Error(`no pit window: ${pw === undefined ? 'none' : pw.reason}`);
  return { tm, tl, pw: pw.value as PitWindow, outputs: withBoth.outputs };
}

describe('row 7: wear 50 %, rate 4 → 5 laps to the limit in every reader', () => {
  // laps 1–12 on mediums from 2 % at 4 % a lap: 50 % at the end of lap 12, the car on lap 13
  const laps = gainLaps(Array.from({ length: 12 }, () => 4), { startPct: 2 });
  const view = limitView(laps, 50, 12);

  it('tyre-model: the rate 4 %/lap measured, the limit 70 %; a fresh medium lasts 70 / 4 laps', () => {
    const { tm } = chain(view);
    const car = tm[carId(0)]!;
    for (const c of CORNERS) expect(valueOf(car.compounds.medium.wearRatePct[c])).toBeCloseTo(4, 9);
    expect(car.limitPct).toBe(70);
    expect(valueOf(car.compounds.medium.lapsToLimit)).toBeCloseTo(17.5, 6);
    // the fitted set's laps to the limit from its current wear (supervisor ruling: row 7's 5 is this field)
    expect(valueOf(car.fittedLapsToLimit)).toBeCloseTo(5, 9);
  });

  it('tyre-life: the set and every corner 5 laps to the limit, the rate tyre-model`s; the set`s is tyre-model`s fittedLapsToLimit', () => {
    const { tm, tl } = chain(view);
    const life = tl[carId(0)]!;
    expect(valueOf(life.lapsToLimit)).toBeCloseTo(5, 9);
    expect(life.lapsToLimit).toEqual(tm[carId(0)]!.fittedLapsToLimit);
    expect(life.limitPct).toBe(70);
    for (const c of CORNERS) {
      expect(valueOf(life.corners[c].lapsToLimit)).toBeCloseTo(5, 9);
      expect(valueOf(life.corners[c].ratePctPerLap)).toBeCloseTo(4, 9);
    }
  });

  it('pit-window: the latest stop is the limit, lap 13 + 5; a new hard is listed', () => {
    const { pw } = chain(view);
    expect(pw.currentLap).toBe(13);
    expect(pw.stint.latest).toMatchObject({ known: true, value: 18 });
    expect(pw.stint.pastLimit).toBe(false);
    expect(pw.sets.map((s) => s.compound)).toEqual(['hard']);
  });

  it("forecast-field: the starting point's wear and rate on the fitted compound give the same 5 laps; a fresh set's laps to the limit 17", () => {
    const { tm } = chain(view);
    // crossings of every lap so the leader is placed (lap 13 started)
    const lines: MiniSectorCrossing[] = [];
    for (let n = 1; n <= 12; n++) lines.push(...crossings(carId(0), n, LAP_MS, (n - 1) * LAP_MS));
    lines.push({ carId: carId(0), lap: 13, segment: 0, at: 12 * LAP_MS, frame: 12 * LAP_MS });
    const asOf = materialised(asOfNow({ ...view, history: { ...view.history, crossings: lines }, track: TRACK }));
    const outputs = new Map<string, unknown>([
      [TYRE_MODEL, tm],
      [DRIVER_NOISE, plainNoise(1, [], asOf.at)],
      [RACE_INTERACTION, plainInteraction(asOf.at)],
    ]);
    const built = buildStartingPoint(asOf, outputs);
    if (!built.known) throw new Error(`the starting point is unknown: ${built.reason}`);
    const sp: StartingPoint = built.value;
    const medium = NOISE_COMPOUNDS.indexOf('medium');
    const t = tyreIndex(0, medium);
    expect(sp.compound[0]).toBe(medium);
    expect(sp.wearPct[0]).toBeCloseTo(50, 9);
    expect(sp.tyre.wearRatePct[t]).toBeCloseTo(4, 9);
    expect((70 - sp.wearPct[0]!) / sp.tyre.wearRatePct[t]!).toBeCloseTo(5, 9);
    expect(sp.tyre.lapsToLimit[t]).toBe(17);
    // each compound its own terms (B5): the hard's are its prior, 0.86 × 70 / 40
    expect(sp.tyre.wearRatePct[tyreIndex(0, NOISE_COMPOUNDS.indexOf('hard'))]).toBeCloseTo((0.86 * 70) / 40, 9);
  });
});

describe('row 10: past the limit when the engine joins (Review Focus 2)', () => {
  // a restart: no lap of the car in the projection, its set already at 74 %
  const view = limitView([], 74, 30);

  it('tyre-model: the fitted set`s laps to the limit 0 (supervisor ruling: row 10`s 0 is this field)', () => {
    const { tm } = chain(view);
    expect(tm[carId(0)]!.fittedLapsToLimit).toMatchObject({ known: true, value: 0 });
  });

  it('tyre-life: laps to the limit 0, the set and every corner', () => {
    const { tl } = chain(view);
    const life = tl[carId(0)]!;
    expect(life.lapsToLimit).toMatchObject({ known: true, value: 0 });
    for (const c of CORNERS) expect(life.corners[c].lapsToLimit).toMatchObject({ known: true, value: 0 });
  });

  it('pit-window: stop now (the latest stop is this lap, past the limit, a stop needed)', () => {
    const { pw } = chain(view);
    expect(pw.stint.latest).toMatchObject({ known: true, value: pw.currentLap });
    expect(pw.stint.pastLimit).toBe(true);
    expect(pw.stint.stopNeeded).toMatchObject({ known: true, value: true });
  });

  it('tyre-model gives its rate from the prior (no lap yet), never a stint past the limit', () => {
    const { tm } = chain(view);
    const medium = tm[carId(0)]!.compounds.medium;
    expect(medium.wearRatePct.fl.source).toBe('game');
    expect(valueOf(medium.lapsToLimit)).toBeCloseTo(28 / 0.86, 6);
    void known;
  });
});
