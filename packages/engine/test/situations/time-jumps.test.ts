// Session-time jumps (spec 3.3; diagnosis t1-diagnosis.md P1, P4, P5): the start's settling after lights out is
// re-stamped onto the race clock, any other fall changes nothing and is reported, a flashback stays a flashback (the
// runner decides what is one), a flashback after a fall restores the state by frame id, and garage acceleration is no
// jump, also across a stall. The two online start shapes follow raceZandvoortOnline (S3) and raceZandvoortUidReuse (S4).
import { describe, expect, it } from 'vitest';
import type { EventDetails } from '@pitwall/protocol';
import { SessionRunner } from '../../src/index.ts';
import { initFor } from '../support/run.ts';
import { after } from '../support/runner.ts';
import { beats, flbk, gridStart, lap, LGOT, LIGHTS_OUT, ovtk, raceAt, run, scar, script, status, STEP, stlg, type Beat } from './script.ts';

const FORMATION_STATUS = (k: number, at: number) => (k === at ? { session: status(3) } : {});
const lightsAt = (k: number, first: number, every: number): EventDetails[] =>
  [1, 2, 3, 4, 5].flatMap((n) => (k === first + (n - 1) * every ? [stlg(n)] : []));
/** Entries stamped after `ms`: events and mini-sector crossings. */
const after_ = (r: SessionRunner, ms: number) => [
  ...r.state.history.events.filter((e) => e.at > ms).map((e) => `${e.kind} at ${e.at}`),
  ...r.state.history.miniSectors.filter((m) => m.at > ms).map((m) => `crossing ${m.carId}/${m.lap}/${m.segment} at ${m.at}`),
];
const lightsOut = (r: SessionRunner) => r.state.history.events.filter((e) => e.kind === 'lightsOut');
/** Index of race frame k of `gridStart` among the frames. */
const raceFrame = (k: number) => LIGHTS_OUT + 1 + k;

describe('the start settles (raceZandvoortOnline): lights out at 1.968 s, the race clock 0.065 s four frames later', () => {
  const L = 209;
  /** The grid from 0.065 s, the formation from frame 10, the reset to 1.968 s at frame 110, lights out at frame 209. */
  const s3 = beats(L + 100, (k): Beat => ({
    at: k < 110 ? 65 + k * STEP : k <= L + 3 ? 1968 : 65 + (k - L - 4) * STEP,
    ...FORMATION_STATUS(k, 10),
    ...(k === 125 && { session: status(0) }),
    events: [...(k === 110 ? [scar(3, 3), ovtk(1, 0)] : []), ...lightsAt(k, 120, 10), ...(k === L ? [LGOT] : [])],
    cars: (d) => lap(d, 0, { lapDistance: k <= L ? -6 : -6 + (k - L) * 40, currentLapTimeInMs: Math.max(0, k - L) * STEP }),
  }));

  it('lights out and the race start move onto the race clock', () => {
    const { runner } = run(script(s3));
    expect(lightsOut(runner).map((e) => e.at)).toEqual([65]);
    expect(runner.state.open.situations.session).toEqual({ kind: 'racing', start: 65, startLeaderLap: 1 });
  });
  it('nothing recorded up to the settling is stamped after the race clock: the start lights and the first crossing move too', () => {
    const { runner } = run(script(s3).slice(0, L + 5));
    expect(after_(runner, 65)).toEqual([]);
    expect(runner.state.history.miniSectors.filter((m) => m.carId === 0)).not.toEqual([]);
  });
  it('the settling step is truncated (its entries were re-stamped) and reports no clock fall', () => {
    const { results } = run(script(s3));
    expect([results[L + 4]!.delta.truncated, results[L + 4]!.clockFall]).toEqual([true, undefined]);
  });
});

