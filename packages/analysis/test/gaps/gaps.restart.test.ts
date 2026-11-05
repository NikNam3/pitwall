// `gaps` over a garage restart in practice and qualifying (C25): the restarted lap's crossings are appended again from
// segment 0, each repeat superseding the earlier crossing of its slot. `gaps` reads the current crossings only, and
// keeps its own positional rule: a car that went back drops what lay ahead of it.
import { carId, MINI_SECTORS, type Interval, type MiniSectorCrossing } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import type { GapsOutput } from '../../src/gaps/index.ts';
import { crossings } from '../../../../test-support/builders/index.ts';
import { byTime, deltaOf, gaps, guarded, plain, restartPass, run, viewOf } from './race.ts';

const PACE_MS = 90_000;
const SEGMENT_MS = PACE_MS / MINI_SECTORS; // 1 800 ms
/** Car 0 starts lap 1 at 1 s; its earlier pass of lap 2 starts at 91 s and reaches segment 30 (145 s) before the garage. */
const EARLIER_TO = 30;
/** The restart: lap 2 again from segment 0 at 200 s, up to segment 10 (218 s). */
const RESTART_AT = 200_000;
const RESTART_TO = 10;
const END = RESTART_AT + RESTART_TO * SEGMENT_MS; // 218 000

/** Car 1 laps on at 90 s from 0, through the restart: by 218 s it is at lap 3 segment 21 (217.8 s). */
const carOne = (from: number, to: number): MiniSectorCrossing[] =>
  [1, 2, 3].flatMap((n) => crossings(carId(1), n, PACE_MS, (n - 1) * PACE_MS)).filter((m) => m.at >= from && m.at <= to);

/**
 * The history up to the restart, then the restart: car 0's restarted lap 2 (each crossing superseding its slot's earlier
 * one, C25) interleaved with car 1's crossings. The positions before the restart never move, so the refs hold.
 */
function restartHistory(): MiniSectorCrossing[] {
  const before = byTime([
    ...crossings(carId(0), 1, PACE_MS, 1_000),
    ...crossings(carId(0), 2, PACE_MS, 91_000).slice(0, EARLIER_TO + 1),
    ...carOne(0, RESTART_AT - 1),
  ]);
  const restarted = restartPass(before, 0, 2, PACE_MS, RESTART_AT, RESTART_TO);
  return [...before, ...byTime([...restarted, ...carOne(RESTART_AT, END)])];
}

const interval = (out: GapsOutput, id: number): Interval => {
  const found = out.intervals.find((i) => i.carId === id);
  if (found === undefined) throw new Error(`no interval for car ${id}`);
  return found;
};

describe.each(['practice', 'qualifying'] as const)('gaps over a garage restart in %s (C25)', (kind) => {
  const history = restartHistory();
  const view = viewOf(history, { kind });

  it('the history holds the restart as superseding crossings: every restarted slot names its earlier crossing', () => {
    const restarted = history.filter((m) => m.carId === 0 && m.at >= RESTART_AT);
    expect(restarted).toHaveLength(RESTART_TO + 1);
    expect(restarted.every((m) => m.supersedes !== undefined)).toBe(true);
  });

  it("car 0's track is lap 1 and the restarted pass only: the earlier pass is not read ahead of where the car is", () => {
    const rec = run(view).recent[carId(0)];
    // progress 0..49: lap 1 from 1 s; progress 50..60: the restarted lap 2 from 200 s (never the earlier pass from 91 s)
    expect(rec).toEqual({
      fromProgress: 0,
      at: [
        ...Array.from({ length: MINI_SECTORS }, (_, s) => 1_000 + s * SEGMENT_MS),
        ...Array.from({ length: RESTART_TO + 1 }, (_, s) => RESTART_AT + s * SEGMENT_MS),
      ],
    });
  });

  it("lap 1's line time is the restart's line (the current crossing of (2, 0)), not the superseded one at 91 s", () => {
    expect(run(view).lineTimes[carId(0)]).toEqual([{ lap: 1, at: RESTART_AT }]);
  });

  it('the interval comes from the current crossings: car 0 at lap 2 segment 10 is one lap and 20 s behind car 1', () => {
    const out = run(view);
    expect(out.intervals.map((i) => i.carId)).toEqual([1, 0]);
    const c0 = interval(out, 0);
    // car 0 at progress 60 at 218 s; car 1 passed progress 110 (lap 3 segment 10) at 198 s
    expect(c0.lapsDown).toBe(1);
    expect(c0.toLeaderMs).toMatchObject({ known: true });
    expect(c0.toLeaderMs.known && plain(c0.toLeaderMs.value)).toBe(20_000);
    const c1 = interval(out, 1);
    expect(c1.toBehindMs.known && plain(c1.toBehindMs.value)).toBe(20_000);
  });

  it('equals gaps over the same session without the earlier pass of lap 2: the superseded and the dropped crossings change nothing', () => {
    const without = history.filter((m) => !(m.carId === 0 && m.lap === 2 && m.at < RESTART_AT)).map(({ supersedes: _, ...m }) => m);
    expect(run(view)).toEqual(run(viewOf(without, { kind })));
  });

  // C31.3 on the restart shape: the accumulator folded crossing by crossing equals init over the current projection
  it('update over each delta equals init over the whole history, through the restart', () => {
    let prev = viewOf([], { kind });
    let acc = gaps.init(guarded(prev));
    for (let n = 1; n <= history.length; n++) {
      const next = viewOf(history.slice(0, n), { kind });
      acc = gaps.update(acc, deltaOf(prev, next), guarded(next));
      prev = next;
      expect(gaps.output(acc), `after crossing ${n - 1}`).toEqual(run(next));
    }
  });

  it('a rewind across the restart equals a fresh run, and so does the replay after it', () => {
    const at = history.length - 4;
    const full = viewOf(history, { kind });
    const acc = gaps.init(guarded(full));
    const cut = history.findIndex((m) => m.supersedes !== undefined) - 3; // before the restart's first crossing
    const back = viewOf(history.slice(0, cut), { kind });
    let state = gaps.update(acc, deltaOf(full, back, true), guarded(back));
    expect(gaps.output(state)).toEqual(run(back));
    const again = viewOf(history.slice(0, at), { kind });
    state = gaps.update(state, deltaOf(back, again), guarded(again));
    expect(gaps.output(state)).toEqual(run(again));
  });
});
