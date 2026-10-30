// SessionRunner: the clock reset after the formation lap (Task FR ruling). The game sets the session time back while
// the frame id keeps rising and no FLBK comes: the history recorded after the new session time goes, the cars stay,
// and the step is reported like a flashback but as its own field. Car 0 passes car 1 in the formation frames, car 1
// passes car 0 in the race frames, so an event shows which side of the reset it comes from.
import { describe, expect, it } from 'vitest';
import type { EventDetails } from '@pitwall/protocol';
import { ALL_CHANGE_TAGS, SessionRunner, type Frame } from '../../src/index.ts';
import { initFor, runFrames } from '../support/run.ts';
import { after, flbk, runAll, STEP, timeline } from '../support/runner.ts';

const FORMATION_OVERTAKE: EventDetails = { code: 'OVTK', overtakingVehicleIdx: 0, beingOvertakenVehicleIdx: 1 };
const RACE_OVERTAKE: EventDetails = { code: 'OVTK', overtakingVehicleIdx: 1, beingOvertakenVehicleIdx: 0 };

/**
 * Frames 0..299 (0 to 4.784 s); car 0 begins laps 2 and 3 at frames 100 and 250. The first frame has no event: one
 * at session time 0 would be stamped at, not after, the race's new session time.
 */
const formation = () => timeline(300, [100, 250], (i) => (i === 0 ? [] : [FORMATION_OVERTAKE]));
/** Session time of the last formation frame. */
const FORMATION_END = 299 * STEP;

/** The frames with ids from `firstId` on, as the game sends them after the reset: frame ids rise, the clock restarts. */
const continuing = (frames: Frame[], firstId: number): Frame[] =>
  frames.map((f, k) => ({ ...f, frameId: firstId + k, overallFrameId: firstId + k }));
/** `n` race frames after the formation: their own clock from 0, frame ids from 300; car 0 begins a lap at each index in `lapStarts`. */
const race = (n: number, lapStarts: number[] = [100]) => continuing(timeline(n, lapStarts, () => [RACE_OVERTAKE]), 300);

const ranThrough = (frames: Frame[]) => {
  const runner = new SessionRunner(initFor(frames));
  return { runner, results: runAll(runner, frames) };
};

describe('SessionRunner: recognising a clock reset', () => {
  it('a session time that falls by more than 1 s while the frame id rises, without an FLBK, is a clock reset: the step is truncated and changes every tag', () => {
    const { results } = ranThrough([...formation(), ...race(1)]);
    const reset = results.at(-1)!;
    expect({ truncated: reset.delta.truncated, changed: reset.changed, clockReset: reset.clockReset, flashback: reset.flashback }).toEqual({
      truncated: true,
      changed: new Set(ALL_CHANGE_TAGS),
      clockReset: { fromMs: FORMATION_END, toMs: 0 },
      flashback: undefined,
    });
  });
  it('only the frame whose session time fell is a clock reset; the race frames after it are not', () => {
    const { results } = ranThrough([...formation(), ...race(20)]);
    const resets = results.map((r) => r.clockReset !== undefined || r.delta.truncated);
    expect(resets.slice(300)).toEqual([true, ...new Array<boolean>(19).fill(false)]);
  });
  it.each([
    ['by exactly 1 s', 1000],
    ['by less than 1 s', 400],
  ])('a session time that falls %s is no clock reset', (_, fallMs) => {
    const frames = formation();
    const { runner } = ranThrough(frames);
    const r = runner.apply({ ...frames[299]!, frameId: 300, overallFrameId: 300, sessionTime: FORMATION_END - fallMs });
    expect([r.delta.truncated, r.clockReset, r.flashback]).toEqual([false, undefined, undefined]);
  });
  it('a session time that falls by 1 ms more than 1 s is a clock reset', () => {
    const frames = formation();
    const { runner } = ranThrough(frames);
    const r = runner.apply({ ...frames[299]!, frameId: 300, overallFrameId: 300, sessionTime: FORMATION_END - 1001 });
    expect([r.delta.truncated, r.clockReset]).toEqual([true, { fromMs: FORMATION_END, toMs: FORMATION_END - 1001 }]);
  });

  // the game goes back to frame 200 (3.2 s): the fork's frame 201 is at 3.216 s, 1.568 s before the last frame applied
  const fork = () => timeline(400, [100, 330], (i) => [FORMATION_OVERTAKE, ...(i === 201 ? [flbk(200)] : [])]);
  it('an FLBK is a flashback, not a clock reset, though the session time falls by more than 1 s and the frame id rises', () => {
    const { runner } = ranThrough(formation());
    const r = runner.apply({ ...fork()[201]!, frameId: 300, overallFrameId: 300 });
    expect([r.flashback?.targetFrameId, r.clockReset]).toEqual([200, undefined]);
  });
  it('a frame id that goes back is a flashback, not a clock reset, though the session time falls by more than 1 s', () => {
    const { runner } = ranThrough(formation());
    const plainFork = timeline(400, [100, 330], () => [FORMATION_OVERTAKE]);
    const r = runner.apply(after(plainFork, 201, 300)[0]!);
    expect([r.flashback?.targetFrameId, r.clockReset]).toEqual([200, undefined]);
  });
});