describe('the start settles (raceZandvoortUidReuse): a jump forward after lights out, then two falls', () => {
  // Frames 0-6 at 57.2 s (before the session), a fall to 0 at frame 7; the formation from frame 30; the reset to
  // 0.033 s at frame 110; a fall 0.817 -> 0.794 at frame 160 and a hold; lights out at frame 209 (0.794 s); frames
  // 211-219 at 6.790-6.918 s, then 0.831 s, then 0.027 s at frame 221, the race clock. Car 0 creeps 3 m a frame from
  // lights out (it passes the line inside the jump), then drives; a VSC (status only) covers race-clock 0.347-1.147 s;
  // lap 1 ends at frame 321.
  const L = 209;
  const SETTLED = L + 12;
  const atOf = (k: number): number =>
    k < 7 ? 57_200 + k * STEP
    : k < 110 ? (k - 7) * STEP
    : k < 160 ? 33 + (k - 110) * STEP
    : k <= L + 1 ? 794
    : k <= L + 10 ? 6_790 + (k - L - 2) * STEP
    : k === L + 11 ? 831
    : 27 + (k - SETTLED) * STEP;
  const distanceOf = (k: number): number => (k <= L ? -6 : k <= SETTLED ? -6 + (k - L) * 3 : 30 + (k - SETTLED) * 40);
  const s4 = beats(SETTLED + 120, (k): Beat => ({
    at: atOf(k),
    ...FORMATION_STATUS(k, 30),
    ...(k === 170 && { session: status(0) }),
    ...(k === SETTLED + 20 && { session: status(2) }),
    ...(k === SETTLED + 70 && { session: status(0) }),
    events: [
      ...(k === 112 ? [{ code: 'DRSE' } as const] : []),
      ...(k === 130 ? [scar(3, 3), ovtk(1, 0)] : []),
      ...(k === 135 ? [{ code: 'DRSD', reason: 0 } as const] : []),
      ...lightsAt(k, 165, 5),
      ...(k === L ? [LGOT] : []),
    ],
    cars: (d) =>
      distanceOf(k) < 4000
        ? lap(d, 0, { currentLapNum: 1, lapDistance: distanceOf(k), currentLapTimeInMs: Math.max(0, k - L) * STEP })
        : lap(d, 0, { currentLapNum: 2, lapDistance: distanceOf(k) - 4000, currentLapTimeInMs: 0, lastLapTimeInMs: 1600 }),
  }));

  it('a fall before the formation opens changes nothing and is reported with both times', () => {
    const { runner, results } = run(script(s4).slice(0, 20));
    expect([results[7]!.delta.truncated, results[7]!.clockFall]).toEqual([false, { fromMs: 57_200 + 6 * STEP, toMs: 0 }]);
    expect(runner.state.open.situations.session.kind).toBe('preStart');
  });
  it('the race start is lights out on the race clock: no later than the clock after the settling, and not before 0', () => {
    const { runner } = run(script(s4));
    const [out] = lightsOut(runner);
    const start = runner.state.history.sessionPhases.find((p) => p.kind === 'racing')?.start ?? runner.state.open.situations.session.start;
    expect(lightsOut(runner)).toHaveLength(1);
    expect(start).toBe(out!.at);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(start).toBeLessThanOrEqual(27);
  });
  it('nothing recorded up to the settling is stamped after the race clock: the crossing inside the jump moves too', () => {
    const { runner } = run(script(s4).slice(0, SETTLED + 1));
    expect(runner.state.history.miniSectors.filter((m) => m.carId === 0 && m.lap === 1).map((m) => m.segment)).toEqual([0]);
    expect(after_(runner, 27)).toEqual([]);
  });
  it('neither fall of the settling is reported as a clock fall', () => {
    const { results } = run(script(s4));
    expect([results[L + 11]!.clockFall, results[SETTLED]!.clockFall]).toEqual([undefined, undefined]);
  });
  it('the jump does not count towards lap 1’s tracked time: its VSC share is the VSC time over the lap on the race clock', () => {
    const { runner } = run(script(s4));
    const [lap1] = runner.state.history.laps.filter((l) => l.carId === 0 && l.lapNumber === 1);
    expect(lap1!.vscShare).toBeCloseTo((50 * STEP) / (100 * STEP), 1);
  });
});

describe('the settling window: 60 frames after lights out', () => {
  /** A grid start whose clock falls from race frame `k` on to 0.1 s. */
  const fallAt = (k: number) => run(script(gridStart(100, (i) => (i >= k ? { at: 100 + (i - k) * STEP } : {}))));
  it('a fall 60 frames after lights out is the start settling: no clock fall', () => {
    const { results } = fallAt(59);
    expect(results[LIGHTS_OUT + 60]!.clockFall).toBeUndefined();
  });
  it('a fall 61 frames after lights out is no settling: it truncates nothing and is reported', () => {
    const { results } = fallAt(60);
    const r = results[LIGHTS_OUT + 61]!;
    expect([r.delta.truncated, r.clockFall]).toEqual([false, { fromMs: raceAt(59), toMs: 100 }]);
  });
});

