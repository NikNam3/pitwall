import { carId, known, unknown, type Interval, type Known } from '@pitwall/domain';
import type { EngineView } from '@pitwall/engine';
import { describe, expect, it } from 'vitest';
import { GAPS, GAPS_CONFIG, type GapsOutput } from '../../src/gaps/index.ts';
import { gapsCalculator } from '../../src/gaps/calculator.ts';
import { gapperLines, gapsToCar } from '../../src/gaps/gaps.ts';
import { crossings, field, neutralisation, openNeutralisation } from '../../../../test-support/builders/index.ts';
import { byTime, carsFor, deltaOf, guarded, offsetRace, plain, progressOf, run, viewOf } from './race.ts';

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
const threeCars = () => field({ cars: 3, laps: 5, paceMs: [90_000, 91_000, 92_000] }).crossings;

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

  it('raceStartAt is the start of the race session phase `racing`, the lights-out time', () => {
    expect(run(viewOf(threeCars(), { lightsOutAt: 0 })).raceStartAt).toMatchObject({ known: true, value: 0 });
    expect(run(viewOf(offsetRace([0, 1_000], 1, 90_000), { lightsOutAt: 4_200 })).raceStartAt).toMatchObject({ known: true, value: 4_200 });
  });

  it('raceStartAt is notReceived before the race starts and follows the `racing` span when it opens', () => {
    const before = viewOf([], { lightsOutAt: null });
    const acc = gapsCalculator.init(guarded(before));
    expect(gapsCalculator.output(acc).raceStartAt).toEqual({ known: false, reason: 'notReceived' });
    const after = viewOf([], { lightsOutAt: 12_000 });
    const out = gapsCalculator.output(gapsCalculator.update(acc, deltaOf(before, after), guarded(after)));
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
    const all = field({ cars: 2, laps: 3, paceMs: [90_000, 91_000] }).crossings;
    // car 1 completes lap 2 at (3, 0) at 182 s, 2 s behind car 0
    let n = all.findIndex((m) => m.carId === 1 && m.lap === 3 && m.segment === 0) + 1;
    let view = viewOf(all.slice(0, n));
    let acc = gapsCalculator.init(guarded(view));
    expect(v(interval(gapsCalculator.output(acc), 1).toLeaderMs)).toBe(2_000);
    const seen: (number | string)[] = [];
    for (; n < all.length; n++) {
      const next = viewOf(all.slice(0, n + 1));
      acc = gapsCalculator.update(acc, deltaOf(view, next), guarded(next));
      view = next;
      if (all[n]!.carId === 1) seen.push(v(interval(gapsCalculator.output(acc), 1).toLeaderMs));
    }
    // lap 3, segment s (1..49, then the line at (4, 0) as s = 50): car 1 at 182 000 + 1820 s, car 0 at 180 000 + 1800 s
    expect(seen).toEqual(Array.from({ length: 50 }, (_, k) => 2_000 + 20 * (k + 1)));
  });

  it("the gaps come from the crossings, never from the game's gaps", () => {
    const ms = threeCars();
    const cars = carsFor(ms).map((c) => ({ ...c, timing: { ...c.timing, gapToLeaderMs: known(77_777, 0), gapToCarAheadMs: known(33_333, 0) } }));
    expect(run(viewOf(ms, { cars }))).toEqual(run(viewOf(ms)));
  });

  it('a lapped car has lapsDown 1 and gap to leader under one lap', () => {
    // car 0 at 90 s, car 1 at 100 s; at 950 s car 0 is at lap 11 segment 26, car 1 at lap 10 segment 24
    const ms = field({ cars: 2, laps: 11, paceMs: [90_000, 100_000] }).crossings.filter((m) => m.at <= 950_000);
    const lapped = interval(run(viewOf(ms)), 1);
    expect(lapped.lapsDown).toBe(1);
    // the leader passed lap 11 segment 24 at 945 s, car 1 passed the same point (lap 10) at 950 s
    expect(v(lapped.toLeaderMs)).toBe(5_000);
  });

  it('a car without a crossing yet has no known gap', () => {
    const ms = field({ cars: 2, laps: 1, paceMs: 90_000 }).crossings;
    const cars = carsFor(ms, { 2: { position: 3 } });
    const out = run(viewOf(ms, { cars }));
    expect(interval(out, 2).toLeaderMs.known).toBe(false);
    expect(interval(out, 2).toAheadMs.known).toBe(false);
  });

  it.each(['retired', 'disqualified'] as const)('a %s car is not in the intervals or the neighbourhood', (status) => {
    // car 3 ran two laps at 90.5 s and stopped; the car state still has it at P2
    const ms = byTime([
      ...threeCars(),
      ...crossings(carId(3), 1, 90_500, 0),
      ...crossings(carId(3), 2, 90_500, 90_500),
    ]);
    const cars = carsFor(ms, { 3: { position: 2 }, 1: { position: 3 }, 2: { position: 4 } });
    const out = run(viewOf(ms, { cars, status: { 3: status } }));
    expect(out.intervals.map((i) => i.carId)).toEqual([0, 1, 2]);
    expect(v(interval(out, 1).toAheadMs)).toBe(5_000);
    expect(v(interval(out, 0).toBehindMs)).toBe(5_000);
    expect(out.neighbourhood.map((n) => n.ourCarId)).toEqual([0]);
    expect(neighbours(out, 0)).not.toContain(3);
  });

  it('lineTimes holds the line crossing of every completed lap', () => {
    const all = field({ cars: 2, laps: 3, paceMs: [90_000, 91_000] }).crossings;
    const full = run(viewOf(all));
    expect(full.lineTimes[carId(1)]).toEqual([
      { lap: 1, at: 91_000 },
      { lap: 2, at: 182_000 },
      { lap: 3, at: 273_000 },
    ]);

    // mid lap 3: car 1 has crossed segment 10 at 182 000 + 10 * 1820
    const mid = run(viewOf(all.filter((m) => m.at <= 200_200)));
    expect(mid.lineTimes[carId(1)]).toEqual([
      { lap: 1, at: 91_000 },
      { lap: 2, at: 182_000 },
    ]);
  });

  describe('positionsGained', () => {
    // five cars 1 s apart: car 2 runs P3
    const ms = offsetRace([0, 1_000, 2_000, 3_000, 4_000], 1);
    const gridded = (grid: number) =>
      carsFor(ms).map((c) => (c.id === 2 ? { ...c, timing: { ...c.timing, gridPosition: grid } } : c));
    const gained = (kind: 'race' | 'practice' | 'qualifying' | 'none', grid: number) => interval(run(viewOf(ms, { cars: gridded(grid), kind })), 2).positionsGained;

    it('in a race is the grid position minus the position now: from P5 to P3 is 2', () => {
      expect(gained('race', 5)).toMatchObject({ known: true, value: 2 });
    });

    it('is notApplicable outside a race', () => {
      expect(gained('practice', 5)).toEqual({ known: false, reason: 'notApplicable' });
    });

    it('is notReceived while the grid position is 0', () => {
      expect(gained('race', 0)).toEqual({ known: false, reason: 'notReceived' });
    });
  });

  it('recent keeps at most 100 crossings per car, by progress, ending at its latest crossing', () => {
    const all = field({ cars: 2, laps: 3, paceMs: [90_000, 91_000] }).crossings;
    const out = run(viewOf(all));
    const rec = out.recent[carId(1)]!;
    // car 1's latest crossing is (4, 0) at progress 150: the window is progress 51..150
    expect(rec.at).toHaveLength(100);
    expect(rec.fromProgress + rec.at.length - 1).toBe(progressOf({ lap: 4, segment: 0 }));
    expect(rec.fromProgress).toBe(51);
    const raw = new Map(all.filter((m) => m.carId === 1).map((m) => [progressOf(m), m.at]));
    expect(rec.at).toEqual(Array.from({ length: 100 }, (_, i) => raw.get(51 + i)));
  });

  it('recent holds every crossing of a car that has fewer than 100', () => {
    const ms = field({ cars: 1, laps: 1, paceMs: 90_000 }).crossings.filter((m) => m.lap === 1 && m.segment <= 20);
    expect(run(viewOf(ms)).recent[carId(0)]).toEqual({ fromProgress: 0, at: ms.map((m) => m.at) });
  });

  it('an output taken before an update keeps its old window', () => {
    const all = field({ cars: 2, laps: 3, paceMs: [90_000, 91_000] }).crossings;
    const early = viewOf(all.slice(0, 200));
    const acc = gapsCalculator.init(guarded(early));
    const before = gapsCalculator.output(acc);
    const copy = structuredClone(before);
    const full = viewOf(all);
    const after = gapsCalculator.output(gapsCalculator.update(acc, deltaOf(early, full), guarded(full)));
    expect(before).toEqual(copy);
    expect(after.recent).not.toEqual(copy.recent);
  });

  it('update over deltas equals init over the whole history', () => {
    const all = field({ cars: 3, laps: 4, paceMs: [90_000, 91_000, 92_500] }).crossings;
    let view = viewOf([]);
    let acc = gapsCalculator.init(guarded(view));
    for (let n = 37; n < all.length + 37; n += 37) {
      const next = viewOf(all.slice(0, n));
      acc = gapsCalculator.update(acc, deltaOf(view, next), guarded(next));
      view = next;
      expect(gapsCalculator.output(acc)).toEqual(run(next));
    }
  });

  it('flashback equals fresh run', () => {
    const all = field({ cars: 3, laps: 6, paceMs: [90_000, 91_000, 92_500] }).crossings;
    const early = viewOf(all.slice(0, 400));
    const full = viewOf(all);
    const acc = gapsCalculator.update(gapsCalculator.init(guarded(early)), deltaOf(early, full), guarded(full));
    const truncated = viewOf(all.slice(0, 250));
    const back = gapsCalculator.update(acc, deltaOf(full, truncated, true), guarded(truncated));
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

  it('gives the car itself notApplicable: it has no gap to itself', () => {
    const self = gapsToCar(run(viewOf(threeCars())), carId(1))!.find((g) => g.carId === carId(1));
    expect(self).toEqual({ carId: carId(1), gapMs: unknown('notApplicable'), lapsDown: 0 });
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
        Array.from({ length: 50 }, (_, segment) => ({ carId: carId(i), lap: 1, segment, at: times[i]!(segment), frame: 0 })),
      ),
    ).filter((m) => m.at <= 60_000);
    const out = run(viewOf(ms));
    // car 2's latest crossing is segment 26, car 1's segment 31 (progress = segment on lap 1)
    expect(out.recent[carId(2)]!.at).toHaveLength(27);
    expect(out.recent[carId(1)]!.at).toHaveLength(32);
    // at segment 26: car 2 at 59 800, car 1 at 49 800
    const gap = (a: number, to: number) => v(gapsToCar(out, carId(to))!.find((g) => g.carId === a)!.gapMs);
    expect(gap(2, 1)).toBe(10_000);
    expect(gap(1, 2)).toBe(-10_000);
    expect(v(interval(out, 2).toAheadMs)).toBe(10_000);
    expect(v(interval(out, 1).toBehindMs)).toBe(10_000);
  });

  it('a lapped pair from both sides: lapsDown ±k and the gap at the same place k laps apart', () => {
    // at 950 s: car 0 (90 s laps) at progress 527, car 1 (100 s) at 475, car 2 (120 s) at 395
    const ms = field({ cars: 3, laps: 11, paceMs: [90_000, 100_000, 120_000] }).crossings.filter((m) => m.at <= 950_000);
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

  // The analysis decides the reason of a car out of the race (review 2, F6): its gap will not come, so the display
  // shows the analysis' reason and keeps no rule of its own.
  it.each(['retired', 'disqualified'] as const)('gives a %s car notApplicable: its gap will not come', (status) => {
    // car 3 ran two laps at 90.5 s and stopped; the car state still has it at P2
    const ms = byTime([...threeCars(), ...crossings(carId(3), 1, 90_500, 0), ...crossings(carId(3), 2, 90_500, 90_500)]);
    const out = run(viewOf(ms, { cars: carsFor(ms, { 3: { position: 2 }, 1: { position: 3 }, 2: { position: 4 } }), status: { 3: status } }));
    expect(gapsToCar(out, carId(1))!.find((g) => g.carId === carId(3))).toEqual({ carId: carId(3), gapMs: unknown('notApplicable'), lapsDown: 0 });
  });

  it("lists every car out of the race, one without a crossing too, beside the running cars' gaps", () => {
    // car 3 retired after two laps, car 4 was disqualified before its first crossing
    const ms = byTime([...threeCars(), ...crossings(carId(3), 1, 90_500, 0), ...crossings(carId(3), 2, 90_500, 90_500)]);
    const cars = carsFor(ms, { 3: { position: 2 }, 4: { position: 5 }, 1: { position: 3 }, 2: { position: 4 } });
    const toCar1 = gapsToCar(run(viewOf(ms, { cars, status: { 3: 'retired', 4: 'disqualified' } })), carId(1))!;
    expect(toCar1.map((g) => g.carId).sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
    expect(toCar1.filter((g) => g.gapMs.known).map((g) => [g.carId, v(g.gapMs)])).toEqual([[0, -5_000], [2, 5_000]]);
    expect(toCar1.find((g) => g.carId === carId(4))?.gapMs).toEqual(unknown('notApplicable'));
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
      { carId: carId(0), lap: 4, segment: 0, at: 276_000, frame: 0 },
      ...[1, 2, 3].flatMap((n) => crossings(carId(1), n, 93_000, (n - 1) * 93_000)),
      { carId: carId(1), lap: 4, segment: 0, at: 279_000, frame: 0 },
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
        { carId: carId(i), lap: 4, segment: 0, at: start + 3 * pace(i), frame: 0 },
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

  it('names the reference it resolved: a car for carAverage, none for leaderAverage and fixed', () => {
    expect(gapperLines(out(), { kind: 'carAverage', carId: carId(1) }).reference).toEqual({ kind: 'carAverage', carId: { known: true, value: carId(1), at: 0 } });
    expect(gapperLines(out(), { kind: 'leaderAverage' }).reference).toEqual({ kind: 'leaderAverage', carId: { known: false, reason: 'notApplicable' } });
    expect(gapperLines(out(), { kind: 'fixed', lapMs: 89_000 }).reference).toEqual({ kind: 'fixed', carId: { known: false, reason: 'notApplicable' } });
  });

  it('without a known race start no car has a line', () => {
    const lines = gapperLines(run(viewOf(threeCars(), { lightsOutAt: null })), { kind: 'fixed', lapMs: 90_000 });
    expect(lines.cars.every((c) => c.byLap.length === 0)).toBe(true);
  });

  it("before the leader's first crossing after lights out the leader average is insufficientData and no car has a line", () => {
    // every crossing (lap 1, mini-sectors 0 to 29, up to 52 200) lies before the lights go out at 60 s
    const ms = field({ cars: 2, laps: 1, paceMs: 90_000 }).crossings.filter((m) => m.lap === 1 && m.segment < 30);
    const lines = gapperLines(run(viewOf(ms, { lightsOutAt: 60_000 })), { kind: 'leaderAverage' });
    expect(lines.referenceLapMs).toEqual({ known: false, reason: 'insufficientData' });
    expect(lines.cars.every((c) => c.byLap.length === 0 && !c.now.known)).toBe(true);
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
    const acc = gapsCalculator.init(guarded(first));
    expect(gapsCalculator.output(acc).neighbourhood).toEqual([{ ourCarId: 0, carIds: [1] }]);
    // the same history, a new player car: no crossing is new
    const next = viewFor(5);
    const moved = gapsCalculator.output(gapsCalculator.update(acc, deltaOf(first, next), guarded(next)));
    expect(moved.neighbourhood).toEqual([{ ourCarId: 5, carIds: [4] }]);
  });

  it('has one entry per our car: the player and the teammate', () => {
    const base = viewFor(3);
    const view: EngineView = { ...base, live: { ...base.live, teammateCar: carId(0) } };
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

describe('gapper lines are continuous', () => {
  it('every car has one point per lap it completed, laps 1 to n with none missing, a lapped car included', () => {
    // the leader laps in 90 s, car 1 in 110 s: at 560 s the leader has completed 6 laps and car 1 5, a lap down
    const ms = byTime([
      ...[1, 2, 3, 4, 5, 6].flatMap((n) => crossings(carId(0), n, 90_000, (n - 1) * 90_000)),
      { carId: carId(0), lap: 7, segment: 0, at: 540_000, frame: 0 },
      ...[1, 2, 3, 4, 5].flatMap((n) => crossings(carId(1), n, 110_000, (n - 1) * 110_000)),
      { carId: carId(1), lap: 6, segment: 0, at: 550_000, frame: 0 },
    ]).filter((m) => m.at <= 560_000);
    const out = run(viewOf(ms));
    expect(interval(out, 1).lapsDown).toBe(1);
    // the virtual car at 90 s: the leader stays on it, car 1 loses 20 s each lap
    const lines = gapperLines(out, { kind: 'fixed', lapMs: 90_000 });
    expect(line(lines, 0)).toEqual([1, 2, 3, 4, 5, 6].map((lap) => [lap, 0]));
    expect(line(lines, 1)).toEqual([1, 2, 3, 4, 5].map((lap) => [lap, -20_000 * lap]));
  });
});

describe("the gapper's live point (now)", () => {
  /** A car's `now` as `{ lap, gapMs, at }` (with -0 as 0), or the reason it is unknown. */
  const nowOf = (lines: ReturnType<typeof gapperLines>, id: number) => {
    const car = lines.cars.find((c) => c.carId === id);
    if (car === undefined) throw new Error(`no line for car ${id}`);
    const { now } = car;
    return now.known ? { lap: now.value.lap, gapMs: plain(now.value.gapMs), at: now.at } : now.reason;
  };
  const knownNow = (lines: ReturnType<typeof gapperLines>, id: number) => {
    const now = nowOf(lines, id);
    if (typeof now === 'string') throw new Error(`car ${id} has no now: ${now}`);
    return now;
  };

  /**
   * Car 0 at 90 s has completed laps 1 and 2 and crossed mini-sector 25 of lap 3 (at 225 s); car 1 at 91 s has
   * completed 2 laps and crossed mini-sector 10 of lap 3 (at 200.2 s). Every time is shifted by `start`.
   */
  const midLap = (start = 0) =>
    byTime([
      ...[1, 2].flatMap((n) => crossings(carId(0), n, 90_000, start + (n - 1) * 90_000)),
      ...crossings(carId(0), 3, 90_000, start + 180_000).filter((m) => m.segment <= 25),
      ...[1, 2].flatMap((n) => crossings(carId(1), n, 91_000, start + (n - 1) * 91_000)),
      ...crossings(carId(1), 3, 91_000, start + 182_000).filter((m) => m.segment <= 10),
    ]);

  it('is the gap at the newest crossing: completed laps + crossed mini-sectors / 50 at the reference lap, minus the race time', () => {
    const lines = gapperLines(run(viewOf(midLap())), { kind: 'fixed', lapMs: 89_000 });
    // car 0: 2.5 × 89 000 − 225 000
    expect(nowOf(lines, 0)).toEqual({ lap: 2.5, gapMs: -2_500, at: 225_000 });
    // car 1: 2.2 × 89 000 − 200 200
    const car1 = knownNow(lines, 1);
    expect(car1.lap).toBeCloseTo(2.2, 9);
    expect([car1.gapMs, car1.at]).toEqual([-4_400, 200_200]);
    // the completed laps stay as they were
    expect(line(lines, 0)).toEqual([[1, -1_000], [2, -2_000]]);
  });

  it('counts the race time from lights out: a race that starts at 60 s gives the same live point', () => {
    const lines = gapperLines(run(viewOf(midLap(60_000), { lightsOutAt: 60_000 })), { kind: 'fixed', lapMs: 89_000 });
    expect(nowOf(lines, 0)).toEqual({ lap: 2.5, gapMs: -2_500, at: 285_000 });
  });

  it('is whole ms when the reference lap does not divide into 50 mini-sectors', () => {
    const lines = gapperLines(run(viewOf(midLap())), { kind: 'fixed', lapMs: 90_001 });
    const car1 = knownNow(lines, 1);
    expect(Number.isInteger(car1.gapMs)).toBe(true);
    expect(Math.abs(car1.gapMs - (2.2 * 90_001 - 200_200))).toBeLessThanOrEqual(0.5);
  });

  it('a lapped car counts its own laps, not the leader\'s', () => {
    // the leader laps in 90 s, car 1 in 110 s: at 560 s the leader is at (7, 11), car 1 a lap down at (6, 4)
    const ms = byTime([
      ...[1, 2, 3, 4, 5, 6, 7].flatMap((n) => crossings(carId(0), n, 90_000, (n - 1) * 90_000)),
      ...[1, 2, 3, 4, 5, 6].flatMap((n) => crossings(carId(1), n, 110_000, (n - 1) * 110_000)),
    ]).filter((m) => m.at <= 560_000);
    const out = run(viewOf(ms));
    expect(interval(out, 1).lapsDown).toBe(1);
    const lines = gapperLines(out, { kind: 'fixed', lapMs: 90_000 });
    // the leader: 6.22 × 90 000 − 559 800; car 1: 5.08 × 90 000 − 558 800
    const leader = knownNow(lines, 0);
    const lapped = knownNow(lines, 1);
    expect(leader.lap).toBeCloseTo(6.22, 9);
    expect(lapped.lap).toBeCloseTo(5.08, 9);
    expect([leader.gapMs, leader.at, lapped.gapMs, lapped.at]).toEqual([0, 559_800, -101_600, 558_800]);
  });

  it('is notApplicable before the car\'s first crossing after lights out', () => {
    // the lights go out at 10 s: car 0 crossed the line before them only, car 1 has crossed mini-sector 5 since
    const ms = byTime([
      { carId: carId(0), lap: 1, segment: 0, at: 0, frame: 0 },
      { carId: carId(1), lap: 1, segment: 0, at: 0, frame: 0 },
      { carId: carId(1), lap: 1, segment: 5, at: 19_000, frame: 0 },
    ]);
    const lines = gapperLines(run(viewOf(ms, { lightsOutAt: 10_000 })), { kind: 'fixed', lapMs: 90_000 });
    expect(nowOf(lines, 0)).toBe('notApplicable');
    // 0.1 × 90 000 − 9 000
    expect(nowOf(lines, 1)).toEqual({ lap: expect.closeTo(0.1, 9), gapMs: 0, at: 19_000 });
  });

  it('is notApplicable at the line: the live point would be the completed lap\'s point', () => {
    const lines = gapperLines(run(viewOf(threeCars())), { kind: 'leaderAverage' });
    expect([0, 1, 2].map((id) => nowOf(lines, id))).toEqual(['notApplicable', 'notApplicable', 'notApplicable']);
    expect(line(lines, 1)).toEqual([1, 2, 3, 4, 5].map((lap) => [lap, -1_000 * lap]));
  });

  it('is unknown for every car without a known race start or reference lap', () => {
    const noStart = gapperLines(run(viewOf(midLap(), { lightsOutAt: null })), { kind: 'fixed', lapMs: 90_000 });
    expect(noStart.cars.filter((c) => c.now.known).map((c) => c.carId)).toEqual([]);
    // every crossing lies before the lights go out at 60 s, so the leader average is insufficientData
    const ms = field({ cars: 2, laps: 1, paceMs: 90_000 }).crossings.filter((m) => m.lap === 1 && m.segment < 30);
    const noReference = gapperLines(run(viewOf(ms, { lightsOutAt: 60_000 })), { kind: 'leaderAverage' });
    expect(noReference.cars.filter((c) => c.now.known).map((c) => c.carId)).toEqual([]);
  });
});

// The game sends no line crossing at the chequered flag: a finisher keeps its lap number while its lap distance wraps,
// so the engine's crossings end at the last mini-sector before the line, and none follow (review 2, F1). The engine
// will record the finish crossing itself (plan Task 3). Either way the newest crossing is where the car's race ended,
// so the gapper has no rule of its own for a finished car: its final lap stays on the chart.
describe('the gapper line of a finished car', () => {
  /**
   * Car 0 leads: laps 1 and 2 in 90 s, its final lap 3 in 96 s, its crossings ending at mini-sector 49 of lap 3 (at
   * 274 080), or with `atLine` at the finish line (4, 0) at 276 000. Car 1 laps in 95 s and is still racing in lap 3,
   * its crossings up to the same moment.
   */
  const finish = (atLine: boolean) => {
    const end = atLine ? 276_000 : 274_080;
    return byTime([
      ...[1, 2].flatMap((n) => crossings(carId(0), n, 90_000, (n - 1) * 90_000)),
      ...crossings(carId(0), 3, 96_000, 180_000),
      ...(atLine ? [{ carId: carId(0), lap: 4, segment: 0, at: 276_000, frame: 0 }] : []),
      ...[1, 2, 3].flatMap((n) => crossings(carId(1), n, 95_000, (n - 1) * 95_000)).filter((m) => m.at <= end),
    ]);
  };
  const fixed = { kind: 'fixed', lapMs: 90_000 } as const;
  const nowOf = (lines: ReturnType<typeof gapperLines>, id: number) => lines.cars.find((c) => c.carId === id)?.now;

  it('keeps the live point of a finisher whose crossings end before the line: its final lap stays on the chart', () => {
    const ms = finish(false);
    const lines = gapperLines(run(viewOf(ms, { now: 'finished' })), fixed);
    expect(line(lines, 0)).toEqual([[1, 0], [2, 0]]);
    // progress 149 (lap 3, mini-sector 49): 149 / 50 laps at 90 s is 268 200, its race time 274 080
    expect(nowOf(lines, 0)).toEqual(known({ lap: 2.98, gapMs: -5_880 }, 274_080));
  });

  it('settles the final lap of a finisher whose crossings end at the finish line, with no live point at the line', () => {
    const ms = finish(true);
    const lines = gapperLines(run(viewOf(ms, { now: 'finished' })), fixed);
    expect(line(lines, 0)).toEqual([[1, 0], [2, 0], [3, -6_000]]);
    expect(nowOf(lines, 0)).toEqual(unknown('notApplicable'));
  });

  it("takes a finished leader's average at its newest crossing, its final lap included", () => {
    const ms = finish(false);
    const lines = gapperLines(run(viewOf(ms, { now: 'finished' })), { kind: 'leaderAverage' });
    // race time 274 080 over progress 149: 91 973.15 ms a lap (its last line crossing alone would give 90 000)
    expect(lines.referenceLapMs).toEqual(known(91_973, 274_080));
  });

  it.each([false, true])('the flag alone changes nothing: the lines equal those of the car still racing (at the line: %s)', (atLine) => {
    const ms = finish(atLine);
    for (const reference of [fixed, { kind: 'leaderAverage' } as const]) {
      expect(gapperLines(run(viewOf(ms, { now: 'finished' })), reference)).toEqual(gapperLines(run(viewOf(ms)), reference));
    }
  });

  it('a car that takes the flag without a new crossing keeps its live point through an update', () => {
    const ms = finish(false);
    const racing = viewOf(ms);
    const acc = gapsCalculator.init(guarded(racing));
    const flagged = viewOf(ms, { now: 'finished' });
    const out = gapsCalculator.output(gapsCalculator.update(acc, deltaOf(racing, flagged), guarded(flagged)));
    expect(nowOf(gapperLines(out, fixed), 0)).toEqual(known({ lap: 2.98, gapMs: -5_880 }, 274_080));
  });
});

// A car out of the race keeps its line (review 2, F2; ruling): its completed race laps as recorded, no live point. The
// chart names a line that ends early at its own end.
describe('the gapper line of a car out of the race', () => {
  /** Car 3 ran two laps at 90.5 s and stopped at mini-sector 10 of lap 3; the car state still has it at P2. */
  const ms = byTime([
    ...threeCars(),
    ...crossings(carId(3), 1, 90_500, 0),
    ...crossings(carId(3), 2, 90_500, 90_500),
    ...crossings(carId(3), 3, 90_500, 181_000).filter((m) => m.segment <= 10),
  ]);
  const out = (status: 'retired' | 'disqualified') =>
    run(viewOf(ms, { cars: carsFor(ms, { 3: { position: 2 }, 1: { position: 3 }, 2: { position: 4 } }), status: { 3: status } }));

  it.each(['retired', 'disqualified'] as const)('keeps a %s car\'s completed laps, with no live point', (status) => {
    const lines = gapperLines(out(status), { kind: 'fixed', lapMs: 90_000 });
    expect(lines.cars.find((c) => c.carId === carId(3))).toEqual({
      carId: carId(3),
      byLap: [{ lap: 1, gapMs: -500 }, { lap: 2, gapMs: -1_000 }],
      now: unknown('notApplicable'),
    });
  });

  it('keeps the running cars\' lines beside it, and the leader average of the running leader', () => {
    const lines = gapperLines(out('retired'), { kind: 'leaderAverage' });
    expect(lines.cars.map((c) => c.carId).sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
    expect(lines.referenceLapMs).toEqual(known(90_000, 450_000));
  });

  it('lists no line for a car out of the race without a completed race lap', () => {
    // car 4 stopped at mini-sector 20 of lap 1
    const early = byTime([...threeCars(), ...crossings(carId(4), 1, 91_000, 0).filter((m) => m.segment <= 20)]);
    const lines = gapperLines(run(viewOf(early, { cars: carsFor(early), status: { 4: 'retired' } })), { kind: 'fixed', lapMs: 90_000 });
    expect(lines.cars.map((c) => c.carId).sort((a, b) => a - b)).toEqual([0, 1, 2]);
  });
});

// Phase bands in the leader's progress (review RU4, wave 2 T6): the gapper carries the race's neutralisations (SC, VSC)
// and suspensions (red flag) on the chart's x, from the crossings at the span's start and end, so a band that ended
// mid-lap ends there. Since Task 19 they are the session-phase spans (C20): the closed `neutralised` and `suspended`
// spans of the projection plus the open one of the situation (`shared/neutralised.ts`); a `neutralised` span closed
// with `confirmed: false` is no neutralisation (C18, C43), an open one still waiting for its confirmation is one.
describe('the gapper phases', () => {
  /** Car 0 laps in 90 s (a mini-sector every 1.8 s) and leads throughout; car 1 laps in 92 s. 8 laps from 0. */
  const eightLaps = () => field({ cars: 2, laps: 8, paceMs: [90_000, 92_000] }).crossings;
  /** The phases as `[kind, fromLap, toLap or its reason]`, laps to 6 decimals. */
  const phasesOf = (lines: ReturnType<typeof gapperLines>) =>
    lines.phases.map((p) => [p.kind, round(p.fromLap), p.toLap.known ? round(p.toLap.value) : p.toLap.reason]);
  const round = (x: number) => Math.round(x * 1e6) / 1e6;
  const fixed = { kind: 'fixed', lapMs: 90_000 } as const;

  it('reads the session phases of every weekend phase, so a neutralisation or suspension that opens or closes re-runs it (C41)', () => {
    expect(gapsCalculator.reads).toEqual(expect.arrayContaining(['spans:session-phase-race', 'spans:session-phase-qualifying', 'spans:session-phase-practice']));
  });

  it("places a phase at the leader's newest crossing at its start and at its end: completed laps + mini-sectors / 50", () => {
    // SC from 200 500 to 299 999: the leader last crossed (3, 11) at 199 800 and (4, 16) at 298 800
    const sc = neutralisation({ kind: 'SC', start: 200_500, end: 299_999 });
    const lines = gapperLines(run(viewOf(eightLaps(), { phases: [sc] })), fixed);
    expect(phasesOf(lines)).toEqual([['SC', 2.22, 3.32]]);
  });

  it('places a phase that ended laps ago from the crossings of that time, not the recent ones', () => {
    // the race is at the end of lap 8; the VSC ran from (2, 5) at 99 000 to (2, 40) at 162 000
    const vsc = neutralisation({ kind: 'VSC', start: 99_000, end: 162_000 });
    const lines = gapperLines(run(viewOf(eightLaps(), { phases: [vsc] })), fixed);
    expect(phasesOf(lines)).toEqual([['VSC', 1.1, 1.8]]);
  });

  it('gives the open phase its start and toLap notApplicable, after the closed ones in their order', () => {
    // up to 560 s: an SC and a red flag (a suspension) closed, a VSC open since 500 000, where the leader last crossed (6, 27) at 498 600
    const ms = eightLaps().filter((m) => m.at <= 560_000);
    const sc = neutralisation({ kind: 'SC', start: 199_800, end: 298_800, id: 3 });
    const red = neutralisation({ kind: 'red', start: 360_000, end: 405_000, id: 5 });
    const open = openNeutralisation({ kind: 'VSC', start: 500_000, id: 7 });
    const lines = gapperLines(run(viewOf(ms, { phases: [sc, red], open })), fixed);
    expect(phasesOf(lines)).toEqual([
      ['SC', 2.22, 3.32],
      ['red', 4, 4.5],
      ['VSC', 5.54, 'notApplicable'],
    ]);
  });

  it('takes the leader at that moment: the car furthest along when the phase started and when it ended', () => {
    // car 0 laps in 90 s from 0; car 1 laps in 85 s from 3 s and passes it at 54 s, so car 1 leads from then on.
    // At 30 000 car 0 is at (1, 16) and car 1 at (1, 15); at 300 000 car 0 is at (4, 16) and car 1 at (4, 24).
    const ms = byTime([
      ...[1, 2, 3, 4, 5].flatMap((n) => crossings(carId(0), n, 90_000, (n - 1) * 90_000)),
      ...[1, 2, 3, 4, 5].flatMap((n) => crossings(carId(1), n, 85_000, 3_000 + (n - 1) * 85_000)),
    ]).filter((m) => m.at <= 400_000);
    const sc = neutralisation({ kind: 'SC', start: 30_000, end: 300_000 });
    const out = run(viewOf(ms, { phases: [sc] }));
    expect(out.intervals[0]?.carId).toBe(1);
    expect(phasesOf(gapperLines(out, fixed))).toEqual([['SC', 0.32, 3.48]]);
  });

  it('is the same for every reference: the phases do not depend on the virtual car', () => {
    const sc = neutralisation({ kind: 'SC', start: 200_500, end: 299_999 });
    const out = run(viewOf(eightLaps(), { phases: [sc] }));
    expect(gapperLines(out, { kind: 'leaderAverage' }).phases).toEqual(gapperLines(out, fixed).phases);
    expect(gapperLines(out, { kind: 'carAverage', carId: carId(1) }).phases).toEqual(gapperLines(out, fixed).phases);
  });

  it('is empty without a phase', () => {
    expect(gapperLines(run(viewOf(eightLaps())), fixed).phases).toEqual([]);
  });

  it('a `neutralised` span with `confirmed: false` is not a neutralisation for the gapper (C18, C43)', () => {
    const never = neutralisation({ kind: 'SC', start: 200_500, end: 203_500, confirmed: false });
    expect(gapperLines(run(viewOf(eightLaps(), { phases: [never] })), fixed).phases).toEqual([]);
    const vsc = neutralisation({ kind: 'VSC', start: 99_000, end: 162_000, id: 2 });
    expect(phasesOf(gapperLines(run(viewOf(eightLaps(), { phases: [never, vsc] })), fixed))).toEqual([['VSC', 1.1, 1.8]]);
  });

  it('an open neutralisation still waiting for its confirmation is on the gapper from its start (ruling 2: the earliest reliable signal, C18)', () => {
    const ms = eightLaps().filter((m) => m.at <= 250_000);
    const pending = openNeutralisation({ kind: 'SC', start: 200_500, confirmed: false });
    expect(phasesOf(gapperLines(run(viewOf(ms, { open: pending })), fixed))).toEqual([['SC', 2.22, 'notApplicable']]);
  });

  it('a pending neutralisation that closes unconfirmed leaves the gapper: update equals init (C18, C31)', () => {
    const ms = eightLaps();
    const waiting = viewOf(ms.filter((m) => m.at <= 202_000), { open: openNeutralisation({ kind: 'SC', start: 200_500, confirmed: false }) });
    const dropped = viewOf(ms.filter((m) => m.at <= 210_000), { phases: [neutralisation({ kind: 'SC', start: 200_500, end: 203_500, confirmed: false })] });
    const acc = gapsCalculator.init(guarded(waiting));
    expect(phasesOf(gapperLines(gapsCalculator.output(acc), fixed))).toEqual([['SC', 2.22, 'notApplicable']]);
    const updated = gapsCalculator.output(gapsCalculator.update(acc, deltaOf(waiting, dropped), guarded(dropped)));
    expect(updated).toEqual(run(dropped));
    expect(gapperLines(updated, fixed).phases).toEqual([]);
  });

  it('update over deltas equals init over the whole history: a phase that opens, then closes', () => {
    const ms = eightLaps();
    const early = ms.filter((m) => m.at <= 250_000);
    const opening = viewOf(early, { open: openNeutralisation({ kind: 'SC', start: 200_500 }) });
    const sc = neutralisation({ kind: 'SC', start: 200_500, end: 299_999 });
    const closed = viewOf(ms, { phases: [sc] });
    const acc = gapsCalculator.init(guarded(opening));
    expect(phasesOf(gapperLines(gapsCalculator.output(acc), fixed))).toEqual([['SC', 2.22, 'notApplicable']]);
    const updated = gapsCalculator.output(gapsCalculator.update(acc, deltaOf(opening, closed), guarded(closed)));
    expect(gapperLines(updated, fixed).phases).toEqual(gapperLines(run(closed), fixed).phases);
    expect(phasesOf(gapperLines(updated, fixed))).toEqual([['SC', 2.22, 3.32]]);
  });

  it('flashback equals fresh run: a phase the flashback took back is gone', () => {
    const ms = eightLaps();
    const sc = neutralisation({ kind: 'SC', start: 200_500, end: 299_999 });
    const full = viewOf(ms, { phases: [sc] });
    const back = viewOf(ms.filter((m) => m.at <= 190_000));
    const acc = gapsCalculator.init(guarded(full));
    const truncated = gapsCalculator.output(gapsCalculator.update(acc, deltaOf(full, back, true), guarded(back)));
    expect(gapperLines(truncated, fixed).phases).toEqual([]);
    expect(truncated).toEqual(run(back));
  });
});

// The leader average from the first mini-sector (supervisor ruling, wave 2 T6): the leader's mean lap so far over its
// fractional progress, (newest crossing − race start) / (completed laps + crossed mini-sectors / 50), so the default
// reference is known in lap 1; at a line crossing it is today's mean of the completed laps.
describe('the leader average over the leader\'s progress', () => {
  const leader = { kind: 'leaderAverage' } as const;
  const ref = (lines: ReturnType<typeof gapperLines>) => (lines.referenceLapMs.known ? lines.referenceLapMs.value : lines.referenceLapMs.reason);
  /**
   * Lap 1 from lights out at 0: the leader (car 0, 92 s pace) at mini-sector 25 at 46 000; car 1 (94 s pace) at
   * mini-sector 24 at 45 120.
   */
  const lapOne = () =>
    byTime([
      ...crossings(carId(0), 1, 92_000, 0).filter((m) => m.segment <= 25),
      ...crossings(carId(1), 1, 94_000, 0).filter((m) => m.segment <= 24),
    ]);

  it("is known from the leader's first crossings: its race time over its progress, in lap 1", () => {
    // 46 000 / (25 / 50)
    expect(ref(gapperLines(run(viewOf(lapOne())), leader))).toBe(92_000);
  });

  it('is the mean over completed laps plus the part lap, in whole ms', () => {
    // the leader laps 90, 90 and 96 s, then is at (4, 25) at 324 000: 324 000 / 3.5 = 92 571.4
    const ms = byTime([
      ...crossings(carId(0), 1, 90_000, 0),
      ...crossings(carId(0), 2, 90_000, 90_000),
      ...crossings(carId(0), 3, 96_000, 180_000),
      ...crossings(carId(0), 4, 96_000, 276_000).filter((m) => m.segment <= 25),
    ]);
    const value = gapperLines(run(viewOf(ms)), leader).referenceLapMs;
    if (!value.known) throw new Error(`no leader average: ${value.reason}`);
    expect(Number.isInteger(value.value)).toBe(true);
    expect(Math.abs(value.value - 324_000 / 3.5)).toBeLessThanOrEqual(0.5);
  });

  it("equals the completed laps' mean at each of the leader's line crossings", () => {
    // lights out at 60 s; the leader laps 90, 93 and 87 s; at the line after lap L the mean is (lineTime − 60 000) / L
    const start = 60_000;
    const laps = [90_000, 93_000, 87_000];
    const lineAt = (l: number) => start + laps.slice(0, l).reduce((a, b) => a + b, 0);
    const ms = byTime([
      ...laps.flatMap((pace, i) => crossings(carId(0), i + 1, pace, lineAt(i))),
      { carId: carId(0), lap: 4, segment: 0, at: lineAt(3), frame: 0 },
    ]);
    for (const l of [1, 2, 3]) {
      const lines = gapperLines(run(viewOf(ms.filter((m) => m.at <= lineAt(l)), { lightsOutAt: start })), leader);
      expect(ref(lines), `after lap ${l}`).toBe(Math.round((lineAt(l) - start) / l));
    }
  });

  it("is insufficientData while the leader's only crossing after lights out is the start line: no distance yet", () => {
    // the lights go out at 5 s; the leader crosses the start line (1, 0) at 6 s and nothing more
    const ms = [{ carId: carId(0), lap: 1, segment: 0, at: 6_000, frame: 0 }];
    expect(ref(gapperLines(run(viewOf(ms, { lightsOutAt: 5_000 })), leader))).toBe('insufficientData');
  });

  it('gives lap 1 its live points with the default reference: no completed lap, a gap now for each car', () => {
    const lines = gapperLines(run(viewOf(lapOne())), leader);
    expect(lines.cars.map((c) => [c.carId, c.byLap])).toEqual([[0, []], [1, []]]);
    const now = (id: number) => {
      const n = lines.cars.find((c) => c.carId === id)?.now;
      return n?.known ? { lap: n.value.lap, gapMs: plain(n.value.gapMs), at: n.at } : n;
    };
    // the leader is on the virtual car; car 1: 0.48 × 92 000 − 45 120
    expect(now(0)).toEqual({ lap: 0.5, gapMs: 0, at: 46_000 });
    expect(now(1)).toEqual({ lap: expect.closeTo(0.48, 9), gapMs: -960, at: 45_120 });
  });
});