describe('SessionRunner: what a clock reset keeps', () => {
  it('a reset to 0 leaves the history a run from the reset frame on would have: nothing of the formation lap survives', () => {
    const { runner } = ranThrough([...formation(), ...race(150)]);
    const fresh = ranThrough(race(150)).runner;
    // the fresh run holds a lap, crossings and events of the race, so the comparison is not of empty lists
    expect(fresh.state.history.laps.map((l) => [l.carId, l.lapNumber])).toEqual([[0, 1]]);
    expect(runner.state.history).toEqual(fresh.state.history);
  });
  it('a reset keeps the history stamped at or before the new session time and drops what was recorded after it', () => {
    const resetTo = 2008;                                                              // between frames 125 and 126
    const frames = formation();
    const control = ranThrough(frames).runner.state.history;
    const { runner } = ranThrough([...frames, { ...frames[299]!, frameId: 300, overallFrameId: 300, sessionTime: resetTo }]);
    const h = runner.state.history;
    expect({ laps: h.laps.map((l) => l.completedAt), events: h.events, miniSectors: h.miniSectors }).toEqual({
      laps: control.laps.filter((l) => l.completedAt <= resetTo).map((l) => l.completedAt),
      events: [...control.events.filter((e) => e.at <= resetTo), { ...control.events[0]!, at: resetTo }],
      miniSectors: control.miniSectors.filter((m) => m.at <= resetTo),
    });
  });
  it('a reset keeps the cars: they carry on as the frames give them', () => {
    const frames = [...formation(), ...race(150)];
    const { runner } = ranThrough(frames);
    expect(runner.state.cars).toEqual(runFrames(frames).st.cars);
  });
});

describe('SessionRunner: a flashback after a clock reset', () => {
  // the race runs to frame 399 (1.584 s on its clock); the game goes back to frame 350, and the fork begins a lap at 360
  const raceRun = () => race(100, []);
  const raceFork = () => race(200, [60]);

  it('rewinds within the race, never into the formation lap: no formation event comes back', () => {
    const { runner } = ranThrough([...formation(), ...raceRun()]);
    const results = runAll(runner, after(raceFork(), 51, 400));
    expect(results[0]!.flashback?.targetFrameId).toBe(350);
    expect(runner.state.history.events.filter((e) => e.carId === 0)).toEqual([]);
  });
  it('the rewind and the continuation equal a run that never saw the discarded frames', () => {
    const { runner } = ranThrough([...formation(), ...raceRun()]);
    runAll(runner, after(raceFork(), 51, 400));
    expect(runner.state).toEqual(ranThrough([...formation(), ...raceFork()]).runner.state);
  });
});