// Spec 3.3 as amended (user ruling 2026-10-30): a fall that is no flashback and not the start is logged, and the
// engine keeps its race clock monotonic: every entry stamped after the fall gets the fall's size as an offset.
describe('any other fall of the session time', () => {
  const fall = 300;
  /** The clock falls from raceAt(299) to 1 s at race frame 300; so entries after it move up by this much. */
  const OFFSET = raceAt(fall - 1) - 1000;
  /** Race frame k's raw session time after the fall. */
  const rawAt = (k: number) => 1000 + (k - fall) * STEP;
  const frames = (extra: (k: number) => Beat = () => ({})) => script(gridStart(400, (k) => ({
    ...(k >= fall && { at: rawAt(k) }),
    ...(k === 100 && { events: [ovtk(1, 0)] }),
    ...(k === 350 && { events: [ovtk(0, 1)] }),
    cars: (d) => lap(d, 0, { currentLapNum: 1 + Math.floor(k / 120), lapDistance: (k % 120) * 30, ...(k >= 120 && { lastLapTimeInMs: 120 * STEP }) }),
    ...extra(k),
  })));

  it('a fall mid-race without a flashback keeps every entry recorded before it, truncates nothing and reports both raw times', () => {
    const all = frames();
    const { runner } = run(all.slice(0, raceFrame(fall)));
    const before = structuredClone(runner.state.history);
    const r = runner.apply(all[raceFrame(fall)]!);
    expect([r.delta.truncated, r.flashback, r.clockFall]).toEqual([false, undefined, { fromMs: raceAt(fall - 1), toMs: 1000 }]);
    const h = runner.state.history;
    expect({ laps: h.laps.slice(0, before.laps.length), events: h.events.slice(0, before.events.length), miniSectors: h.miniSectors.slice(0, before.miniSectors.length) })
      .toEqual({ laps: before.laps, events: before.events, miniSectors: before.miniSectors });
    expect(before.laps.length).toBeGreaterThan(0);
    expect(runner.state.open.situations.session).toEqual({ kind: 'racing', start: 0, startLeaderLap: 1 });
  });
  it('entries stamped after the fall continue the race clock: their raw time plus the fall’s size (an overtake, a lap)', () => {
    const { runner } = run(frames());
    const h = runner.state.history;
    expect(h.events.filter((e) => e.kind === 'overtake').map((e) => e.at)).toEqual([raceAt(100), rawAt(350) + OFFSET]);
    expect(h.laps.filter((l) => l.carId === 0).map((l) => [l.lapNumber, l.completedAt])).toEqual([[1, raceAt(120)], [2, raceAt(240)], [3, rawAt(360) + OFFSET]]);
  });
  it('the mini-sector crossings stay in time order across the fall', () => {
    const at = run(frames()).runner.state.history.miniSectors.filter((m) => m.carId === 0).map((m) => m.at);
    expect(at.filter((t, i) => i > 0 && t < at[i - 1]!)).toEqual([]);
  });
  it('a phase that opens after the fall starts above every phase before it, and no span ends below its start', () => {
    // an SC from race frame 100 to 200, the fall at 300, a VSC from 330
    const { runner } = run(frames((k) => ({
      ...(k === 100 && { events: [ovtk(1, 0), scar(1, 0)], session: status(1) }),
      ...(k === 200 && { events: [scar(1, 3)], session: status(0) }),
      ...(k === 330 && { events: [scar(2, 0)], session: status(2) }),
    })));
    const spans = runner.state.history.sessionPhases;
    expect(runner.state.open.situations.session).toMatchObject({ kind: 'neutralised', start: rawAt(330) + OFFSET, detail: { car: 'VSC' } });
    expect(spans.map((p) => p.start).filter((t) => t > rawAt(330) + OFFSET)).toEqual([]);
    expect(spans.filter((p) => p.end < p.start)).toEqual([]);
  });
});

