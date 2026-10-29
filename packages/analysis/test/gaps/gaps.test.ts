import { carId, type Interval, type Known } from '@pitwall/domain';
import type { EngineView } from '@pitwall/engine';
import { describe, expect, it } from 'vitest';
import { GAPS, GAPS_CONFIG, type GapsOutput } from '../../src/gaps/index.ts';
import { gapsCalculator } from '../../src/gaps/calculator.ts';
import { gapperLines, gapsToCar } from '../../src/gaps/gaps.ts';
import { crossings, field } from '../../../../test-support/builders/index.ts';
import { byTime, carsFor, deltaOf, offsetRace, plain, run, viewOf } from './race.ts';

/** A known value (with -0 as 0), or the reason it is unknown. */
const v = (k: Known<number>): number | string => (k.known ? plain(k.value) : k.reason);
const interval = (out: GapsOutput, id: number): Interval => {
  const found = out.intervals.find((i) => i.carId === id);
  if (found === undefined) throw new Error(`no interval for car ${id}`);
  return found;
};
const line = (lines: ReturnType<typeof gapperLines>, id: number) =>
  lines.cars.find((c) => c.carId === id)?.byLap.map(({ lap, gapMs }) => [lap, plain(gapMs)]);
const neighbours = (out: GapsOutput, our: number) => out.neighbourhood.find((n) => n.ourCarId === our)?.carIds;

/** 3 cars at 90, 91 and 92 s, 5 full laps: everyone's latest crossing is the line at the end of lap 5. */
const threeCars = () => field({ cars: 3, laps: 5, paceMs: [90_000, 91_000, 92_000] }).miniSectors;

