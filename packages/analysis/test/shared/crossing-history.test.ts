// `shared/crossing-history.ts` (SP4.3d spec §6.5, SP4.3d1 Task 7; C43): the one owner of "where our car was when",
// from our own crossing history (`gaps`' `recent`: `at[i]` is when the car passed progress `fromProgress + i`, a hole
// where none was recorded). Both directions: `progressAt(ours, t)` (our progress in mini-sectors at `t`, interpolated
// between our two crossings around it; the ghost) and `timeAtProgress(ours, progress)` (when we were last at that
// progress, interpolated; the circle and the rejoin order). Before our kept crossings either answer is
// `insufficientData`, never NaN (plan Review Focus 5). Built from the builders' crossings (`test-support/builders`).
import { carId, MINI_SECTORS, unknown, type Known } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import { crossings } from '../../../../test-support/builders/index.ts';
import { liveProgress, progressAt, timeAtProgress } from '../../src/shared/crossing-history.ts';
import type { CarCrossings } from '../../src/shared/gapper-lines.ts';

const INSUFFICIENT = unknown('insufficientData');

/** Lap 1 in 90 s from 5 000, lap 2 in 92.3 s, lap 3 in 88.7 s: segments of unequal length (the builder rounds them). */
const LAPS = [
  { lap: 1, ms: 90_000 },
  { lap: 2, ms: 92_300 },
  { lap: 3, ms: 88_700 },
];
const START = 5_000;

/** Our crossings by progress, from progress 0 (lap 1 segment 0) to the end of lap 3, then the line of lap 4. */
const ALL: number[] = (() => {
  const at: number[] = [];
  let start = START;
  for (const { lap, ms } of LAPS) {
    for (const c of crossings(carId(0), lap, ms, start)) at[(c.lap - 1) * MINI_SECTORS + c.segment] = c.at;
    start += ms;
  }
  at.push(start);
  return at;
})();

/** Our kept crossings from `from` (as `gaps` keeps the last 100), with holes where `holes` says. */
const ours = (from = 0, holes: readonly number[] = []): CarCrossings => ({
  fromProgress: from,
  at: ALL.slice(from).map((t, i) => (holes.includes(from + i) ? (undefined as unknown as number) : t)),
});

const valueOf = <T>(k: Known<T>): T => {
  if (!k.known) throw new Error(`unknown: ${k.reason}`);
  return k.value;
};