describe('a flashback is never a clock fall', () => {
  const frames = () => script(gridStart(300));
  it('a frame id going back with the session time falling by more than 1 s is a flashback', () => {
    const all = frames();
    const { runner } = run(all.slice(0, LIGHTS_OUT + 201));
    const r = runner.apply(after(all, LIGHTS_OUT + 101, LIGHTS_OUT + 201)[0]!);
    expect([r.flashback?.targetFrameId, r.clockFall]).toEqual([LIGHTS_OUT + 100, undefined]);
  });
  it('an FLBK with a rising frame id is a flashback', () => {
    const all = script(gridStart(300, (k) => (k === 200 ? { at: raceAt(100), events: [flbk(LIGHTS_OUT + 100, raceAt(99))] } : {})));
    const { results } = run(all.slice(0, LIGHTS_OUT + 202));
    const r = results[LIGHTS_OUT + 201]!;
    expect([r.flashback?.targetFrameId, r.clockFall]).toEqual([LIGHTS_OUT + 100, undefined]);
  });

  // Review 2 C1: the runner alone decides what is a flashback; the tracker takes its decision for the frame.
  it('a frame id going back while the overall frame id does not rise is no flashback for the runner, nor for the tracker: its fall is a clock fall', () => {
    const all = frames();
    const { runner } = run(all.slice(0, raceFrame(200) + 1));
    const r = runner.apply({ ...all[raceFrame(100)]!, overallFrameId: all[raceFrame(200)]!.overallFrameId });
    expect([r.flashback, r.delta.truncated, r.clockFall]).toEqual([undefined, false, { fromMs: raceAt(200), toMs: raceAt(100) }]);
  });

  // Inventory 1.10 (raceSingaporeWet lap 44): after a rewind the first packets carry the target's frame ids with the old
  // session time; only the frames after them carry the target's time.
  /** The game's frames after a rewind to race frame 100: race frames 101.., the first `stale` of them at the old `oldMs`. */
  const resumed = (all: ReturnType<typeof frames>, nextOverall: number, oldMs: number, stale = 2) =>
    after(all, raceFrame(101), nextOverall).slice(0, 50).map((f, i) => (i < stale ? { ...f, sessionTime: oldMs } : f));
  const falls = (results: ReturnType<typeof run>['results']) =>
    results.flatMap((r, i) => (r.clockFall === undefined ? [] : [`frame ${i}: ${JSON.stringify(r.clockFall)}`]));

  it('the first frames after a rewind (frame id going back) that still carry the old session time are part of the flashback: no clock fall when the time then drops to the target’s', () => {
    const all = frames();
    const { runner } = run(all.slice(0, raceFrame(200) + 1));
    const results = resumed(all, raceFrame(201), raceAt(200)).map((f) => runner.apply(f));
    expect(results[0]!.flashback?.targetFrameId).toBe(raceFrame(100));
    expect(falls(results)).toEqual([]);
  });
  it('the first frames after an FLBK that still carry the old session time are part of the flashback: no clock fall when the time then drops to the target’s', () => {
    const withFlbk = script(gridStart(300, (k) => (k === 201 ? { events: [flbk(raceFrame(100), raceAt(100))] } : {})));
    const { runner, results: before } = run(withFlbk.slice(0, raceFrame(201) + 1));
    expect(before[raceFrame(201)]!.flashback?.targetFrameId).toBe(raceFrame(100));
    expect(falls(resumed(frames(), raceFrame(202), raceAt(201)).map((f) => runner.apply(f)))).toEqual([]);
  });
});

describe('garage time acceleration', () => {
  it('a session clock running 30 times faster than wall time is no jump, no fall and no pause', () => {
    const { runner, results } = run(script(beats(200, (k) => ({ at: k * 500, wall: k * STEP })), { session: { sessionType: 1 } }));
    expect(results.flatMap((r, i) => (r.clockFall !== undefined || r.delta.truncated ? [i] : []))).toEqual([]);
    expect(runner.state.history.pauses).toEqual([]);
    expect(runner.state.open.situations.session.kind).toBe('running');
  });

  // Review 2 B3: a stall of a few seconds while the clock runs ahead of wall time gives one advance above 60 s. A
  // post-session jump must also outrun 60 times the wall gap of its step: the recorded simulation jumps are thousands of
  // seconds within one frame interval, garage acceleration is at most about 30 times wall time.
  /** Practice at 30 times wall time (480 ms a frame); frame 100 comes `wallMs` of wall time and `advanceMs` of session time after frame 99. */
  const stall = (wallMs: number, advanceMs: number) =>
    run(script(beats(150, (k) => ({ at: k * 480 + (k >= 100 ? advanceMs - 480 : 0), wall: k * STEP + (k >= 100 ? wallMs - STEP : 0) })), { session: { sessionType: 1 } }));

  it('a 3 s stall in a clock running 30 times faster than wall time (a 90 s advance) opens no post-session, and is no fall and no pause', () => {
    const { runner, results } = stall(3_000, 90_000);
    expect(runner.state.open.situations.session.kind).toBe('running');
    expect(results.flatMap((r, i) => (r.clockFall !== undefined || r.delta.truncated ? [i] : []))).toEqual([]);
    expect(runner.state.history.pauses).toEqual([]);
  });
  it('a jump of 4500 s within one frame interval is still the simulated rest of the session: the post-session opens', () => {
    expect(stall(STEP, 4_500_000).runner.state.open.situations.session.kind).toBe('postSession');
  });
  it.each([
    [179_000, 'running'],
    [181_000, 'postSession'],
  ] as const)('after a 3 s stall, an advance of %i ms leaves the phase %s: the jump must outrun 60 times the wall gap', (advanceMs, kind) => {
    expect(stall(3_000, advanceMs).runner.state.open.situations.session.kind).toBe(kind);
  });
});