describe('gaps calculator', () => {
  it('is the incremental calculator `gaps` over the mini-sectors and timing, due every frame', () => {
    expect(gapsCalculator.id).toBe(GAPS);
    expect(gapsCalculator.kind).toBe('incremental');
    expect(gapsCalculator.cadence).toBe('frame');
    expect(gapsCalculator.reads).toEqual(expect.arrayContaining(['miniSectors', 'timing']));
  });

  it('field 3 cars at 90/91/92 s: after lap 5, car 2 is 10 s behind the leader and 5 s behind car 1', () => {
    const out = run(viewOf(threeCars()));
    const [c0, c1, c2] = [interval(out, 0), interval(out, 1), interval(out, 2)];
    expect([v(c2.toLeaderMs), v(c2.toAheadMs), v(c2.toBehindMs), c2.lapsDown]).toEqual([10_000, 5_000, 'notApplicable', 0]);
    expect([v(c1.toLeaderMs), v(c1.toAheadMs), v(c1.toBehindMs), c1.lapsDown]).toEqual([5_000, 5_000, 5_000, 0]);
    expect([v(c0.toLeaderMs), v(c0.toAheadMs), v(c0.toBehindMs), c0.lapsDown]).toEqual([0, 'notApplicable', 5_000, 0]);
  });

  it('the intervals are the running cars in position order', () => {
    // positions 1..3 are cars 2, 0, 1: the order comes from the car state (the idle slots of the view are no cars)
    const ms = offsetRace([1_000, 2_000, 0], 2);
    const out = run(viewOf(ms));
    expect(out.intervals.map((i) => i.carId)).toEqual([2, 0, 1]);
    expect(v(interval(out, 1).toAheadMs)).toBe(1_000);
  });

  it('the gap updates at every crossing, not only at the line', () => {
    const all = field({ cars: 2, laps: 3, paceMs: [90_000, 91_000] }).miniSectors;
    // car 1 ends lap 2 at 182 s, 2 s behind car 0
    let n = all.findIndex((m) => m.carId === 1 && m.lap === 2 && m.segment === 49) + 1;
    let view = viewOf(all.slice(0, n));
    let acc = gapsCalculator.init(view);
    expect(v(interval(gapsCalculator.output(acc), 1).toLeaderMs)).toBe(2_000);
    const seen: (number | string)[] = [];
    for (; n < all.length; n++) {
      const next = viewOf(all.slice(0, n + 1));
      acc = gapsCalculator.update(acc, deltaOf(view, next), next);
      view = next;
      if (all[n]!.carId === 1) seen.push(v(interval(gapsCalculator.output(acc), 1).toLeaderMs));
    }
    // lap 3, segment s: car 1 at 182 000 + 1820 (s + 1), car 0 at 180 000 + 1800 (s + 1)
    expect(seen).toEqual(Array.from({ length: 50 }, (_, s) => 2_000 + 20 * (s + 1)));
  });

  it("the gaps come from the crossings, never from the game's gaps", () => {
    const ms = threeCars();
    const cars = carsFor(ms).map((c) => ({ ...c, timing: { ...c.timing, gapToLeaderMs: 77_777, gapToCarAheadMs: 33_333 } }));
    expect(run(viewOf(ms, { cars }))).toEqual(run(viewOf(ms)));
  });

  it('a lapped car has lapsDown 1 and gap to leader under one lap', () => {
    // car 0 at 90 s, car 1 at 100 s; at 950 s car 0 is at lap 11 segment 26, car 1 at lap 10 segment 24
    const ms = field({ cars: 2, laps: 11, paceMs: [90_000, 100_000] }).miniSectors.filter((m) => m.at <= 950_000);
    const lapped = interval(run(viewOf(ms)), 1);
    expect(lapped.lapsDown).toBe(1);
    // the leader passed lap 11 segment 24 at 945 s, car 1 passed the same point (lap 10) at 950 s
    expect(v(lapped.toLeaderMs)).toBe(5_000);
  });

  it('a car without a crossing yet has no known gap', () => {
    const ms = field({ cars: 2, laps: 1, paceMs: 90_000 }).miniSectors;
    const cars = carsFor(ms, { 2: { position: 3 } });
    const out = run(viewOf(ms, { cars }));
    expect(interval(out, 2).toLeaderMs.known).toBe(false);
    expect(interval(out, 2).toAheadMs.known).toBe(false);
  });

  it.each(['retired', 'didNotFinish', 'disqualified'] as const)('a %s car is not in the intervals or the neighbourhood', (resultStatus) => {
    // car 3 ran two laps at 90.5 s and stopped; the car state still has it at P2
    const ms = byTime([
      ...threeCars(),
      ...crossings(carId(3), 1, 90_500, 0),
      ...crossings(carId(3), 2, 90_500, 90_500),
    ]);
    const cars = carsFor(ms, { 3: { position: 2, resultStatus }, 1: { position: 3 }, 2: { position: 4 } });
    const out = run(viewOf(ms, { cars }));
    expect(out.intervals.map((i) => i.carId)).toEqual([0, 1, 2]);
    expect(v(interval(out, 1).toAheadMs)).toBe(5_000);
    expect(v(interval(out, 0).toBehindMs)).toBe(5_000);
    expect(out.neighbourhood.map((n) => n.ourCarId)).toEqual([0]);
    expect(neighbours(out, 0)).not.toContain(3);
  });

  it('lineTimes holds the line crossing of every completed lap, latest the newest crossing', () => {
    const all = field({ cars: 2, laps: 3, paceMs: [90_000, 91_000] }).miniSectors;
    const full = run(viewOf(all));
    expect(full.lineTimes[carId(1)]).toEqual([
      { lap: 1, at: 91_000 },
      { lap: 2, at: 182_000 },
      { lap: 3, at: 273_000 },
    ]);
    expect(full.latest[carId(1)]).toEqual({ lap: 3, segment: 49, at: 273_000 });

    // mid lap 3: car 1 has crossed segment 9 at 182 000 + 10 * 1820
    const mid = run(viewOf(all.filter((m) => m.at <= 200_200)));
    expect(mid.lineTimes[carId(1)]).toEqual([
      { lap: 1, at: 91_000 },
      { lap: 2, at: 182_000 },
    ]);
    expect(mid.latest[carId(1)]).toEqual({ lap: 3, segment: 9, at: 200_200 });
  });

  it('update over deltas equals init over the whole history', () => {
    const all = field({ cars: 3, laps: 4, paceMs: [90_000, 91_000, 92_500] }).miniSectors;
    let view = viewOf([]);
    let acc = gapsCalculator.init(view);
    for (let n = 37; n < all.length + 37; n += 37) {
      const next = viewOf(all.slice(0, n));
      acc = gapsCalculator.update(acc, deltaOf(view, next), next);
      view = next;
      expect(gapsCalculator.output(acc)).toEqual(run(next));
    }
  });

  it('flashback equals fresh run', () => {
    const all = field({ cars: 3, laps: 6, paceMs: [90_000, 91_000, 92_500] }).miniSectors;
    const early = viewOf(all.slice(0, 400));
    const full = viewOf(all);
    const acc = gapsCalculator.update(gapsCalculator.init(early), deltaOf(early, full), full);
    const truncated = viewOf(all.slice(0, 250));
    const back = gapsCalculator.update(acc, deltaOf(full, truncated, true), truncated);
    expect(gapsCalculator.output(back)).toEqual(run(truncated));
  });
});

describe('gaps to one car', () => {
  it("gives every car's signed gap to the car, positive = behind it", () => {
    const toCar1 = gapsToCar(run(viewOf(threeCars())), carId(1))!;
    const of = (id: number) => toCar1.find((g) => g.carId === id)!;
    expect([v(of(0).gapMs), of(0).lapsDown]).toEqual([-5_000, 0]);
    expect([v(of(2).gapMs), of(2).lapsDown]).toEqual([5_000, 0]);
  });

  it('is undefined for a car that is not in the race', () => {
    const out = run(viewOf(threeCars()));
    expect(gapsToCar(out, carId(7))).toBeUndefined(); // an idle slot
    expect(gapsToCar(out, carId(99))).toBeUndefined();
  });
});