describe('crossing history: where our car was when (shared, C43)', () => {
  it('progressAt: at a crossing its progress; halfway between two crossings halfway', () => {
    const o = ours(20);
    expect(valueOf(progressAt(o, ALL[20]!))).toBe(20);
    expect(valueOf(progressAt(o, ALL[73]!))).toBe(73);
    expect(valueOf(progressAt(o, (ALL[73]! + ALL[74]!) / 2))).toBeCloseTo(73.5, 9);
  });

  it('progressAt across a hole: interpolated between the crossings either side of it', () => {
    const o = ours(20, [61]);
    // 60 and 62 either side; a quarter of the way from 60's time to 62's is progress 60.5
    const t = ALL[60]! + (ALL[62]! - ALL[60]!) / 4;
    expect(valueOf(progressAt(o, t))).toBeCloseTo(60.5, 9);
  });

  it('progressAt after our newest crossing: our newest progress (as the ghost held it)', () => {
    const o = ours(20);
    const newest = ALL.length - 1;
    expect(valueOf(progressAt(o, ALL[newest]! + 700))).toBe(newest);
  });

  it('timeAtProgress: at a crossed progress its time; between two its interpolated time', () => {
    const o = ours(20);
    expect(valueOf(timeAtProgress(o, 73))).toBe(ALL[73]);
    expect(valueOf(timeAtProgress(o, 73.25))).toBeCloseTo(ALL[73]! + (ALL[74]! - ALL[73]!) / 4, 9);
    // across a hole
    expect(valueOf(timeAtProgress(ours(20, [61]), 61))).toBeCloseTo((ALL[60]! + ALL[62]!) / 2, 9);
  });

  // row 1
  it('round trip: timeAtProgress(progressAt(t)) is t within 1 ms over a builder lap', () => {
    const o = ours(20);
    // lap 2, from its line to the next, every 97 ms
    for (let t = ALL[50]!; t <= ALL[100]!; t += 97) {
      const p = valueOf(progressAt(o, t));
      expect(Math.abs(valueOf(timeAtProgress(o, p)) - t), `t ${t}`).toBeLessThanOrEqual(1);
    }
  });

  it('round trip the other way: progressAt(timeAtProgress(p)) is p over a builder lap', () => {
    const o = ours(20);
    for (let p = 100; p <= 150; p += 0.37) expect(valueOf(progressAt(o, valueOf(timeAtProgress(o, p)))), `p ${p}`).toBeCloseTo(p, 6);
  });

  // row 3
  it('first lap: asked before our first kept crossing, or with none, both answer insufficientData (never NaN)', () => {
    // our kept crossings begin at progress 20
    const o = ours(20);
    expect(progressAt(o, ALL[20]! - 1)).toEqual(INSUFFICIENT);
    expect(progressAt(o, 0)).toEqual(INSUFFICIENT);
    expect(timeAtProgress(o, 19)).toEqual(INSUFFICIENT);
    expect(timeAtProgress(o, 19.5)).toEqual(INSUFFICIENT);
    // the kept list starts with holes: the first crossing is the first recorded one
    const holey = ours(20, [20, 21, 22]);
    expect(progressAt(holey, ALL[22]!)).toEqual(INSUFFICIENT);
    expect(timeAtProgress(holey, 21)).toEqual(INSUFFICIENT);
    expect(valueOf(progressAt(holey, ALL[23]!))).toBe(23);
    // no crossing at all
    const none: CarCrossings = { fromProgress: 0, at: [] };
    expect(progressAt(none, 10_000)).toEqual(INSUFFICIENT);
    expect(timeAtProgress(none, 0)).toEqual(INSUFFICIENT);
  });

  it('timeAtProgress past our newest progress: we never were there, insufficientData', () => {
    const o = ours(20);
    const newest = ALL.length - 1;
    expect(timeAtProgress(o, newest + 0.5)).toEqual(INSUFFICIENT);
    expect(timeAtProgress(o, newest + 10)).toEqual(INSUFFICIENT);
  });

  // F1 (C43, ruling R3): the live tail and a car's live progress belong to the helper, so `rejoin` and `circle` share one scale
  it('liveProgress: lap 3, half a lap → 125 mini-sectors (the unit of progressAt); a non-positive track length → notReceived', () => {
    expect(valueOf(liveProgress(3, 2_500, 5_000))).toBeCloseTo(2 * MINI_SECTORS + MINI_SECTORS / 2, 9);
    expect(valueOf(liveProgress(1, 0, 5_000))).toBe(0);
    // the engine's mini-sector recorder places boundary s at s × length / 50: a car just past boundary 7 of lap 2
    expect(valueOf(liveProgress(2, (7 * 5_000) / MINI_SECTORS, 5_000))).toBeCloseTo(MINI_SECTORS + 7, 9);
    expect(liveProgress(3, 2_500, 0)).toEqual(unknown('notReceived'));
    expect(liveProgress(3, 2_500, -1)).toEqual(unknown('notReceived'));
  });

  it('timeAtProgress with our live point: between our newest crossing and it, linear; past it insufficientData; without it as before', () => {
    const o = ours(20);
    const newest = ALL.length - 1;
    const newestTime = ALL[newest]!;
    const now = { t: newestTime + 1_000, progress: newest + 0.4 };
    // halfway between our newest crossing and our live point → halfway in time
    expect(valueOf(timeAtProgress(o, newest + 0.2, now))).toBeCloseTo(newestTime + 500, 9);
    expect(valueOf(timeAtProgress(o, newest + 0.1, now))).toBeCloseTo(newestTime + 250, 9);
    // at the live point: now
    expect(valueOf(timeAtProgress(o, newest + 0.4, now))).toBeCloseTo(now.t, 9);
    // past the live point we never were there (R2 stays)
    expect(timeAtProgress(o, newest + 0.5, now)).toEqual(INSUFFICIENT);
    // up to our newest crossing the live point changes nothing
    expect(valueOf(timeAtProgress(o, 73, now))).toBe(ALL[73]);
    expect(valueOf(timeAtProgress(o, 73.25, now))).toBeCloseTo(ALL[73]! + (ALL[74]! - ALL[73]!) / 4, 9);
    expect(timeAtProgress(o, 19, now)).toEqual(INSUFFICIENT);
    // a live point not past our newest crossing adds no tail
    expect(timeAtProgress(o, newest + 0.2, { t: newestTime + 1_000, progress: newest })).toEqual(INSUFFICIENT);
    // without the live point: insufficientData past our newest progress, as today
    expect(timeAtProgress(o, newest + 0.2)).toEqual(INSUFFICIENT);
  });
});
