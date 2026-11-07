// `rejoin` (SP4.2 spec 3.2, 6.1): our car as if it were in the pit lane now, per condition (green, VSC, SC). For every
// other car X, `t_X = gapMs_X − loss[c]` (its gap to us at the same point of the road, from `gapsToCar`, minus the
// loss); the physical order sorts by `t`, the ghost at 0; the rejoin position is our position plus the cars on our lap
// behind us within the loss; each row's interval is its `t` minus the row ahead's (the first row against the car ahead
// of it in the full order); the map point is where we were `loss` ms ago, on the track file's outline (C62b). Built
// races (`field.ts`); every case runs through the guarded view (C41); race only (C14); our cars only.
import { carId, known, unknown, type CarId, type CrossingRow, type Known, type PitCondition, type TrackData } from '@pitwall/domain';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { GAPS } from '../../src/gaps/index.ts';
import { PIT_LOSS } from '../../src/pit-loss/index.ts';
import { REJOIN_BEHAVIOUR } from '../../src/rejoin/behaviour.ts';
import { rejoinCalculator } from '../../src/rejoin/calculator.ts';
import { REJOIN, REJOIN_CONFIG, type Rejoin, type RejoinAt, type RejoinOutput } from '../../src/rejoin/index.ts';
import { pointAt } from '../../src/shared/track-lookup.ts';
import { guardedQuick } from '../situated.ts';
import { loadUnitFolders } from '../units.ts';
import { INSUFFICIENT, NOT_APPLICABLE, rejoinCase, SOURCES, US, ZANDVOORT, type Field, type RejoinCase } from './field.ts';

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

const ghostOf = (rows: readonly CrossingRow[]): CrossingRow => {
  const ghosts = rows.filter((r) => r.ghost);
  expect(ghosts).toHaveLength(1);
  return ghosts[0]!;
};

describe('rejoin calculator', () => {
  it('is the quick analysis `rejoin` on our crossings, over gaps, pit-loss, the weekend phase, car activity and car status', () => {
    expect(rejoinCalculator.id).toBe(REJOIN);
    expect(rejoinCalculator.kind).toBe('quick');
    expect(rejoinCalculator.cadence).toBe('ourCrossing');
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
          expect(p0).toBe(3);
          expect(pSmall).toBeGreaterThanOrEqual(3);
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
  it('the map point: where we were `loss` ms ago, on the outline; without a track file `notApplicable`', () => {
    // our newest crossing: progress 125 at 230 000; 18 000 ms (10 crossings) ago progress 115, 9 000 ago 120, 5 400 ago 122
    const r = rejoinOf(outputOf({ losses: { green: 18_000, vsc: 9_000, sc: 5_400 } }));
    const outline = valueOf(ZANDVOORT.outline);
    const expected: Record<PitCondition, number> = { green: 15 / 50, vsc: 20 / 50, sc: 22 / 50 };
    for (const c of CONDITIONS) {
      const point = valueOf(r.conditions[c].mapPoint);
      const want = pointAt(outline, expected[c]);
      expect(point.x, c).toBeCloseTo(want.x, 3);
      expect(point.y, c).toBeCloseTo(want.y, 3);
    }
    const none = rejoinOf(outputOf({ track: unknown('notApplicable') }));
    for (const c of CONDITIONS) expect(none.conditions[c].mapPoint, c).toEqual(NOT_APPLICABLE);
    // a track file without an outline is as none
    const noOutline: TrackData = { ...ZANDVOORT, outline: unknown('notReceived') };
    expect(at({ track: known(noOutline, 0) }).mapPoint).toMatchObject({ known: false });
  });

  // 7
  it('our crossings span less than the loss: the map point is `insufficientData`, the order still known; no crossing of ours: all `insufficientData`', () => {
    // first lap: our crossings from 5 000 to 19 400, 14 400 ms, under the green loss of 20 300
    const early = at({ now: 20_000 });
    expect(early.mapPoint).toEqual(INSUFFICIENT);
    expect(early.order.known).toBe(true);
    expect(early.rejoinPosition.known).toBe(true);
    const r = rejoinOf(outputOf({ without: [US] }));
    for (const c of CONDITIONS) {
      expect(r.conditions[c].rejoinPosition, c).toEqual(INSUFFICIENT);
      expect(r.conditions[c].order, c).toEqual(INSUFFICIENT);
      expect(r.conditions[c].mapPoint, c).toEqual(INSUFFICIENT);
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
