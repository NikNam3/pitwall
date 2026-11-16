// `rejoin` (SP4.2 spec 3.2, 6.1): our car as if it were in the pit lane now, per condition (green, VSC, SC). For every
// other car X, `t_X = behind_X − loss[c]` (SP4.3d1 Task 7, spec §6.5: its time behind us on our crossing history,
// `now − timeAtProgress(ours, its live progress)`, modulo one of our laps; in a built race at one pace that is its gap
// to us at the same point of the road), on every frame; the physical order sorts by `t`, the ghost at 0; the rejoin position is our position plus the cars on our lap
// behind us within the loss; each row's interval is its `t` minus the row ahead's (the first row against the car ahead
// of it in the full order). The map point is `rejoin-ghost`'s (SP4.3c §5.7, O18; the map-point cases moved to its
// tests). Built races (`field.ts`); every case runs through the guarded view (C41); race only (C14); our cars only.
import { carId, known, unknown, type CarId, type CrossingRow, type Known, type PitCondition } from '@pitwall/domain';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { GAPS } from '../../src/gaps/index.ts';
import { PIT_LOSS } from '../../src/pit-loss/index.ts';
import { REJOIN_BEHAVIOUR } from '../../src/rejoin/behaviour.ts';
import { rejoinCalculator } from '../../src/rejoin/calculator.ts';
import { REJOIN, REJOIN_CONFIG, type Rejoin, type RejoinAt, type RejoinOutput } from '../../src/rejoin/index.ts';
import { guardedQuick } from '../situated.ts';
import { loadUnitFolders } from '../units.ts';
import { INSUFFICIENT, NOT_APPLICABLE, NOW, rejoinCase, SOURCES, US, type Field, type RejoinCase } from './field.ts';

const calc = guardedQuick(rejoinCalculator);

const CONDITIONS: readonly PitCondition[] = ['green', 'vsc', 'sc'];

const outputOf = (o: RejoinCase = {}): RejoinOutput => calc.compute(rejoinCase(o).view);

/** Car `car`'s `rejoin.car` value; it must be present. */
const rejoinOf = (out: RejoinOutput, car: number = US): Rejoin => {
  const r = out.cars[carId(car)];
  if (r === undefined) throw new Error(`no rejoin entry for car ${car}`);
  return r;
};

/** Car `car`'s answer under `condition`. */
const at = (o: RejoinCase, condition: PitCondition = 'green', car: number = US): RejoinAt => rejoinOf(outputOf(o), car).conditions[condition];

const valueOf = <T>(k: Known<T>): T => {
  if (!k.known) throw new Error(`unknown: ${k.reason}`);
  return k.value;
};

/** The rows of an order: a car's id as a number, the ghost as `'ghost'`. */
const ids = (rows: readonly CrossingRow[]): (number | 'ghost')[] => rows.map((r) => (r.ghost ? 'ghost' : (r.carId as number)));

/** A row's interval as a number. */
const intervals = (rows: readonly CrossingRow[]): number[] => rows.map((r) => valueOf(r.intervalMs));

const rowOf = (rows: readonly CrossingRow[], car: number): CrossingRow => {
  const row = rows.find((r) => !r.ghost && r.carId === carId(car));
  if (row === undefined) throw new Error(`no row of car ${car}`);
  return row;
};

/** A car's `t` in an order (the ghost's is 0): the sum of the intervals between the ghost and its row. */
const tOf = (rows: readonly CrossingRow[], car: number): number => {
  const g = rows.findIndex((r) => r.ghost);
  const k = rows.findIndex((r) => !r.ghost && r.carId === carId(car));
  if (g < 0 || k < 0) throw new Error(`no ghost or no row of car ${car}`);
  const sum = (from: number, to: number) => intervals(rows.slice(from, to)).reduce((a, b) => a + b, 0);
  return k > g ? sum(g + 1, k + 1) : -sum(k + 1, g + 1);
};

