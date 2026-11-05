import { carId, MINI_SECTORS, type MiniSectorCrossing } from '@pitwall/domain';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { GapsOutput } from '../../src/gaps/index.ts';
import { gapperLines, gapsToCar } from '../../src/gaps/gaps.ts';
import { neutralisation } from '../../../../test-support/builders/index.ts';
import { GAPS_CONFIG } from '../../src/gaps/index.ts';
import { byTime, isWholeLap, plain, pointsByProgress, progressOf, run, viewOf, windowOf } from './race.ts';

/**
 * 3 to 5 cars over 1 to 3 laps, each mini-sector 1.7 to 1.9 s and a start up to 3 s late: the field stays within
 * one lap, so no car is lapped.
 */
const raceArb = fc.integer({ min: 3, max: 5 }).chain((cars) =>
  fc.record({
    laps: fc.integer({ min: 1, max: 3 }),
    startsMs: fc.array(fc.integer({ min: 0, max: 3_000 }), { minLength: cars, maxLength: cars }),
    segmentsMs: fc.array(fc.array(fc.integer({ min: 1_700, max: 1_900 }), { minLength: 3 * MINI_SECTORS, maxLength: 3 * MINI_SECTORS }), {
      minLength: cars,
      maxLength: cars,
    }),
    cut: fc.double({ min: 0, max: 1, noNaN: true }),
  }),
);
type Race = { laps: number; startsMs: number[]; segmentsMs: number[][]; cut: number };

/**
 * 3 to 5 cars over 1 to 3 laps, each with its own pace (a mini-sector 1.7 to 1.9 s, ± up to 60 ms each) and a start up
 * to 14 s late: their gaps spread across the window's edges (10 and 11 s); no car is lapped.
 */
const windowRaceArb = fc.integer({ min: 3, max: 5 }).chain((cars) =>
  fc.record({
    laps: fc.integer({ min: 1, max: 3 }),
    startsMs: fc.array(fc.integer({ min: 0, max: 14_000 }), { minLength: cars, maxLength: cars }),
    segmentsMs: fc.array(
      fc.integer({ min: 1_700, max: 1_900 }).chain((base) =>
        fc.array(fc.integer({ min: base - 60, max: base + 60 }), { minLength: 3 * MINI_SECTORS, maxLength: 3 * MINI_SECTORS }),
      ),
      { minLength: cars, maxLength: cars },
    ),
    cut: fc.double({ min: 0, max: 1, noNaN: true }),
  }),
);

/**
 * The window as the spec states it (3.2), with `ours` our only car: each crossing, in the order they come, judges every
 * other car that, with `ours`, has passed its point, on the time between their crossings of it: within
 * `windowMs` a car enters, beyond `windowMs + windowExitMs` it leaves. Our car and the cars in, sorted.
 */
function windowModel(history: readonly MiniSectorCrossing[], ours: number): number[] {
  const { windowMs, windowExitMs } = GAPS_CONFIG.defaults;
  const times = new Map<number, Map<number, number>>();
  const timeOf = (car: number, p: number) => times.get(car)?.get(p);
  const inside = new Set<number>();
  const judge = (car: number, gapMs: number) => {
    if (Math.abs(gapMs) <= windowMs) inside.add(car);
    else if (Math.abs(gapMs) > windowMs + windowExitMs) inside.delete(car);
  };
  for (const m of history) {
    const p = progressOf(m);
    if (!times.has(m.carId)) times.set(m.carId, new Map());
    times.get(m.carId)!.set(p, m.at);
    if (m.carId !== ours) {
      const our = timeOf(ours, p);
      if (our !== undefined) judge(m.carId, m.at - our);
    } else {
      for (const car of times.keys()) {
        const theirs = car === ours ? undefined : timeOf(car, p);
        if (theirs !== undefined) judge(car, theirs - m.at);
      }
    }
  }
  return [ours, ...inside].sort((a, b) => a - b);
}

const crossingsOf = ({ laps, startsMs, segmentsMs }: Race): MiniSectorCrossing[] =>
  byTime(
    startsMs.flatMap((start, i) => {
      let at = start;
      return Array.from({ length: laps * MINI_SECTORS }, (_, k) => {
        at += segmentsMs[i]![k]!;
        return { carId: carId(i), lap: Math.floor(k / MINI_SECTORS) + 1, segment: k % MINI_SECTORS, at, frame: 0 };
      });
    }),
  );