describe('gapper', () => {
  const out = () => run(viewOf(threeCars()));

  it('the gapper with leaderAverage 90 s: a car at 91 s is −1000 ms per lap more each lap', () => {
    const lines = gapperLines(out(), { kind: 'leaderAverage' });
    expect(v(lines.referenceLapMs)).toBe(90_000);
    expect(line(lines, 1)).toEqual([1, 2, 3, 4, 5].map((lap) => [lap, -1_000 * lap]));
    expect(line(lines, 2)).toEqual([1, 2, 3, 4, 5].map((lap) => [lap, -2_000 * lap]));
    expect(line(lines, 0)).toEqual([1, 2, 3, 4, 5].map((lap) => [lap, 0]));
  });

  it('fixed: the virtual car laps at lapMs', () => {
    const lines = gapperLines(out(), { kind: 'fixed', lapMs: 89_000 });
    expect(v(lines.referenceLapMs)).toBe(89_000);
    expect(line(lines, 0)).toEqual([1, 2, 3, 4, 5].map((lap) => [lap, -1_000 * lap]));
    expect(line(lines, 2)).toEqual([1, 2, 3, 4, 5].map((lap) => [lap, -3_000 * lap]));
  });

  it("carAverage: the virtual car laps at that car's mean lap", () => {
    const lines = gapperLines(out(), { kind: 'carAverage', carId: carId(1) });
    expect(v(lines.referenceLapMs)).toBe(91_000);
    expect(line(lines, 0)).toEqual([1, 2, 3, 4, 5].map((lap) => [lap, 1_000 * lap]));
    expect(line(lines, 1)).toEqual([1, 2, 3, 4, 5].map((lap) => [lap, 0]));
    expect(line(lines, 2)).toEqual([1, 2, 3, 4, 5].map((lap) => [lap, -1_000 * lap]));
  });

  it("leaderAverage is the leader's mean lap so far, applied to every lap, so the lines shift each lap", () => {
    // the leader laps 90, 90 and 96 s (mean 92 s); car 1 laps 93 s
    const ms = byTime([
      ...crossings(carId(0), 1, 90_000, 0),
      ...crossings(carId(0), 2, 90_000, 90_000),
      ...crossings(carId(0), 3, 96_000, 180_000),
      ...[1, 2, 3].flatMap((n) => crossings(carId(1), n, 93_000, (n - 1) * 93_000)),
    ]);
    const lines = gapperLines(run(viewOf(ms)), { kind: 'leaderAverage' });
    expect(v(lines.referenceLapMs)).toBe(92_000);
    expect(line(lines, 0)).toEqual([[1, 2_000], [2, 4_000], [3, 0]]);
    expect(line(lines, 1)).toEqual([[1, -1_000], [2, -2_000], [3, -3_000]]);
  });

  it('before any completed lap the reference is insufficientData and no car has a line', () => {
    const ms = field({ cars: 2, laps: 1, paceMs: 90_000 }).miniSectors.filter((m) => m.segment < 30);
    const lines = gapperLines(run(viewOf(ms)), { kind: 'leaderAverage' });
    expect(lines.referenceLapMs).toEqual({ known: false, reason: 'insufficientData' });
    expect(lines.cars.every((c) => c.byLap.length === 0)).toBe(true);
  });
});

describe('neighbourhood', () => {
  // every car at 90 s; behind car 0 by: car 1 3.5 s, car 2 4 s, car 3 6 s, car 4 10 s, car 5 10.5 s (positions 1..6)
  const race = offsetRace([0, 3_500, 4_000, 6_000, 10_000, 10_500], 2);
  const viewFor = (playerCar: number, config: EngineView['config'] = {}) => viewOf(race, { playerCar, config });

  it('the neighbourhood holds cars within ±1 position or ±3000 ms of the player car', () => {
    // around car 3: car 1 is 2.5 s ahead, car 2 2 s ahead and P3, car 4 4 s behind but P5; car 0 and 5 are neither
    const out = run(viewFor(3));
    expect(out.neighbourhood).toEqual([{ ourCarId: 3, carIds: [1, 2, 4] }]);
  });

  it('uses neighbourhoodMs from the config', () => {
    const out = run(viewFor(3, { [GAPS_CONFIG.key]: { neighbourhoodMs: 1_000 } }));
    expect(neighbours(out, 3)).toEqual([2, 4]);
  });

  it('the neighbourhood follows a playerCar change', () => {
    const first = viewFor(0);
    const acc = gapsCalculator.init(first);
    expect(gapsCalculator.output(acc).neighbourhood).toEqual([{ ourCarId: 0, carIds: [1] }]);
    // the same history, a new player car: no crossing is new
    const next = viewFor(5);
    const moved = gapsCalculator.output(gapsCalculator.update(acc, deltaOf(first, next), next));
    expect(moved.neighbourhood).toEqual([{ ourCarId: 5, carIds: [4] }]);
  });

  it('has one entry per our car: the player and the teammate', () => {
    const base = viewFor(3);
    const view: EngineView = { ...base, state: { ...base.state, teammateCar: carId(0) } };
    const out = run(view);
    expect(out.neighbourhood).toHaveLength(2);
    expect(out.neighbourhood).toEqual(
      expect.arrayContaining([
        { ourCarId: 3, carIds: [1, 2, 4] },
        { ourCarId: 0, carIds: [1] },
      ]),
    );
  });
});