const ghostOf = (rows: readonly CrossingRow[]): CrossingRow => {
  const ghosts = rows.filter((r) => r.ghost);
  expect(ghosts).toHaveLength(1);
  return ghosts[0]!;
};

describe('rejoin calculator', () => {
  it('is the quick analysis `rejoin` on every frame (SP4.3d1 Task 7), over gaps, pit-loss, the weekend phase, car activity and car status', () => {
    expect(rejoinCalculator.id).toBe(REJOIN);
    expect(rejoinCalculator.kind).toBe('quick');
    expect(rejoinCalculator.cadence).toBe('frame');
    expect(rejoinCalculator.reads).toEqual(
      expect.arrayContaining([{ calculator: GAPS }, { calculator: PIT_LOSS }, 'spans:weekend-phase', 'spans:car-activity-race', 'spans:car-status']),
    );
  });

  it("the ghost lines' input: the gaps output, each condition's loss, our cars and `ghostLaps`", () => {
    const { view, gaps } = rejoinCase({ teammate: 8 });
    const out = calc.compute(view);
    expect(out.ghost.gaps).toEqual(gaps);
    expect(out.ghost.losses).toEqual({ green: known(20_300, 0), vsc: known(13_100, 0), sc: known(9_800, 0) });
    expect(out.ghost.ourCars).toEqual([carId(US), carId(8)]);
    expect(out.ghost.ghostLaps).toBe(REJOIN_CONFIG.defaults.ghostLaps);
  });

  // 1
  it('P6, cars behind at +3.1, +12.0, +19.9, +24.0 s, green loss 20 300: rejoin P9, the ghost between P9 (t −400) and P10 (t +3 700)', () => {
    const r = rejoinOf(outputOf());
    expect(r.carId).toBe(carId(US));
    expect(r.position).toBe(6);
    const green = r.conditions.green;
    expect(green.condition).toBe('green');
    expect(green.lossMs).toMatchObject({ known: true, value: 20_300 });
    expect(green.rejoinPosition).toMatchObject({ known: true, value: 9 });
    const rows = valueOf(green.order);
    // t: car 5 −21 300 (the car ahead of the first row), 6 −17 200, 7 −8 300, 8 −400, ghost 0, 9 +3 700, 10 +9 700, 11 +14 700
    expect(ids(rows)).toEqual([6, 7, 8, 'ghost', 9, 10, 11]);
    expect(intervals(rows)).toEqual([4_100, 8_900, 7_900, 400, 3_700, 6_000, 5_000]);
    const ghost = ghostOf(rows);
    expect(ghost.carId).toBe(carId(US));
    expect(ghost.position).toBe(9);
    // the cars behind the ghost keep their race positions
    expect([9, 10, 11].map((c) => rowOf(rows, c).position)).toEqual([10, 11, 12]);
  });

  // 2
  it('loss 0: the rejoin position is our position and the ghost sits between the same cars as our car', () => {
    const green = at({ losses: { green: 0 } });
    expect(green.rejoinPosition).toMatchObject({ known: true, value: 6 });
    const rows = valueOf(green.order);
    expect(ids(rows)).toEqual([3, 4, 5, 'ghost', 6, 7, 8]);
    expect(intervals(rows)).toEqual([1_000, 1_000, 1_000, 1_000, 3_100, 8_900, 7_900]);
    expect(ghostOf(rows).position).toBe(6);
  });

  it('property: a stop never improves our position, and a larger loss never gives a better one', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 1, max: 600 }), { minLength: 1, maxLength: 8 }),
        fc.integer({ min: 0, max: 400 }),
        fc.integer({ min: 0, max: 400 }),
        (behind, a, b) => {
          // two cars ahead, we at 2 000, the others behind by multiples of 100 ms
          const field: Field = { 1: 0, 2: 1_000, 0: 2_000, ...Object.fromEntries(behind.map((g, i) => [i + 3, 2_000 + g * 100])) };
          const [small, large] = a <= b ? [a * 100, b * 100] : [b * 100, a * 100];
          const position = (loss: number) => valueOf(at({ field, now: 300_000, losses: { green: loss } }).rejoinPosition);
          const p0 = position(0);
          const pSmall = position(small);
          const pLarge = position(large);
          // with no loss we rejoin P3, unless a car is within the pit-exit yield window (minGapMs 500, B8): then we rejoin
          // 500 ms behind the first of them, behind every car that crosses before that
          const first = Math.min(...behind.map((g) => g * 100));
          const rejoinAt = first < 500 ? first + 500 : 0;
          expect(p0).toBe(3 + behind.filter((g) => g * 100 < rejoinAt).length);
          expect(pSmall).toBeGreaterThanOrEqual(p0);
          expect(pLarge).toBeGreaterThanOrEqual(pSmall);
        },
      ),
      { numRuns: 30 },
    );
  });

  // 3
  it("SC 9 800 and VSC 13 100 from pit-loss: rejoin P7 and P8, each condition with pit-loss's loss and source", () => {
    const r = rejoinOf(outputOf());
    expect(r.conditions.vsc.rejoinPosition).toMatchObject({ known: true, value: 8 });
    expect(r.conditions.sc.rejoinPosition).toMatchObject({ known: true, value: 7 });
    expect(r.conditions.vsc.lossMs).toMatchObject({ known: true, value: 13_100 });
    expect(r.conditions.sc.lossMs).toMatchObject({ known: true, value: 9_800 });
    for (const c of CONDITIONS) {
      expect(r.conditions[c].condition).toBe(c);
      expect(r.conditions[c].lossSource).toEqual(SOURCES[c]);
    }
    // SC: t of car 6 −6 700, car 7 +2 200: the ghost right behind car 6
    expect(ids(valueOf(r.conditions.sc.order))).toEqual([4, 5, 6, 'ghost', 7, 8, 9]);
  });

  // 4
  it('a car a lap down 5 s behind us is in the order but does not count; a car a lap up stays ahead', () => {
    // car 1 a lap and 5 s ahead of us (lapsDown −1), we P2, car 2 +3 s, car 3 a lap and 5 s behind (lapsDown 1, gap 5 s)
    const field: Field = { 1: 5_000, 0: 100_000, 2: 103_000, 3: 195_000 };
    const withLapped = at({ field, now: 335_000 });
    const without = at({ field: { 1: 5_000, 0: 100_000, 2: 103_000 }, now: 335_000 });
    expect(withLapped.rejoinPosition).toMatchObject({ known: true, value: 3 });
    expect(without.rejoinPosition).toEqual(withLapped.rejoinPosition);
    const rows = valueOf(withLapped.order);
    // t: car 1 −25 300, car 2 −17 300, car 3 −15 300
    expect(ids(rows)).toEqual([1, 2, 3, 'ghost']);
    expect(rowOf(rows, 1).intervalMs).toEqual(NOT_APPLICABLE);
    expect(intervals(rows.slice(1))).toEqual([8_000, 2_000, 15_300]);
  });

  // 5
  it('`orderAround` 3: at most 3 rows either side of the ghost; config 2: at most 2', () => {
    expect(ids(valueOf(at({}).order))).toEqual([6, 7, 8, 'ghost', 9, 10, 11]);
    expect(ids(valueOf(at({ config: { [REJOIN_CONFIG.key]: { orderAround: 2 } } }).order))).toEqual([7, 8, 'ghost', 9, 10]);
    // a loss beyond the last car: every car ahead of the ghost, 3 rows before it and none after
    expect(ids(valueOf(at({ losses: { green: 60_000 } }).order))).toEqual([9, 10, 11, 'ghost']);
  });

  // 6
  it("`rejoin.car` has no map point (the map's ghost is `rejoin-ghost`'s, SP4.3c §5.7, O18): each condition is its loss, source, rejoin position and order", () => {
    const r = rejoinOf(outputOf());
    for (const c of CONDITIONS) expect(Object.keys(r.conditions[c]).sort(), c).toEqual(['condition', 'lossMs', 'lossSource', 'order', 'rejoinPosition']);
    // without a track file the same: the track file is no input of `rejoin`'s order or position
    const none = rejoinOf(outputOf({ track: unknown('notApplicable') }));
    for (const c of CONDITIONS) expect(none.conditions[c], c).toEqual(r.conditions[c]);
  });

  // 7
  it('our crossings span less than the loss: the order still known; no crossing of ours: all `insufficientData`', () => {
    // first lap: our crossings from 5 000 to 19 400, 14 400 ms, under the green loss of 20 300
    const early = at({ now: 20_000 });
    expect(early.order.known).toBe(true);
    expect(early.rejoinPosition.known).toBe(true);
    const r = rejoinOf(outputOf({ without: [US] }));
    for (const c of CONDITIONS) {
      expect(r.conditions[c].rejoinPosition, c).toEqual(INSUFFICIENT);
      expect(r.conditions[c].order, c).toEqual(INSUFFICIENT);
    }
  });

  // 8
  it('our car in a box stop, on its out lap or serving a penalty: absent; on a racing lap or its in lap: present', () => {
    for (const kind of ['boxStop', 'outLap', 'servingPenalty']) expect(outputOf({ activity: { [US]: kind } }).cars[carId(US)], kind).toBeUndefined();
    for (const kind of ['racingLap', 'inLap']) expect(outputOf({ activity: { [US]: kind } }).cars[carId(US)], kind).toBeDefined();
  });

  // 9
  it('both our cars: two entries; the teammate is a row in the player\'s order, and the player in the teammate\'s', () => {
    // the teammate: car 8, P9, +19.9 s
    const out = outputOf({ teammate: 8 });
    expect(Object.keys(out.cars).map(Number).sort((a, b) => a - b)).toEqual([US, 8]);
    const player = valueOf(rejoinOf(out).conditions.green.order);
    expect(rowOf(player, 8).ghost).toBe(false);
    const mate = rejoinOf(out, 8);
    expect(mate.carId).toBe(carId(8));
    expect(mate.position).toBe(9);
    const mateRows = valueOf(mate.conditions.green.order);
    expect(ghostOf(mateRows).carId).toBe(carId(8));
    // t of the cars around the teammate's ghost: car 0 −40 200, 6 −37 100, 7 −28 200, 9 −16 200, 10 −10 200, 11 −5 200
    expect(ids(mateRows)).toEqual([9, 10, 11, 'ghost']);
    expect(mate.conditions.green.rejoinPosition).toMatchObject({ known: true, value: 12 });
    // six rows ahead of the teammate's ghost reach the player
    const wide = rejoinOf(outputOf({ teammate: 8, config: { [REJOIN_CONFIG.key]: { orderAround: 6 } } }), 8);
    const wideRows = valueOf(wide.conditions.green.order);
    expect(ids(wideRows)).toEqual([US, 6, 7, 9, 10, 11, 'ghost']);
    expect(rowOf(wideRows, US).ghost).toBe(false);
  });

  // 10
  it('a rival is absent; practice and qualifying give no entry', () => {
    const out = outputOf();
    expect(Object.keys(out.cars).map(Number)).toEqual([US]);
    expect(out.cars[carId(6) as CarId]).toBeUndefined();
    expect(outputOf({ kind: 'practice' }).cars).toEqual({});
    expect(outputOf({ kind: 'qualifying' }).cars).toEqual({});
  });

  // SP4.3d1 Task 7 row 4
  it('a stopped car: 5 s stopped puts it 5 s further behind on our scale, and the rejoin position changes on the frame it passes the ghost', () => {
    // the standard field without car 9: car 8 at +19.9 s (t −400 under green 20 300), car 10 at +30.0 s, car 11 at +35.0 s;
    // car 8 stops at STOP and stays there while the field and our car run on; nobody reaches it within 6 s
    const field: Field = { 1: 0, 2: 1_000, 3: 2_000, 4: 3_000, 5: 4_000, 0: 5_000, 6: 8_100, 7: 17_000, 8: 24_900, 10: 35_000, 11: 40_000 };
    const STOP = 225_000;
    const caseAt = (d: number): RejoinCase => ({ field, now: STOP + d, stopped: { car: 8, at: STOP } });
    const green = (d: number) => at(caseAt(d));
    const first = valueOf(green(25).order);
    const later = valueOf(green(5_025).order);
    // car 8: t −375 25 ms after it stopped, t +4 625 5 s later; car 10, still running, keeps its t
    expect(tOf(later, 8) - tOf(first, 8)).toBeCloseTo(5_000, 0);
    expect(tOf(first, 8)).toBeCloseTo(-375, 0);
    expect(tOf(first, 10)).toBeCloseTo(9_700, 0);
    expect(tOf(later, 10)).toBeCloseTo(9_700, 0);
    expect(ids(first)).toEqual([6, 7, 8, 'ghost', 10, 11]);
    expect(ids(later)).toEqual([5, 6, 7, 'ghost', 8, 10, 11]);
    // every 50 ms: car 8 is 19 900 + d behind us; it stays ahead of the ghost while the ghost yields to it (within
    // minGapMs 500 of the loss, B8) and is behind it from the first frame with 19 900 + d ≥ 20 800
    for (let d = 25; d <= 6_025; d += 50) {
      const want = 19_900 + d < 20_800 ? 9 : 8;
      expect(green(d).rejoinPosition, `${d} ms after the stop`).toMatchObject({ known: true, value: want });
    }
  });

  // SP4.3d1 Task 7 row 5
  it("readers: between two of our crossings the output keeps its type; each condition's loss is pit-loss's, unchanged", () => {
    // 700 ms after our crossing of progress 125
    const r = rejoinOf(outputOf({ now: NOW + 700 }));
    expect(r.position).toBe(6);
    for (const c of CONDITIONS) expect(Object.keys(r.conditions[c]).sort(), c).toEqual(['condition', 'lossMs', 'lossSource', 'order', 'rejoinPosition']);
    expect(r.conditions.green.lossMs).toMatchObject({ known: true, value: 20_300 });
    expect(r.conditions.vsc.lossMs).toMatchObject({ known: true, value: 13_100 });
    expect(r.conditions.sc.lossMs).toMatchObject({ known: true, value: 9_800 });
    // every car moved on at one pace: the same places and intervals as on the crossing
    expect(r.conditions.green.rejoinPosition).toMatchObject({ known: true, value: 9 });
    const rows = valueOf(r.conditions.green.order);
    expect(ids(rows)).toEqual([6, 7, 8, 'ghost', 9, 10, 11]);
    intervals(rows).forEach((v, k) => expect(v, `row ${k}`).toBeCloseTo([4_100, 8_900, 7_900, 400, 3_700, 6_000, 5_000][k]!, 0));
  });

  it('behaviour table: race → computes, other weekend phases notApplicable; racing and in laps compute, the rest notApplicable; car status as gaps (C44)', () => {
    expect(REJOIN_BEHAVIOUR['weekend-phase']).toEqual({ race: { race: true }, practice: { notApplicable: true }, qualifying: { notApplicable: true }, none: { notApplicable: true } });
    expect(REJOIN_BEHAVIOUR['car-activity-race']).toEqual({
      racingLap: {},
      inLap: {},
      boxStop: { notApplicable: true },
      servingPenalty: { notApplicable: true },
      outLap: { notApplicable: true },
      finished: { notApplicable: true },
      coolDown: { notApplicable: true },
      notCompeting: { notApplicable: true },
    });
    expect(REJOIN_BEHAVIOUR['car-status']).toEqual({ competing: { car: 'running' }, retired: { car: 'out' }, disqualified: { car: 'out' }, absent: { car: 'absent' } });
  });

  it('the unit folder exports its behaviour table, the one the generic completeness test checks (C44, C87)', async () => {
    const folder = (await loadUnitFolders()).find((f) => f.unit === 'rejoin');
    expect(folder?.table).toBe(REJOIN_BEHAVIOUR);
  });
});
