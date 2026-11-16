// `circle` (SP4.3d spec §6.5, SP4.3d1 Task 8): the field as a lap circle, per our car, on every frame. A car's place is
// how long ago our car was where that car is now, modulo one of our laps (ruling R10: from the shared crossing history,
// `shared/crossing-history.ts`, never a local copy, C43): a car just behind sits seconds behind us, a car ahead near the
// far side, a car that stops slides back every frame. One turn of the circle, `lapMs`, is our rolling lap (ruling R15):
// the time our car took for the last full lap of progress up to now, the shared `timeBehind`'s (R14), the lap every
// place is folded into, so no place lies past a full turn. Our ghosts are `rejoin`'s, one per condition: a ghost sits
// `rejoin`'s loss for its condition behind us, folded into our rolling lap (R16, never rebuilt from a neighbour), with
// its rejoin position and the times to the car ahead and behind (its order's intervals, never recomputed, C43). `current` is
// the race's session phase: `neutralised` gives its condition (SC, VSC), every other kind `green`. Quick, every frame
// (C41), bound to `circle.car` (C42, C53, C56). Built races (`case.ts`); every case runs through the guarded view (C41).
import { carId, type CarId, type Circle, type CircleCar, type CircleGhost, type CrossingRow, type Known, type PitCondition } from '@pitwall/domain';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { longRace } from '../../../../test-support/builders/long-race.ts';
import { CIRCLE_BEHAVIOUR } from '../../src/circle/behaviour.ts';
import { circleCalculator } from '../../src/circle/calculator.ts';
import { CIRCLE, type CircleOutput } from '../../src/circle/index.ts';
import { REJOIN } from '../../src/rejoin/index.ts';
import { FIELD, NOW, US, type Field } from '../rejoin/field.ts';
import { guardedQuick } from '../situated.ts';
import { CALCULATORS, loadUnitFolders } from '../units.ts';
import { circleCase, ourLaps, type CircleCase } from './case.ts';
import { circleViewAt } from './long-race.ts';

const calc = guardedQuick(circleCalculator);

const CONDITIONS: readonly PitCondition[] = ['green', 'vsc', 'sc'];

/** Tolerance of a time on the circle, in ms. */
const TOL = 20;

const outputOf = (o: CircleCase = {}): CircleOutput => calc.compute(circleCase(o).view);

/** Car `car`'s circle; it must be present. */
const circleOf = (out: CircleOutput, car: number = US): Circle => {
  const c = out.cars[carId(car)];
  if (c === undefined) throw new Error(`no circle of car ${car}`);
  return c;
};

const valueOf = <T>(k: Known<T>): T => {
  if (!k.known) throw new Error(`unknown: ${k.reason}`);
  return k.value;
};

/** The cars on a circle by car id. */
const carsOf = (c: Circle): Map<number, CircleCar> => new Map(valueOf(c.cars).map((x) => [x.carId as number, x]));

/** Car `car`'s time behind us on circle `c`; it must be on it. */
const behindOf = (c: Circle, car: number): number => {
  const x = carsOf(c).get(car);
  if (x === undefined) throw new Error(`car ${car} is not on the circle`);
  return x.behindMs;
};

const ghostOf = (c: Circle, condition: PitCondition): CircleGhost => {
  const ghosts = c.ghosts.filter((g) => g.condition === condition);
  expect(ghosts, condition).toHaveLength(1);
  return ghosts[0]!;
};

/** The ghost row of an order and the rows either side of it. */
const aroundGhost = (rows: readonly CrossingRow[]): { ahead: CrossingRow | undefined; ghost: CrossingRow; behind: CrossingRow | undefined } => {
  const g = rows.findIndex((r) => r.ghost);
  if (g < 0) throw new Error('no ghost row');
  return { ahead: rows[g - 1], ghost: rows[g]!, behind: rows[g + 1] };
};

