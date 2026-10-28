// packages/engine/test/runner/session-runner.test.ts
import { describe, expect, it } from 'vitest';
import { SessionRunner, type Frame } from '../../src/index.ts';
import { initFor } from '../support/run.ts';
import { after, flbk, runAll, STEP, timeline } from '../support/runner.ts';

const noFlbk = (fs: Frame[]) => fs.map((f) => ({ ...f, events: f.events.filter((e) => e.details.code !== 'FLBK') }));
// the FLBK event back to `target` lands in frame target + 1, where the forked timeline begins to differ
const flbkAt = (target: number) => (i: number) => (i === target + 1 ? [flbk(target)] : []);

// original: frames 0..299, laps begin at 100 and 250. The game flashes back to frame 200 (t = 3200 ms);
// in the new timeline (frames 201..399) lap 3 begins at 330.
const scene = (event: boolean) => {
  const original = timeline(300, [100, 250]);
  const fork = timeline(400, [100, 330], event ? flbkAt(200) : undefined);
  return { original, fork, continuation: after(fork, 201, 300), reference: noFlbk(fork) };
};

describe('SessionRunner', () => {
  it('reports chained history deltas and no flashback in normal operation', () => {
    const { original } = scene(true);
    const results = runAll(new SessionRunner(initFor(original)), original.slice(0, 101));
    results.slice(1).forEach((r, i) => expect(r.delta.before).toEqual(results[i]!.delta.after));
    expect(results.every((r) => !r.delta.truncated && r.flashback === undefined)).toBe(true);
    expect([results[100]!.delta.after.laps - results[100]!.delta.before.laps, results[100]!.changed.has('laps')]).toEqual([1, true]);
  });
  it('FLBK: rewind + continuation equals a run that never saw the discarded frames', () => {
    const { original, continuation, reference } = scene(true);
    const a = new SessionRunner(initFor(original)); runAll(a, original); runAll(a, continuation);
    const b = new SessionRunner(initFor(original)); runAll(b, reference);
    expect(a.state).toEqual(b.state);
    expect(a.state.history.laps.map((l) => [l.lapNumber, l.lapTimeMs])).toEqual([[1, 1_600], [2, 3_680]]);
  });
  it('the rewinding frame reports truncation, every change tag and the flashback info', () => {
    const { original, continuation } = scene(true);
    const a = new SessionRunner(initFor(original)); runAll(a, original);
    const r = a.apply(continuation[0]!);
    expect(r.delta.truncated).toBe(true);
    expect([r.delta.before.laps, r.delta.after.laps]).toEqual([2, 1]);                 // lap 2 (completed at frame 250) is gone
    expect(r.flashback).toEqual({ targetFrameId: 200, targetSessionTime: 3_200, rewoundMs: 299 * STEP - 3_200, targetLap: 2 });
    expect((['laps', 'timing', 'miniSectors'] as const).every((t) => r.changed.has(t))).toBe(true);
  });
  it('detects a flashback without FLBK: frameId goes back while overallFrameId rises', () => {
    const { original, continuation, reference } = scene(false);
    const a = new SessionRunner(initFor(original)); runAll(a, original);
    const [first] = runAll(a, continuation);
    expect([first!.delta.truncated, first!.flashback?.targetFrameId, first!.flashback?.targetSessionTime]).toEqual([true, 200, 3_200]);
    const b = new SessionRunner(initFor(original)); runAll(b, reference);
    expect(a.state).toEqual(b.state);
  });
  it('a target older than the replay window restores the newest snapshot at or before it; the lap is detected again, once', () => {
    const original = timeline(300, [100, 250]);
    const continuation = after(timeline(200, [120], flbkAt(90)), 91, 300);
    const a = new SessionRunner(initFor(original), { snapshotEveryMs: 1000, replayWindowMs: 1000 });
    runAll(a, original);
    expect(a.apply(continuation[0]!).delta.truncated).toBe(true);
    expect(a.state.history.laps).toEqual([]);                                          // lap 1 ended at frame 100 > target 90
    runAll(a, continuation.slice(1));
    expect(a.state.history.laps.map((l) => [l.lapNumber, l.lapTimeMs])).toEqual([[1, 1_920]]);
  });
  it('a second flashback after the first one still matches the reference run', () => {
    const { original, continuation } = scene(true);
    const again = timeline(360, [100, 340], flbkAt(300));             // equals the fork up to frame 300
    const a = new SessionRunner(initFor(original)); runAll(a, original); runAll(a, continuation); runAll(a, after(again, 301, 499));
    const b = new SessionRunner(initFor(original)); runAll(b, noFlbk(again));
    expect(a.state).toEqual(b.state);
  });
});
