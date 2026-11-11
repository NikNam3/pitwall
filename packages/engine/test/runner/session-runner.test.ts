// packages/engine/test/runner/session-runner.test.ts
import { describe, expect, it } from 'vitest';
import { SessionRunner } from '../../src/index.ts';
import { initFor } from '../support/run.ts';
import { after, applyOne, runAll, shown, STEP, timeline, undoneTick } from '../support/runner.ts';

// original: frames 0..299, laps begin at 100 and 250. The game flashes back to frame 200 (t = 3200 ms);
// in the new timeline (frames 201..399) lap 3 begins at 330. Reported by event: the old timeline's last tick carries the
// FLBK and is undone; reported by the frame id going back: the new timeline's first frame is the report.
const scene = (event: boolean) => {
  const original = timeline(300, [100, 250]);
  const fork = timeline(400, [100, 330]);
  const resumed = after(fork, 201, 300);
  return { original, fork, continuation: event ? [undoneTick(original.at(-1)!, 200), ...resumed] : resumed, reference: fork };
};

describe('SessionRunner', () => {
  it('reports chained history deltas and no flashback in normal operation', () => {
    const { original } = scene(true);
    const results = runAll(new SessionRunner(initFor(original)), original.slice(0, 101));
    results.slice(1).forEach((r, i) => expect(r.delta.before).toEqual(results[i]!.delta.after));
    expect(results.every((r) => r.delta.rewound === undefined && r.flashback === undefined)).toBe(true);
    expect([(results[100]!.delta.after.laps ?? 0) - (results[100]!.delta.before.laps ?? 0), results[100]!.changed.has('laps')]).toEqual([1, true]);
  });
  it('FLBK: rewind + continuation equals a run that never saw the discarded frames', () => {
    const { original, continuation, reference } = scene(true);
    const a = new SessionRunner(initFor(original)); runAll(a, original); runAll(a, continuation);
    const b = new SessionRunner(initFor(original)); runAll(b, reference);
    expect(shown(a.state)).toEqual(shown(b.state));
    expect(a.state.history.laps.map((l) => [l.lapNumber, l.lapTimeMs])).toEqual([[1, 1_600], [2, 3_680]]);
  });
  it('the rewinding frame reports the rewind with its target, every change tag and the flashback info', () => {
    const { original, continuation } = scene(true);
    const a = new SessionRunner(initFor(original)); runAll(a, original);
    const r = applyOne(a, continuation[0]!);
    expect(r.delta.rewound).toEqual({ frameId: 200, at: 3_200 });
    expect([r.delta.before.laps, r.delta.after.laps]).toEqual([2, 1]);                 // lap 2 (completed at frame 250) is gone
    expect(r.flashback).toEqual({ targetFrameId: 200, targetSessionTime: 3_200, rewoundMs: 299 * STEP - 3_200, targetLap: 2 });
    expect((['laps', 'timing', 'miniSectors'] as const).every((t) => r.changed.has(t))).toBe(true);
  });
  it('detects a flashback without FLBK: frameId goes back while overallFrameId rises', () => {
    const { original, continuation, reference } = scene(false);
    const a = new SessionRunner(initFor(original)); runAll(a, original);
    const [first] = runAll(a, continuation);
    expect([first!.delta.rewound, first!.flashback?.targetFrameId, first!.flashback?.targetSessionTime]).toEqual([{ frameId: 200, at: 3_200 }, 200, 3_200]);
    const b = new SessionRunner(initFor(original)); runAll(b, reference);
    expect(shown(a.state)).toEqual(shown(b.state));
  });
  // The replay window is 30 s of session time (an engine constant): 2500 frames of 16 ms run past it, so frame 90
  // lies before it; the newest snapshot at or before it is the one after frame 63 (1008 ms). The state and the attached
  // bookkeeping go back there, so the rewind targets that snapshot's frame and time (review F3 of Task 3); the
  // flashback info keeps the game's target.
  it('a target older than the replay window restores the newest snapshot at or before it and targets it; the lap is detected again, once', () => {
    const laps = Array.from({ length: 24 }, (_, k) => 100 * (k + 1));
    const original = timeline(2500, laps);
    const continuation = after(timeline(200, [120]), 91, 2500);
    const a = new SessionRunner(initFor(original));
    runAll(a, original);
    const r = applyOne(a, undoneTick(original.at(-1)!, 90));
    expect([r.delta.rewound, a.state.log.voids.at(-1)?.target, r.flashback?.targetFrameId]).toEqual([{ frameId: 63, at: 1_008 }, { frameId: 63, at: 1_008 }, 90]);
    expect(a.state.history.laps).toEqual([]);                                          // lap 1 ended at frame 100 > target 90
    runAll(a, continuation);
    expect(a.state.history.laps.map((l) => [l.lapNumber, l.lapTimeMs])).toEqual([[1, 1_920]]);
  });
  it('a second flashback after the first one still matches the reference run', () => {
    const { original, continuation } = scene(true);
    const again = timeline(360, [100, 340]);                          // equals the fork up to frame 300
    const a = new SessionRunner(initFor(original)); runAll(a, original); runAll(a, continuation); runAll(a, [undoneTick(continuation.at(-1)!, 300), ...after(again, 301, continuation.at(-1)!.overallFrameId + 1)]);
    const b = new SessionRunner(initFor(original)); runAll(b, again);
    expect(shown(a.state)).toEqual(shown(b.state));
  });
});