describe('a flashback after a mid-race fall of the session time (review 2 C5)', () => {
  // The clock falls at race frame 200 to 1 s (unless a test says otherwise); at race frame `from` the game goes back to race frame `target`, before the
  // fall or after it, and the fork has an overtake 5 frames after the target. Small snapshot intervals and a short replay
  // window, so the restore goes through snapshots taken on both sides of the fall.
  const FALL = 200;
  const OPTS = { snapshotEveryMs: 100, replayWindowMs: 1_000 };
  /** The clock falls to `toMs` at race frame `FALL`. */
  const withFall = (extra: (k: number) => Beat = () => ({}), toMs = 1000) => script(gridStart(260, (k) => ({
    ...(k >= FALL && { at: toMs + (k - FALL) * STEP }),
    cars: (d) => lap(d, 0, { currentLapNum: 1 + Math.floor(k / 90), lapDistance: (k % 90) * 40 + 10, ...(k >= 90 && { lastLapTimeInMs: 90 * STEP }) }),
    ...extra(k),
  })));

  it.each([
    ['before the fall', 180, 240],
    ['after the fall', 220, 240],
    ['before the fall, from the frame the clock fell on', 180, FALL],
  ] as const)('a rewind to %s equals a run that never saw the discarded frames', (_, target, from) => {
    const all = withFall();
    const fork = withFall((k) => (k === target + 5 ? { events: [ovtk(1, 0)] } : {}));
    const runner = new SessionRunner(initFor(all), OPTS);
    for (const f of all.slice(0, raceFrame(from) + 1)) runner.apply(f);
    const results = after(fork, raceFrame(target + 1), raceFrame(from + 1)).map((f) => runner.apply(f));
    expect(results[0]!.flashback?.targetFrameId).toBe(raceFrame(target));
    const fresh = new SessionRunner(initFor(fork), OPTS);
    for (const f of fork) fresh.apply(f);
    expect(runner.state).toEqual(fresh.state);
  });

  // Inventory 1.10 across a fall (w3e implement report, concern 2): the clock falls only 400 ms at race frame 200, so its
  // raw time at race frame 240 still lies above race frame `target`'s. After the rewind from race frame 240 the game's
  // first two frames still carry that old raw time; the frames after them are on the target's clock.
  it.each([
    ['before the fall', 180],
    ['after the fall', 220],
  ] as const)('a rewind to %s whose first frames still carry the old session time reports no clock fall and keeps the target’s race clock', (_, target) => {
    const all = withFall(undefined, 2_800);
    const fork = withFall((k) => (k === target + 5 ? { events: [ovtk(1, 0)] } : {}), 2_800);
    const runner = new SessionRunner(initFor(all), OPTS);
    for (const f of all.slice(0, raceFrame(240) + 1)) runner.apply(f);
    const oldMs = all[raceFrame(240)]!.sessionTime;
    const continuation = after(fork, raceFrame(target + 1), raceFrame(241)).slice(0, 15).map((f, i) => (i < 2 ? { ...f, sessionTime: oldMs } : f));
    const results = continuation.map((f) => runner.apply(f));
    expect(results[0]!.flashback?.targetFrameId).toBe(raceFrame(target));
    expect(results.flatMap((r, i) => (r.clockFall ? [`frame ${i}: ${JSON.stringify(r.clockFall)}`] : []))).toEqual([]);
    // A fresh run to the same frame. The stale frames' own stamps (their crossings, the lap cursors' time) carry the old
    // time in any rewind of this shape, so the comparison leaves those out.
    const fresh = new SessionRunner(initFor(fork), OPTS);
    for (const f of fork.slice(0, raceFrame(target + 15) + 1)) fresh.apply(f);
    const seen = (r: SessionRunner) => ({
      sessionTime: r.state.sessionTime,
      clockOffsetMs: r.state.open.phaseBook.clockOffsetMs,
      phases: r.state.history.sessionPhases,
      open: r.state.open.situations.session,
      events: r.state.history.events,
      laps: r.state.history.laps,
    });
    expect(seen(runner)).toEqual(seen(fresh));
  });
});