describe('circle analysis', () => {
  it('is the quick analysis `circle` on every frame, reading `rejoin`, our laps, session-phase-race and car-status', () => {
    expect(circleCalculator.id).toBe(CIRCLE);
    expect(circleCalculator.kind).toBe('quick');
    expect(circleCalculator.cadence).toBe('frame');
    expect(circleCalculator.reads).toEqual(expect.arrayContaining([{ calculator: REJOIN }, 'spans:session-phase-race', 'spans:car-status']));
    // R15: the circle's lap is our rolling lap, not a lap record: no read of the laps list
    expect(circleCalculator.reads).not.toContain('laps');
  });

  // 1
  it('placement: a car 1.2 s behind us has behindMs 1 200 ± 20; a car 3 s ahead has lapMs − 3 000 ± 20', () => {
    // the standard field plus car 12 at +1.2 s; car 3 is 3 s ahead of us, car 1 5 s, car 6 3.1 s behind
    const field: Field = { ...FIELD, 12: 6_200 };
    const c = circleOf(outputOf({ field }));
    expect(c.carId).toBe(carId(US));
    // our rolling lap: every car laps in 90 000 (R15)
    const lapMs = valueOf(c.lapMs);
    expect(Math.abs(lapMs - 90_000)).toBeLessThanOrEqual(TOL);
    expect(Math.abs(behindOf(c, 12) - 1_200)).toBeLessThanOrEqual(TOL);
    expect(Math.abs(behindOf(c, 3) - (lapMs - 3_000))).toBeLessThanOrEqual(TOL);
    expect(Math.abs(behindOf(c, 1) - (lapMs - 5_000))).toBeLessThanOrEqual(TOL);
    expect(Math.abs(behindOf(c, 6) - 3_100)).toBeLessThanOrEqual(TOL);
    // every other car, 0 … one lap; our own car is the top of its circle, not one of its cars
    expect([...carsOf(c).keys()].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    for (const x of valueOf(c.cars)) {
      expect(x.behindMs, `car ${x.carId}`).toBeGreaterThanOrEqual(0);
      expect(x.behindMs, `car ${x.carId}`).toBeLessThan(lapMs);
    }
    // between two of our crossings (700 ms after one) the same places: every car moved on at one pace
    const between = circleOf(outputOf({ field, now: NOW + 700 }));
    for (const [id, want] of [[12, 1_200], [3, 87_000], [6, 3_100]] as const) expect(Math.abs(behindOf(between, id) - want), `car ${id}`).toBeLessThanOrEqual(TOL);
  });

  // R15 (ported from "our newest green lap"): one turn of the circle is our rolling lap, the shared timeBehind's
  it('lapMs: our rolling lap (the time we took for the last full lap of progress up to now); lap records change nothing; unknown on our first lap', () => {
    // our first lap (we started at 5 000, now 65 000: two thirds of a lap of history): unknown, as timeBehind is
    const first = circleOf(outputOf({ now: 65_000 }));
    expect(first.lapMs.known).toBe(false);
    // no place and no ghost place without a turn to fold into
    expect(first.cars.known && first.cars.value.length > 0).toBe(false);
    for (const g of first.ghosts) expect(g.behindMs.known, g.condition).toBe(false);
    // every car laps in 90 000: at our crossing and between two
    for (const now of [NOW, NOW + 700, NOW + 90_000]) expect(Math.abs(valueOf(circleOf(outputOf({ now })).lapMs) - 90_000), `now ${now}`).toBeLessThanOrEqual(TOL);
    // lap records are not the circle's lap: none, an invalid one, a faster one give the same circle
    const a = circleOf(outputOf());
    for (const laps of [[], ourLaps(NOW, { 2: { valid: { lap: false, sectors: [true, true, false] } } }), ourLaps(NOW, { 2: { lapTimeMs: 85_000 } })]) {
      const b = circleOf(outputOf({ laps }));
      expect(b.lapMs).toEqual(a.lapMs);
      expect(b.cars).toEqual(a.cars);
    }
  });

  // 2
  it("ghosts: each ghost's rejoinPosition equals rejoin's, its neighbours' times are rejoin's intervals on the circle's scale; current is sc under an SC span", () => {
    const { view, rejoin } = circleCase();
    const c = circleOf(calc.compute(view));
    const r = rejoin.cars[carId(US)]!;
    expect(c.ghosts.map((g) => g.condition).sort()).toEqual([...CONDITIONS].sort());
    for (const cond of CONDITIONS) {
      const ghost = ghostOf(c, cond);
      expect(ghost.rejoinPosition, cond).toEqual(r.conditions[cond].rejoinPosition);
      const { ahead, ghost: row, behind } = aroundGhost(valueOf(r.conditions[cond].order));
      // the time to the car ahead is the ghost row's interval, to the car behind that car's row's
      expect(valueOf(ghost.aheadMs), cond).toBeCloseTo(valueOf(row.intervalMs), 0);
      expect(valueOf(ghost.behindCarMs), cond).toBeCloseTo(valueOf(behind!.intervalMs), 0);
      // on the circle's scale: the ghost sits aheadMs behind the car ahead and behindCarMs ahead of the car behind
      const at = valueOf(ghost.behindMs);
      expect(Math.abs(at - (behindOf(c, ahead!.carId as number) + valueOf(ghost.aheadMs))), cond).toBeLessThanOrEqual(TOL);
      expect(Math.abs(behindOf(c, behind!.carId as number) - valueOf(ghost.behindCarMs) - at), cond).toBeLessThanOrEqual(TOL);
    }
    // the standard field: green 20 300 between car 8 (+19.9 s) and car 9 (+24.0 s); VSC 13 100 between car 7 (+12.0 s)
    // and car 8; SC 9 800 between car 6 (+3.1 s) and car 7
    expect(valueOf(ghostOf(c, 'green').behindMs)).toBeCloseTo(20_300, -1);
    expect(valueOf(ghostOf(c, 'green').aheadMs)).toBeCloseTo(400, 0);
    expect(valueOf(ghostOf(c, 'green').behindCarMs)).toBeCloseTo(3_700, 0);
    expect(valueOf(ghostOf(c, 'vsc').aheadMs)).toBeCloseTo(1_100, 0);
    expect(valueOf(ghostOf(c, 'vsc').behindCarMs)).toBeCloseTo(6_800, 0);
    expect(valueOf(ghostOf(c, 'sc').aheadMs)).toBeCloseTo(6_700, 0);
    expect(valueOf(ghostOf(c, 'sc').behindCarMs)).toBeCloseTo(2_200, 0);
    // the current condition from the race's session phase
    expect(c.current).toBe('green');
    expect(circleOf(outputOf({ neutralised: 'SC' })).current).toBe('sc');
    expect(circleOf(outputOf({ neutralised: 'VSC' })).current).toBe('vsc');
  });

  // F2 (C43, ruling R16): the ghost's place is rejoin's loss folded into our rolling lap, never rebuilt from a neighbour
  it("ghost behind us: the car ahead of the ghost is ahead of our car (nobody within the SC loss behind us) → the ghost's behindMs is the SC loss, less than lapMs", () => {
    // the standard field without cars 6 and 7: behind us car 8 at +19.9 s first; under SC (9 800) and VSC (13 100) the
    // car ahead of the ghost is car 5, 1 s ahead of our car
    const field: Field = { 1: 0, 2: 1_000, 3: 2_000, 4: 3_000, 5: 4_000, 0: 5_000, 8: 24_900, 9: 29_000, 10: 35_000, 11: 40_000 };
    const { view, rejoin } = circleCase({ field });
    const c = circleOf(calc.compute(view));
    const lapMs = valueOf(c.lapMs);
    const r = rejoin.cars[carId(US)]!;
    for (const [cond, loss] of [['sc', 9_800], ['vsc', 13_100], ['green', 20_300]] as const) {
      const ghost = ghostOf(c, cond);
      // the case the review describes: the row ahead of the ghost in rejoin's order is a car ahead of us (or none)
      if (cond !== 'green') expect(aroundGhost(valueOf(r.conditions[cond].order)).ahead?.carId, cond).toBe(carId(5));
      const at = valueOf(ghost.behindMs);
      expect(Math.abs(at - valueOf(r.conditions[cond].lossMs)), cond).toBeLessThanOrEqual(TOL);
      expect(Math.abs(at - loss), cond).toBeLessThanOrEqual(TOL);
      expect(at, cond).toBeGreaterThanOrEqual(0);
      expect(at, cond).toBeLessThan(lapMs);
      // the rest still rejoin's
      expect(ghost.rejoinPosition, cond).toEqual(r.conditions[cond].rejoinPosition);
      const { ghost: row, behind } = aroundGhost(valueOf(r.conditions[cond].order));
      expect(ghost.aheadMs, cond).toEqual(row.intervalMs);
      expect(ghost.behindCarMs, cond).toEqual(behind!.intervalMs);
    }
  });

  it('a car lapping us ahead of the ghost: the ghost still sits the loss behind us', () => {
    // car 1 a lap and 2 s ahead of our car (offset −87 000 + 5 000 … at one pace: it passes every point 92 s before us)
    const field: Field = { 1: -87_000, 0: 5_000, 8: 24_900, 9: 29_000 };
    const { view, rejoin } = circleCase({ field });
    const c = circleOf(calc.compute(view));
    const lapMs = valueOf(c.lapMs);
    for (const cond of CONDITIONS) {
      const at = valueOf(ghostOf(c, cond).behindMs);
      expect(Math.abs(at - valueOf(rejoin.cars[carId(US)]!.conditions[cond].lossMs)), cond).toBeLessThanOrEqual(TOL);
      expect(at, cond).toBeLessThan(lapMs);
    }
  });

  // R15: one turn is our rolling lap, so under SC (a slow lap behind us, a fast green lap on record) no place passes it
  it('under an SC span every car’s behindMs (and every ghost’s) is less than lapMs, our rolling lap, not our last green lap', () => {
    // our last green lap on record 85 000, faster than the lap we just drove (90 000): car 3, 3 s ahead, sits at 87 000
    const c = circleOf(outputOf({ neutralised: 'SC', laps: ourLaps(NOW, { 2: { lapTimeMs: 85_000 } }) }));
    expect(c.current).toBe('sc');
    const lapMs = valueOf(c.lapMs);
    expect(Math.abs(lapMs - 90_000)).toBeLessThanOrEqual(TOL);
    expect(Math.abs(behindOf(c, 3) - (lapMs - 3_000))).toBeLessThanOrEqual(TOL);
    for (const x of valueOf(c.cars)) {
      expect(x.behindMs, `car ${x.carId}`).toBeGreaterThanOrEqual(0);
      expect(x.behindMs, `car ${x.carId}`).toBeLessThan(lapMs);
    }
    for (const g of c.ghosts) expect(valueOf(g.behindMs), g.condition).toBeLessThan(lapMs);
  });

  // 3
  it('spin: a rival stopped for 6 s has behindMs 6 000 larger than before, and slides back on every frame', () => {
    // the standard field without car 9: car 8 at +19.9 s stops at STOP and stays there while the field runs on
    const field: Field = { 1: 0, 2: 1_000, 3: 2_000, 4: 3_000, 5: 4_000, 0: 5_000, 6: 8_100, 7: 17_000, 8: 24_900, 10: 35_000, 11: 40_000 };
    const STOP = 225_000;
    const at = (d: number) => circleOf(outputOf({ field, now: STOP + d, stopped: { car: 8, at: STOP } }));
    const before = at(25);
    const after = at(6_025);
    expect(Math.abs(behindOf(after, 8) - behindOf(before, 8) - 6_000)).toBeLessThanOrEqual(TOL);
    // a car still running keeps its place
    expect(Math.abs(behindOf(after, 10) - behindOf(before, 10))).toBeLessThanOrEqual(TOL);
    let last = behindOf(before, 8);
    for (let d = 125; d <= 6_025; d += 100) {
      const now = behindOf(at(d), 8);
      expect(now, `${d} ms after the stop`).toBeGreaterThan(last);
      last = now;
    }
  });

  // 4
  it('not competing: a retired or disqualified car is not in cars; an absent one neither (Review Focus 5)', () => {
    const c = circleOf(outputOf({ status: { 7: 'retired', 9: 'disqualified', 11: 'absent' } }));
    const ids = [...carsOf(c).keys()];
    for (const out of [7, 9, 11]) expect(ids, `car ${out}`).not.toContain(out);
    expect(ids.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 8, 10]);
  });

  it('both our cars: one circle each; the teammate is a car on the player\'s circle and the player on the teammate\'s', () => {
    const out = outputOf({ teammate: 8 });
    expect(Object.keys(out.cars).map(Number).sort((a, b) => a - b)).toEqual([US, 8]);
    const mate = circleOf(out, 8);
    expect(mate.carId).toBe(carId(8));
    expect(carsOf(circleOf(out)).has(8)).toBe(true);
    expect(carsOf(mate).has(US)).toBe(true);
    expect(carsOf(mate).has(8)).toBe(false);
  });

  it('a rival has no circle; practice and qualifying give none', () => {
    expect(Object.keys(outputOf().cars).map(Number)).toEqual([US]);
    expect(outputOf().cars[carId(6) as CarId]).toBeUndefined();
    expect(outputOf({ kind: 'practice' }).cars).toEqual({});
    expect(outputOf({ kind: 'qualifying' }).cars).toEqual({});
  });

  // 6
  it('contract: the registry exports it (guarded-view and behaviour completeness pick it up, C41, C44, C87)', async () => {
    expect(CALCULATORS.map((c) => c.id)).toContain(CIRCLE);
    const folder = (await loadUnitFolders()).find((f) => f.unit === CIRCLE);
    expect(folder?.table).toBe(CIRCLE_BEHAVIOUR);
    expect(Object.keys(CIRCLE_BEHAVIOUR)).toEqual(expect.arrayContaining(['session-phase-race', 'car-status']));
    expect(CIRCLE_BEHAVIOUR['car-status']).toEqual({ competing: { car: 'running' }, retired: { car: 'out' }, disqualified: { car: 'out' }, absent: { car: 'absent' } });
  });

  it('contract: rewind exactness: after a flashback the output equals a run without the undone frames (C33)', () => {
    const race = longRace();
    const target = race.framesOfLap(35)[3]!;
    const undone = race.framesOfLap(37)[0]!;
    const rewound = circleViewAt(race, target, undone);
    expect(rewound.delta.rewound).toBeDefined();
    const fresh = calc.compute(circleViewAt(race, target));
    expect(fresh.cars[carId(US)]).toBeDefined();
    expect(calc.compute(rewound)).toEqual(fresh);
    // the undone frames gave another circle before the flashback
    expect(calc.compute(circleViewAt(race, undone))).not.toEqual(fresh);
  });

  it('keeps no copy of the crossing history: its calculator reads our history through the shared helper (R10, C43)', () => {
    const source = readFileSync(join(import.meta.dirname, '../../src/circle/calculator.ts'), 'utf8');
    expect(source).toMatch(/from\s*'\.\.\/shared\/crossing-history\.ts'/);
    expect(source).not.toMatch(/\b(?:function|const|let)\s+(?:progressOf|whenAt|timeAtProgress|liveProgress|progressAt)\b/);
  });

  // SP4.3d1 Task 8 F1, F2, R15 (C43, rulings R14–R16): the time behind us is the shared timeBehind's, the ghost's place
  // rejoin's loss, the circle's lap the rolling lap: no local copy of our position now, our live point or the folding,
  // no rebuild of the ghost from a neighbour, no read of a lap record
  it('calls the shared timeBehind and folds nothing itself; reads no lap record (R14, R15, R16, C43)', () => {
    const source = readFileSync(join(import.meta.dirname, '../../src/circle/calculator.ts'), 'utf8');
    const imported = /import\s*\{([^}]*)\}\s*from\s*'\.\.\/shared\/crossing-history\.ts'/.exec(source)?.[1] ?? '';
    expect(imported).toMatch(/\btimeBehind\b/);
    expect(source).toMatch(/\btimeBehind\(/);
    expect(source).not.toMatch(/\btimeAtProgress\b/);
    expect(source).not.toMatch(/\bLivePoint\b|\blivePoint\b/);
    expect(source).not.toMatch(/\bMINI_SECTORS\b/);
    expect(source).not.toMatch(/\b(?:function|const|let)\s+(?:liveOf|here|back|lapAgo|aheadAt|behindAt)\b/);
    expect(source).not.toMatch(/\blap-classes\b|\bisPaceLap\b|\bcurrentLaps\b|\blastGreenLap\b/);
  });
});