/** The gap of car a behind car b, which must be known. */
const gap = (out: GapsOutput, a: number, b: number): number => {
  const g = gapsToCar(out, carId(b))?.find((x) => x.carId === a)?.gapMs;
  if (g?.known !== true) throw new Error(`gap of ${a} to ${b} is not known: ${JSON.stringify(g)}`);
  return g.value;
};

const pairs = (n: number): [number, number][] =>
  Array.from({ length: n }, (_, a) => Array.from({ length: n }, (_, b) => [a, b] as [number, number])).flat().filter(([a, b]) => a !== b);

describe('gap properties', () => {
  it('gap(A,B) = −gap(B,A) at any moment', () => {
    fc.assert(
      fc.property(raceArb, (race) => {
        const all = crossingsOf(race);
        // from the moment every car has crossed its first mini-sector
        const first = Math.max(...race.startsMs.map((_, i) => all.findIndex((m) => m.carId === i))) + 1;
        const history = all.slice(0, first + Math.floor(race.cut * (all.length - first)));
        const out = run(viewOf(history));
        for (const [a, b] of pairs(race.startsMs.length)) expect(plain(gap(out, a, b) + gap(out, b, a))).toBe(0);
      }),
    );
  });

  it('gap(A,B) is tA(p) − tB(p) at p, the last point both passed, at any moment', () => {
    fc.assert(
      fc.property(raceArb, (race) => {
        const all = crossingsOf(race);
        const first = Math.max(...race.startsMs.map((_, i) => all.findIndex((m) => m.carId === i))) + 1;
        const history = all.slice(0, first + Math.floor(race.cut * (all.length - first)));
        const time = new Map(history.map((m) => [`${m.carId}:${progressOf(m)}`, m.at]));
        const latest = (car: number) => progressOf(history.findLast((m) => m.carId === car)!);
        const out = run(viewOf(history));
        for (const [a, b] of pairs(race.startsMs.length)) {
          const p = Math.min(latest(a), latest(b));
          expect(plain(gap(out, a, b))).toBe(plain(time.get(`${a}:${p}`)! - time.get(`${b}:${p}`)!));
        }
      }),
    );
  });

  it('gap(A,C) = gap(A,B) + gap(B,C) at a segment all three crossed', () => {
    fc.assert(
      fc.property(raceArb, (race) => {
        const all = crossingsOf(race);
        // every car's latest crossing is the same mini-sector
        const point = Math.min(race.laps * MINI_SECTORS - 1, Math.floor(race.cut * race.laps * MINI_SECTORS));
        const history = all.filter((m) => progressOf(m) <= point);
        const at = (car: number) => history.findLast((m) => m.carId === car)!.at;
        const out = run(viewOf(history));
        const cars = race.startsMs.length;
        for (const [a, b] of pairs(cars)) {
          expect(plain(gap(out, a, b))).toBe(plain(at(a) - at(b)));
          for (let c = 0; c < cars; c++) {
            if (c === a || c === b) continue;
            expect(plain(gap(out, a, c))).toBe(plain(gap(out, a, b) + gap(out, b, c)));
          }
        }
      }),
    );
  });

  it("the gapper's live point lies after the car's last completed lap, at its newest crossing, at any moment", () => {
    fc.assert(
      fc.property(raceArb, (race) => {
        const all = crossingsOf(race);
        const history = all.slice(0, 1 + Math.floor(race.cut * (all.length - 1)));
        const lines = gapperLines(run(viewOf(history)), { kind: 'fixed', lapMs: 90_000 });
        for (const car of lines.cars) {
          const newest = history.findLast((m) => m.carId === car.carId)!;
          if (newest.lap === 1 && newest.segment === 0) continue; // the start line: not pinned
          if (newest.segment === 0) {
            expect(car.now, `car ${car.carId} at the line`).toEqual({ known: false, reason: 'notApplicable' });
            continue;
          }
          if (!car.now.known) throw new Error(`car ${car.carId} has no now at (${newest.lap}, ${newest.segment})`);
          const lap = newest.lap - 1 + newest.segment / MINI_SECTORS;
          const completed = Math.max(0, ...(car.points ?? []).filter((p) => isWholeLap(p.lap)).map((p) => p.lap));
          expect(car.now.value.lap).toBeCloseTo(lap, 9);
          expect(car.now.value.lap).toBeGreaterThan(completed);
          expect(car.now.value.lap).toBeLessThan(completed + 1);
          expect(Number.isInteger(car.now.value.gapMs)).toBe(true);
          expect(Math.abs(car.now.value.gapMs - (lap * 90_000 - newest.at))).toBeLessThanOrEqual(0.5);
          expect(car.now.at).toBe(newest.at);
        }
      }),
    );
  });

  it("a phase lies at the leader's progress at its start and its end: the furthest crossing of any car by then, / 50", () => {
    const phaseArb = fc.record({ race: raceArb, a: fc.double({ min: 0, max: 1, noNaN: true }), b: fc.double({ min: 0, max: 1, noNaN: true }) });
    fc.assert(
      fc.property(phaseArb, ({ race, a, b }) => {
        const all = crossingsOf(race);
        const history = all.slice(0, 1 + Math.floor(race.cut * (all.length - 1)));
        const first = history[0]!.at;
        const last = history.at(-1)!.at;
        const [start, end] = [a, b].map((f) => Math.round(first + f * (last - first))).sort((x, y) => x - y) as [number, number];
        const leaderAt = (t: number) => Math.max(...history.filter((m) => m.at <= t).map(progressOf)) / MINI_SECTORS;
        const lines = gapperLines(run(viewOf(history, { phases: [neutralisation({ start, end })] })), { kind: 'fixed', lapMs: 90_000 });
        expect(lines.phases).toHaveLength(1);
        const [phase] = lines.phases;
        expect(phase!.fromLap).toBeCloseTo(leaderAt(start), 9);
        if (!phase!.toLap.known) throw new Error(`a closed phase has no toLap: ${phase!.toLap.reason}`);
        expect(phase!.toLap.value).toBeCloseTo(leaderAt(end), 9);
        expect(phase!.fromLap).toBeLessThanOrEqual(phase!.toLap.value);
      }),
    );
  });

  it("the leader average is the leader's race time at its newest crossing over its progress, at any moment", () => {
    fc.assert(
      fc.property(raceArb, (race) => {
        const all = crossingsOf(race);
        const history = all.slice(0, 1 + Math.floor(race.cut * (all.length - 1)));
        const out = run(viewOf(history));
        const leader = out.intervals[0]!.carId;
        const newest = history.findLast((m) => m.carId === leader)!;
        const value = gapperLines(out, { kind: 'leaderAverage' }).referenceLapMs;
        const progress = progressOf(newest);
        if (progress === 0) {
          expect(value).toEqual({ known: false, reason: 'insufficientData' });
          return;
        }
        if (!value.known) throw new Error(`no leader average at progress ${progress}: ${value.reason}`);
        expect(Number.isInteger(value.value)).toBe(true);
        expect(Math.abs(value.value - newest.at / (progress / MINI_SECTORS))).toBeLessThanOrEqual(0.5);
      }),
    );
  });
  it('the window is our car plus every car the fold over their common crossings lets in: within 10 s enters, beyond 11 s leaves', () => {
    fc.assert(
      fc.property(windowRaceArb, (race) => {
        const all = crossingsOf(race);
        const history = all.slice(0, 1 + Math.floor(race.cut * (all.length - 1)));
        const out = run(viewOf(history));
        for (const reference of [{ kind: 'fixed', lapMs: 90_000 } as const, { kind: 'leaderAverage' } as const]) {
          expect(windowOf(gapperLines(out, reference)), JSON.stringify(reference)).toEqual(windowModel(history, 0));
        }
      }),
    );
  });

  it("the gapper's points are the car's crossings, at x = completed laps + segment / 50, the gap there to the virtual car", () => {
    fc.assert(
      fc.property(raceArb, (race) => {
        const all = crossingsOf(race);
        const history = all.slice(0, 1 + Math.floor(race.cut * (all.length - 1)));
        const lines = gapperLines(run(viewOf(history)), { kind: 'fixed', lapMs: 90_000 });
        // 3 laps at most: every crossing is within the last 10 laps; the start line (x = 0) is not pinned
        for (const car of lines.cars) {
          const expected = history
            .filter((m) => m.carId === car.carId && progressOf(m) > 0)
            .map((m): [number, number] => [progressOf(m), plain(Math.round((progressOf(m) * 90_000) / MINI_SECTORS - m.at))]);
          expect(pointsByProgress(lines, car.carId)?.filter(([p]) => p > 0), `car ${car.carId}`).toEqual(expected);
        }
      }),
    );
  });
});
