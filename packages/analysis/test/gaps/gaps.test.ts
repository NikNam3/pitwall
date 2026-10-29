import { carId, type Interval, type Known } from '@pitwall/domain';
import type { EngineView } from '@pitwall/engine';
import { describe, expect, it } from 'vitest';
import { GAPS, GAPS_CONFIG, type GapsOutput } from '../../src/gaps/index.ts';
import { gapsCalculator } from '../../src/gaps/calculator.ts';
import { gapperLines, gapsToCar } from '../../src/gaps/gaps.ts';
import { crossings, field } from '../../../../test-support/builders/index.ts';
import { byTime, carsFor, deltaOf, offsetRace, plain, progressOf, run, viewOf } from './race.ts';

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

  it('reads identity, so a playerCar change re-runs it', () => {
    expect(gapsCalculator.reads).toContain('identity');
  });

  it('raceStartAt is the lights-out time', () => {
    expect(run(viewOf(threeCars(), { lightsOutAt: 0 })).raceStartAt).toMatchObject({ known: true, value: 0 });
    expect(run(viewOf(offsetRace([0, 1_000], 1, 90_000), { lightsOutAt: 4_200 })).raceStartAt).toMatchObject({ known: true, value: 4_200 });
  });

  it('raceStartAt is notReceived before lights out and follows the event when it arrives', () => {
    const before = viewOf([], { lightsOutAt: null });
    const acc = gapsCalculator.init(before);
    expect(gapsCalculator.output(acc).raceStartAt).toEqual({ known: false, reason: 'notReceived' });
    const after = viewOf([], { lightsOutAt: 12_000 });
    const out = gapsCalculator.output(gapsCalculator.update(acc, deltaOf(before, after), after));
    expect(out.raceStartAt).toMatchObject({ known: true, value: 12_000 });
    expect(out).toEqual(run(after));
  });

  it('raceStartAt is notApplicable outside a race', () => {
    const out = run(viewOf(threeCars(), { kind: 'practice', lightsOutAt: null }));
    expect(out.raceStartAt).toEqual({ known: false, reason: 'notApplicable' });
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
    // car 1 completes lap 2 at (3, 0) at 182 s, 2 s behind car 0
    let n = all.findIndex((m) => m.carId === 1 && m.lap === 3 && m.segment === 0) + 1;
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
    // lap 3, segment s (1..49, then the line at (4, 0) as s = 50): car 1 at 182 000 + 1820 s, car 0 at 180 000 + 1800 s
    expect(seen).toEqual(Array.from({ length: 50 }, (_, k) => 2_000 + 20 * (k + 1)));
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
    // the line that completes lap 3 is segment 0 of lap 4
    expect(full.latest[carId(1)]).toEqual({ lap: 4, segment: 0, at: 273_000 });

    // mid lap 3: car 1 has crossed segment 10 at 182 000 + 10 * 1820
    const mid = run(viewOf(all.filter((m) => m.at <= 200_200)));
    expect(mid.lineTimes[carId(1)]).toEqual([
      { lap: 1, at: 91_000 },
      { lap: 2, at: 182_000 },
    ]);
    expect(mid.latest[carId(1)]).toEqual({ lap: 3, segment: 10, at: 200_200 });
  });

  it('recent keeps at most 100 crossings per car, by progress, ending at its latest crossing', () => {
    const all = field({ cars: 2, laps: 3, paceMs: [90_000, 91_000] }).miniSectors;
    const out = run(viewOf(all));
    const rec = out.recent[carId(1)]!;
    // car 1's latest crossing is (4, 0) at progress 150: the window is progress 51..150
    expect(rec.at).toHaveLength(100);
    expect(rec.fromProgress + rec.at.length - 1).toBe(progressOf(out.latest[carId(1)]!));
    expect(rec.fromProgress).toBe(51);
    const raw = new Map(all.filter((m) => m.carId === 1).map((m) => [progressOf(m), m.at]));
    expect(rec.at).toEqual(Array.from({ length: 100 }, (_, i) => raw.get(51 + i)));
  });

  it('recent holds every crossing of a car that has fewer than 100', () => {
    const ms = field({ cars: 1, laps: 1, paceMs: 90_000 }).miniSectors.filter((m) => m.lap === 1 && m.segment <= 20);
    expect(run(viewOf(ms)).recent[carId(0)]).toEqual({ fromProgress: 0, at: ms.map((m) => m.at) });
  });

  it('an output taken before an update keeps its old window', () => {
    const all = field({ cars: 2, laps: 3, paceMs: [90_000, 91_000] }).miniSectors;
    const early = viewOf(all.slice(0, 200));
    const acc = gapsCalculator.init(early);
    const before = gapsCalculator.output(acc);
    const copy = structuredClone(before);
    const full = viewOf(all);
    const after = gapsCalculator.output(gapsCalculator.update(acc, deltaOf(early, full), full));
    expect(before).toEqual(copy);
    expect(after.recent).not.toEqual(copy.recent);
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

  it('is exact for two cars at different points: their times at the last point both passed', () => {
    // one lap; car 0 loses 400 ms in each of segments 27..30, so the leader-relative gaps of cars 1 and 2 differ from
    // their gap to each other. At 60 s car 0 is at segment 32, car 1 at 31, car 2 at 26.
    const times: Record<number, (s: number) => number> = {
      0: (s) => 1_800 * s + 400 * Math.min(Math.max(s - 26, 0), 4),
      1: (s) => 3_000 + 1_800 * s,
      2: (s) => 13_000 + 1_800 * s,
    };
    const ms = byTime(
      [0, 1, 2].flatMap((i) =>
        Array.from({ length: 50 }, (_, segment) => ({ carId: carId(i), lap: 1, segment, at: times[i]!(segment) })),
      ),
    ).filter((m) => m.at <= 60_000);
    const out = run(viewOf(ms));
    expect(out.latest[carId(2)]).toMatchObject({ segment: 26 });
    expect(out.latest[carId(1)]).toMatchObject({ segment: 31 });
    // at segment 26: car 2 at 59 800, car 1 at 49 800
    const gap = (a: number, to: number) => v(gapsToCar(out, carId(to))!.find((g) => g.carId === a)!.gapMs);
    expect(gap(2, 1)).toBe(10_000);
    expect(gap(1, 2)).toBe(-10_000);
    expect(v(interval(out, 2).toAheadMs)).toBe(10_000);
    expect(v(interval(out, 1).toBehindMs)).toBe(10_000);
  });

  it('a lapped pair from both sides: lapsDown ±k and the gap at the same place k laps apart', () => {
    // at 950 s: car 0 (90 s laps) at progress 527, car 1 (100 s) at 475, car 2 (120 s) at 395
    const ms = field({ cars: 3, laps: 11, paceMs: [90_000, 100_000, 120_000] }).miniSectors.filter((m) => m.at <= 950_000);
    const out = run(viewOf(ms));
    const of = (a: number, to: number) => {
      const g = gapsToCar(out, carId(to))!.find((x) => x.carId === a)!;
      return [g.lapsDown, v(g.gapMs)];
    };
    // car 1 passed progress 475 at 950 000, car 0 passed 525 at 945 000
    expect(of(1, 0)).toEqual([1, 5_000]);
    expect(of(0, 1)).toEqual([-1, -5_000]);
    // car 2 passed 395 at 948 000; car 0 passed 495 at 891 000, car 1 passed 445 at 890 000
    expect(of(2, 0)).toEqual([2, 57_000]);
    expect(of(0, 2)).toEqual([-2, -57_000]);
    expect(of(2, 1)).toEqual([1, 58_000]);
    expect(of(1, 2)).toEqual([-1, -58_000]);
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
    // the leader laps 90, 90 and 96 s (mean 92 s); car 1 laps 93 s; each closes lap 3 at (4, 0)
    const ms = byTime([
      ...crossings(carId(0), 1, 90_000, 0),
      ...crossings(carId(0), 2, 90_000, 90_000),
      ...crossings(carId(0), 3, 96_000, 180_000),
      { carId: carId(0), lap: 4, segment: 0, at: 276_000 },
      ...[1, 2, 3].flatMap((n) => crossings(carId(1), n, 93_000, (n - 1) * 93_000)),
      { carId: carId(1), lap: 4, segment: 0, at: 279_000 },
    ]);
    const lines = gapperLines(run(viewOf(ms)), { kind: 'leaderAverage' });
    expect(v(lines.referenceLapMs)).toBe(92_000);
    expect(line(lines, 0)).toEqual([[1, 2_000], [2, 4_000], [3, 0]]);
    expect(line(lines, 1)).toEqual([[1, -1_000], [2, -2_000], [3, -3_000]]);
  });

  it("counts each car's race time from lights out: a race that starts at 60 s gives the same lines", () => {
    // the lights go out at 60 s; cars at 90, 91 and 92 s cross the line at 60 000 + n * pace
    const start = 60_000;
    const pace = (i: number) => 90_000 + 1_000 * i;
    const ms = byTime(
      [0, 1, 2].flatMap((i) => [
        ...[1, 2, 3].flatMap((n) => crossings(carId(i), n, pace(i), start + (n - 1) * pace(i))),
        { carId: carId(i), lap: 4, segment: 0, at: start + 3 * pace(i) },
      ]),
    );
    const out = run(viewOf(ms, { lightsOutAt: start }));
    expect(out.raceStartAt).toMatchObject({ known: true, value: start });
    const leader = gapperLines(out, { kind: 'leaderAverage' });
    expect(v(leader.referenceLapMs)).toBe(90_000);
    expect(line(leader, 0)).toEqual([[1, 0], [2, 0], [3, 0]]);
    expect(line(leader, 2)).toEqual([[1, -2_000], [2, -4_000], [3, -6_000]]);
    const fixed = gapperLines(out, { kind: 'fixed', lapMs: 89_000 });
    expect(line(fixed, 1)).toEqual([[1, -2_000], [2, -4_000], [3, -6_000]]);
  });

  it('without a known race start no car has a line', () => {
    const lines = gapperLines(run(viewOf(threeCars(), { lightsOutAt: null })), { kind: 'fixed', lapMs: 90_000 });
    expect(lines.cars.every((c) => c.byLap.length === 0)).toBe(true);
  });

  it('before any completed lap the reference is insufficientData and no car has a line', () => {
    // without field's closing (2, 0) crossing, nobody has completed lap 1
    const ms = field({ cars: 2, laps: 1, paceMs: 90_000 }).miniSectors.filter((m) => m.lap === 1 && m.segment < 30);
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
