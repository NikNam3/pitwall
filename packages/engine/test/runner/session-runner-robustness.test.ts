// SessionRunner beyond the brief's cases: bounded snapshots and frames, the weekend context, and one flashback that
// the game reports twice or in a frame with an unexpected id.
import { describe, expect, it } from 'vitest';
import { SessionRunner, type Frame, type StepResult, type WeekendContext } from '../../src/index.ts';
import { ScenarioBuilder, type FrameDraft } from '../builders/index.ts';
import { initFor } from '../support/run.ts';

const STEP = 16;
const runAll = (r: SessionRunner, frames: Frame[]): StepResult[] => frames.map((f) => r.apply(f));
const flashbacks = (results: StepResult[]) => results.filter((r) => r.flashback !== undefined || r.delta.truncated).length;
// car 0 drives 40 m per frame on a 4000 m track; a new lap begins at each frame index in lapStarts
const drive = (lapStarts: number[]) => (d: FrameDraft) => {
  const starts = [0, ...lapStarts.filter((x) => x <= d.index)], start = starts.at(-1)!;
  Object.assign(d.lapData.lapData[0]!, { currentLapNum: starts.length, lapDistance: (d.index - start) * 40 + 10, totalDistance: d.index * 40 + 10,
    lastLapTimeInMs: starts.length === 1 ? 0 : (start - starts.at(-2)!) * STEP });
};
const timeline = (frames: number, lapStarts: number[]) =>
  new ScenarioBuilder({ cars: 2, stepMs: STEP }).session({ trackLength: 4000 }).frames(frames, drive(lapStarts)).build();
// the game's frames from `first` on, with overallFrameId still rising
const after = (fork: Frame[], first: number, nextOverall: number) => fork.slice(first).map((f, k) => ({ ...f, overallFrameId: nextOverall + k }));
// an FLBK event packet with target frame 200 (t = 3200 ms), as the decoder yields it
const flbk200 = (() => {
  const b = new ScenarioBuilder({ cars: 2, stepMs: STEP }).session({ trackLength: 4000 }).frames(201, () => {});
  return b.event({ code: 'FLBK', flashbackFrameIdentifier: 200, flashbackSessionTime: 3.2 }).frames(1, () => {}).build()[201]!.events;
})();

describe('SessionRunner retention', () => {
  // A long session from frames that differ only in id and time: frame 0 opens it, then one frame per `stepMs`.
  const session = (n: number, stepMs: number) => {
    const [first, next] = timeline(2, []);
    return [first!, ...Array.from({ length: n }, (_, k) => ({ ...next!, frameId: k + 1, overallFrameId: k + 1, sessionTime: (k + 1) * stepMs }))];
  };

  it('keeps every snapshot inside the window and one per 30 s slot before it', () => {
    const frames = session(900, 1000);                                                 // 15 minutes, a snapshot every second
    const r = new SessionRunner(initFor(frames));
    runAll(r, frames);
    // the first, the window (10 s → 11 snapshots) and 30 slots before it
    expect(r.retained.snapshots).toBeGreaterThanOrEqual(1 + 11 + 29);
    expect(r.retained.snapshots).toBeLessThanOrEqual(1 + 11 + 31);
  });

  it('a target older than the window restores the nearest retained snapshot; one inside it, the exact frame', () => {
    const frames = session(900, 1000);
    const back = (target: number) => {
      const r = new SessionRunner(initFor(frames));
      runAll(r, frames);
      return r.apply({ ...frames[target + 1]!, overallFrameId: 901 }).flashback?.targetSessionTime;   // frameId drop, no FLBK
    };
    expect(back(605)).toBe(600_000);                                                   // the first snapshot of the 600–630 s slot
    expect(back(895)).toBe(895_000);
  });

  it('bounds the kept frames and snapshots while session time stands still', () => {
    const frames = session(5000, 0);
    const r = new SessionRunner(initFor(frames));
    runAll(r, frames);
    expect(r.retained.frames).toBeLessThanOrEqual(1200 + 2 * 120);
    expect(r.retained.snapshots).toBeLessThanOrEqual(15);
  });

  it('carries the read-only weekend context over a rewind by reference', () => {
    const original = timeline(300, [100, 250]);
    const weekend: WeekendContext = { weekendId: 'w', driverKey: { kind: 'ai', driverId: 1 }, sessions: [] };
    const r = new SessionRunner({ ...initFor(original), weekend });
    runAll(r, original);
    expect(r.apply({ ...original[201]!, overallFrameId: 300 }).delta.truncated).toBe(true);
    expect(r.state.weekend).toBe(weekend);
  });
});

describe('SessionRunner: one flashback, reported in more than one way', () => {
  // original: frames 0..299, laps begin at 100 and 250; the game goes back to frame 200
  const original = timeline(300, [100, 250]);
  const fork = timeline(400, [100, 330]);                                             // equals the original up to frame 249
  const reference = () => {
    const b = new SessionRunner(initFor(original));
    runAll(b, fork);
    return b.state;
  };

  it('FLBK in a frame that still carries the old high frameId: one rewind', () => {
    const { feedId, sessionUid, playerCarIndex } = fork[201]!;
    const stale: Frame = { feedId, sessionUid, playerCarIndex, frameId: 300, overallFrameId: 300, sessionTime: 3_200, sessionHistory: [], tyreSets: [], events: flbk200 };
    const a = new SessionRunner(initFor(original));
    runAll(a, original);
    const results = runAll(a, [stale, ...after(fork, 201, 301)]);
    expect(flashbacks(results)).toBe(1);
    expect(a.state).toEqual(reference());
  });

  it('frameId drop at T+1, then FLBK at T+2: one rewind, frame T+1 kept', () => {
    const continuation = after(fork, 201, 300);
    continuation[1] = { ...continuation[1]!, events: [...continuation[1]!.events, ...flbk200] };
    const a = new SessionRunner(initFor(original));
    runAll(a, original);
    const results = runAll(a, continuation);
    expect([flashbacks(results), results[0]!.flashback?.targetFrameId]).toEqual([1, 200]);
    expect(a.state).toEqual(reference());
  });

  it('FLBK in a frame whose own id is at or below the target: one rewind, replayed only up to that frame', () => {
    const early = timeline(400, [100, 185]);                                           // equals the original up to frame 184
    const continuation = after(early, 185, 300);
    continuation[0] = { ...continuation[0]!, events: [...continuation[0]!.events, ...flbk200] };
    const a = new SessionRunner(initFor(original));
    runAll(a, original);
    const results = runAll(a, continuation);
    expect(flashbacks(results)).toBe(1);
    const b = new SessionRunner(initFor(original));
    runAll(b, early);
    expect(a.state).toEqual(b.state);
  });
});
