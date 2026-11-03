// Step 0, the clock (contract C7, C20, C35-C37; ported from time-jumps.test.ts and session-phase.test.ts's pauses): the
// start's settling after lights out is a fall carried over by an offset like any other fall (nothing recorded is
// re-stamped; later frames lie on the race clock), each fall is a `fall` fact with the game's times, a flashback stays a
// flashback (the runner decides what is one, and a replay keeps its decision) and appends no clock fact, a flashback
// after a fall restores the state by frame id, the frames a rewind stamps at its target keep that stamp on every replay,
// garage acceleration is no jump, any other forward jump of more than 60 s is a `jump` fact, the post-session jump
// appends `simulatedEnd`, and a pause is the clock's `paused` span (open in the situation while it lasts, closed into
// `spans:clock`). The two online start shapes follow raceZandvoortOnline (S3) and raceZandvoortUidReuse (S4).
import { describe, expect, it } from 'vitest';
import type { EventDetails } from '@pitwall/protocol';
import { SessionRunner, situationOf, type Frame, type StepResult } from '../../../src/index.ts';
import { clockInput, onRaceClock, STEP0_CLOCK } from '../../../src/situations/clock/machine.ts';
import { MACHINE_ORDER } from '../../../src/situations/registry.ts';
import { situationOf as machineSituationOf } from '../../../src/situations/run.ts';
import { initFor } from '../../support/run.ts';
import { after, applyOne, runAll, shown } from '../../support/runner.ts';
import { beats, flbk, gridStart, lap, LGOT, LIGHTS_OUT, ovtk, raceAt, run, scar, script, status, STEP, stlg, type Beat } from '../script.ts';

const FORMATION_STATUS = (k: number, at: number) => (k === at ? { session: status(3) } : {});
const lightsAt = (k: number, first: number, every: number): EventDetails[] =>
  [1, 2, 3, 4, 5].flatMap((n) => (k === first + (n - 1) * every ? [stlg(n)] : []));
const lightsOut = (r: SessionRunner) => r.state.history.events.filter((e) => e.kind === 'lightsOut');
/** Index of race frame k of `gridStart` among the frames. */
const raceFrame = (k: number) => LIGHTS_OUT + 1 + k;
/** The pauses readers see: the clock's closed `paused` spans (`spans:clock`, C7). */
const pauses = (r: SessionRunner) => r.state.history.spans['clock'] ?? [];
/** The clock's open spans (C20): a pause in progress. */
const openPause = (r: SessionRunner) => machineSituationOf(r.state).byMachine['clock'] ?? [];
/** The steps that appended a clock fact readers see (`clock`), by frame index. */
const clockSteps = (results: StepResult[]) => results.flatMap((r, i) => ((r.delta.after.clock ?? 0) > (r.delta.before.clock ?? 0) ? [i] : []));
/** The steps that rewound (`delta.rewound` set), by frame index. */
const rewoundSteps = (results: StepResult[]) => results.flatMap((r, i) => (r.delta.rewound !== undefined ? [i] : []));
/** A runner over `frames` and the race clock after each step (`state.sessionTime`). */
const raceClockOf = (frames: Frame[]) => {
  const runner = new SessionRunner(initFor(frames));
  const times: number[] = [];
  for (const f of frames) runner.apply(f, (r) => times.push(r.state.sessionTime));
  return { runner, times };
};
/** The race-clock times that fall below the one before them. */
const fallsIn = (times: readonly number[]) => times.filter((t, i) => i > 0 && t < times[i - 1]!);

describe('step 0, the clock', () => {
  it('is no member of the step-2 registry: step 0, id clock, scope session', () => {
    expect([STEP0_CLOCK.id, STEP0_CLOCK.scope]).toEqual(['clock', 'session']);
    expect(MACHINE_ORDER.map((m) => m.id)).not.toContain('clock');
  });
});

describe('the start settles (raceZandvoortOnline): lights out at 1.968 s, the session time 0.065 s four frames later', () => {
  const L = 209;
  /** The frame the session time falls on, four frames after lights out. */
  const SETTLE = L + 4;
  /** The fall's size: the race clock runs this far ahead of the game's session time after it. */
  const OFFSET = 1968 - 65;
  /** The grid from 0.065 s, the formation from frame 10, the reset to 1.968 s at frame 110, lights out at frame 209. */
  const s3 = beats(L + 100, (k): Beat => ({
    at: k < 110 ? 65 + k * STEP : k <= L + 3 ? 1968 : 65 + (k - L - 4) * STEP,
    ...FORMATION_STATUS(k, 10),
    ...(k === 125 && { session: status(0) }),
    events: [...(k === 110 ? [scar(3, 3), ovtk(1, 0)] : []), ...lightsAt(k, 120, 10), ...(k === L ? [LGOT] : [])],
    cars: (d) => lap(d, 0, { lapDistance: k <= L ? -6 : -6 + (k - L) * 40, currentLapTimeInMs: Math.max(0, k - L) * STEP }),
  }));

  it('a fall within 60 frames after lights out is carried over: one fall fact with the game’s times, the race clock continues from 1.968 s', () => {
    const frames = script(s3);
    const { runner } = run(frames.slice(0, SETTLE));
    const before = runner.state.log.clock.length;
    runAll(runner, frames.slice(SETTLE));
    expect(runner.state.log.clock.slice(before)).toMatchObject([{ kind: 'fall', at: 1968, fromMs: 1968, toMs: 65, offsetMs: OFFSET }]);
    expect(runner.state.sessionTime).toBe(frames.at(-1)!.sessionTime + OFFSET);
    expect(clockInput(runner.state).offsetMs).toBe(OFFSET);
    expect(onRaceClock(runner.state, frames.at(-1)!.sessionTime)).toBe(runner.state.sessionTime);
  });
  it('lights out and the race start keep the time they were recorded at', () => {
    const { runner } = run(script(s3));
    expect(lightsOut(runner).map((e) => e.at)).toEqual([1968]);
    expect(runner.state.open.situations.session).toEqual({ kind: 'racing', start: 1968, startLeaderLap: 1 });
  });
  it('nothing recorded before the fall is re-stamped; what later frames record lies on the race clock, not below 1.968 s', () => {
    const frames = script(s3);
    const { runner } = run(frames.slice(0, SETTLE));
    const before = structuredClone(runner.state.history);
    runAll(runner, frames.slice(SETTLE));
    const h = runner.state.history;
    expect({ events: h.events.slice(0, before.events.length), crossings: h.crossings.slice(0, before.crossings.length), laps: h.laps.slice(0, before.laps.length) })
      .toEqual({ events: before.events, crossings: before.crossings, laps: before.laps });
    expect(before.crossings.filter((m) => m.carId === 0)).not.toEqual([]);
    const later = [...h.events.slice(before.events.length), ...h.crossings.slice(before.crossings.length)];
    expect(later.length).toBeGreaterThan(0);
    expect(later.filter((e) => e.at < 1968)).toEqual([]);
  });
  it('the settling step rewinds nothing and appends the fall', () => {
    const { results } = run(script(s3));
    expect(results[SETTLE]!.delta.rewound).toBeUndefined();
    expect(clockSteps(results)).toContain(SETTLE);
  });
});

describe('the start settles (raceZandvoortUidReuse): a jump forward after lights out, then two falls', () => {
  // Frames 0-6 at 57.2 s (before the session), a fall to 0 at frame 7; the formation from frame 30; the reset to
  // 0.033 s at frame 110; a fall 0.817 -> 0.794 at frame 160 and a hold; lights out at frame 209 (0.794 s); frames
  // 211-219 at 6.790-6.918 s, then 0.831 s, then 0.027 s at frame 221. Car 0 creeps 3 m a frame from lights out (it
  // passes the line inside the jump), then drives; a VSC (status only) covers frames 241-291; lap 1 ends at frame 321.
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
  /** The race clock after the two falls: 6.918 s at frame `SETTLED`, ahead of the session time by both falls. */
  const OFFSET = 6_918 - 27;

  it('a fall before the formation opens rewinds nothing and appends a fall fact with both times', () => {
    const { runner, results } = run(script(s4).slice(0, 20));
    expect(results[7]!.delta.rewound).toBeUndefined();
    expect(runner.state.log.clock).toMatchObject([{ kind: 'fall', fromMs: 57_200 + 6 * STEP, toMs: 0 }]);
    expect(runner.state.open.situations.session.kind).toBe('preStart');
  });
  it('both falls of the settling are carried over: two fall facts with the game’s times, the race clock runs on from 6.918 s', () => {
    const frames = script(s4);
    const { runner } = run(frames.slice(0, L + 1));
    const before = runner.state.log.clock.length;
    runAll(runner, frames.slice(L + 1));
    expect(runner.state.log.clock.slice(before)).toMatchObject([
      { kind: 'fall', at: 6_918, fromMs: 6_918, toMs: 831, offsetMs: 6_918 - 831 },
      { kind: 'fall', at: 6_918, fromMs: 831, toMs: 27, offsetMs: 831 - 27 },
    ]);
    expect(runner.state.sessionTime).toBe(frames.at(-1)!.sessionTime + OFFSET);
  });
  it('the race start is lights out at the time it was recorded; the race clock never falls after it', () => {
    const { runner, times } = raceClockOf(script(s4));
    const start = runner.state.history.sessionPhases.find((p) => p.kind === 'racing')?.start ?? runner.state.open.situations.session.start;
    expect(lightsOut(runner).map((e) => e.at)).toEqual([794]);
    expect(start).toBe(794);
    expect(fallsIn(times.slice(L))).toEqual([]);
  });
  it('nothing recorded up to the settling is re-stamped: the crossing inside the jump keeps its time', () => {
    const frames = script(s4);
    const { runner } = run(frames.slice(0, L + 11));
    const before = structuredClone(runner.state.history);
    runAll(runner, frames.slice(L + 11));
    const h = runner.state.history;
    expect(before.crossings.filter((m) => m.carId === 0 && m.lap === 1).map((m) => m.segment)).toEqual([0]);
    expect({ events: h.events.slice(0, before.events.length), crossings: h.crossings.slice(0, before.crossings.length) })
      .toEqual({ events: before.events, crossings: before.crossings });
  });
});

describe('the settling window: 60 frames after lights out', () => {
  /** A grid start whose clock falls from race frame `k` on to 0.1 s. */
  const fallAt = (k: number) => run(script(gridStart(100, (i) => (i >= k ? { at: 100 + (i - k) * STEP } : {}))));
  it.each([
    [60, 59],
    [61, 60],
  ] as const)('a fall %i frames after lights out is carried over: it rewinds nothing and appends one fall fact', (_, k) => {
    const { runner, results } = fallAt(k);
    expect(results[raceFrame(k)]!.delta.rewound).toBeUndefined();
    expect(runner.state.log.clock).toMatchObject([{ kind: 'fall', at: raceAt(k - 1), fromMs: raceAt(k - 1), toMs: 100, offsetMs: raceAt(k - 1) - 100 }]);
    expect(clockSteps(results)).toEqual([raceFrame(k)]);
  });
});

// Spec 3.3 as amended (user ruling 2026-10-30) and C36: a fall that is no flashback is a clock fact, and the engine keeps
// its race clock monotonic: every entry stamped after the fall gets the fall's size as an offset.
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

  it('a fall mid-race without a flashback keeps every entry recorded before it, rewinds nothing and appends a fall fact with both raw times', () => {
    const all = frames();
    const { runner } = run(all.slice(0, raceFrame(fall)));
    const before = structuredClone(runner.state.history);
    const r = applyOne(runner, all[raceFrame(fall)]!);
    expect([r.delta.rewound !== undefined, r.flashback]).toEqual([false, undefined]);
    expect(runner.state.history.clock).toMatchObject([{ kind: 'fall', at: raceAt(fall - 1), fromMs: raceAt(fall - 1), toMs: 1000, offsetMs: OFFSET }]);
    const h = runner.state.history;
    expect({ laps: h.laps.slice(0, before.laps.length), events: h.events.slice(0, before.events.length), crossings: h.crossings.slice(0, before.crossings.length) })
      .toEqual({ laps: before.laps, events: before.events, crossings: before.crossings });
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
    const at = run(frames()).runner.state.history.crossings.filter((m) => m.carId === 0).map((m) => m.at);
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

describe('a flashback appends no clock fact', () => {
  const frames = () => script(gridStart(300));
  it('a frame id going back with the session time falling by more than 1 s is a flashback: no clock fact', () => {
    const all = frames();
    const { runner } = run(all.slice(0, LIGHTS_OUT + 201));
    const r = applyOne(runner, after(all, LIGHTS_OUT + 101, LIGHTS_OUT + 201)[0]!);
    expect([r.flashback?.targetFrameId, runner.state.log.clock]).toEqual([LIGHTS_OUT + 100, []]);
  });
  it('an FLBK with a rising frame id is a flashback: no clock fact', () => {
    const all = script(gridStart(300, (k) => (k === 200 ? { at: raceAt(100), events: [flbk(LIGHTS_OUT + 100, raceAt(99))] } : {})));
    const { runner, results } = run(all.slice(0, LIGHTS_OUT + 202));
    const r = results[LIGHTS_OUT + 201]!;
    expect([r.flashback?.targetFrameId, runner.state.log.clock]).toEqual([LIGHTS_OUT + 100, []]);
  });

  // Review 2 C1: the runner alone decides what is a flashback; the clock takes its decision for the frame.
  it('a frame id going back while the overall frame id does not rise is no flashback for the runner, nor for the clock: its fall is a fall fact', () => {
    const all = frames();
    const { runner } = run(all.slice(0, raceFrame(200) + 1));
    const r = applyOne(runner, { ...all[raceFrame(100)]!, overallFrameId: all[raceFrame(200)]!.overallFrameId });
    expect([r.flashback, r.delta.rewound !== undefined]).toEqual([undefined, false]);
    expect(runner.state.log.clock).toMatchObject([{ kind: 'fall', at: raceAt(200), fromMs: raceAt(200), toMs: raceAt(100), offsetMs: raceAt(200) - raceAt(100) }]);
  });

  // Inventory 1.10 (raceSingaporeWet lap 44): after a rewind the first packets carry the target's frame ids with the old
  // session time; only the frames after them carry the target's time.
  /** The game's frames after a rewind to race frame 100: race frames 101.., the first `stale` of them at the old `oldMs`. */
  const resumed = (all: ReturnType<typeof frames>, nextOverall: number, oldMs: number, stale = 2) =>
    after(all, raceFrame(101), nextOverall).slice(0, 50).map((f, i) => (i < stale ? { ...f, sessionTime: oldMs } : f));

  it('the first frames after a rewind (frame id going back) that still carry the old session time are part of the flashback: no clock fact when the time then drops to the target’s', () => {
    const all = frames();
    const { runner } = run(all.slice(0, raceFrame(200) + 1));
    const results = runAll(runner, resumed(all, raceFrame(201), raceAt(200)));
    expect(results[0]!.flashback?.targetFrameId).toBe(raceFrame(100));
    expect(runner.state.log.clock).toEqual([]);
  });
  it('the first frames after an FLBK that still carry the old session time are part of the flashback: no clock fact when the time then drops to the target’s', () => {
    const withFlbk = script(gridStart(300, (k) => (k === 201 ? { events: [flbk(raceFrame(100), raceAt(100))] } : {})));
    const { runner, results: before } = run(withFlbk.slice(0, raceFrame(201) + 1));
    expect(before[raceFrame(201)]!.flashback?.targetFrameId).toBe(raceFrame(100));
    runAll(runner, resumed(frames(), raceFrame(202), raceAt(201)));
    expect(runner.state.log.clock).toEqual([]);
  });
});

// Garage acceleration peaks at about 31.6 times wall time: inventory 1.9, raceSingaporeWet qualifying (SgQ) frames
// 720 to 750 cover 0.5 s of wall time and 15.777 s of session time (review 3 E7). The tests run the clock at that peak.
const GARAGE_PEAK = 31.6;
/** Session time of frame k of a clock running at the peak, 16 ms of wall time a frame. */
const atPeak = (k: number): number => Math.round(k * STEP * GARAGE_PEAK);
/** Practice at the peak; frame 100 comes `wallMs` of wall time and `advanceMs` of session time after frame 99. */
const stall = (wallMs: number, advanceMs: number) =>
  run(script(beats(150, (k) => ({
    at: k < 100 ? atPeak(k) : atPeak(99) + advanceMs + atPeak(k - 99) - atPeak(1),
    wall: k * STEP + (k >= 100 ? wallMs - STEP : 0),
  })), { session: { sessionType: 1 } }));
/** The kinds of the clock facts appended to the log. */
const clockKinds = (r: SessionRunner) => r.state.log.clock.map((f) => f.kind);

describe('garage time acceleration', () => {
  it('a session clock running at the measured peak of 31.6 times wall time is no jump: no clock fact, no pause, no rewind', () => {
    const { runner, results } = run(script(beats(200, (k) => ({ at: atPeak(k), wall: k * STEP })), { session: { sessionType: 1 } }));
    expect([rewoundSteps(results), runner.state.log.clock, pauses(runner)]).toEqual([[], [], []]);
    expect(runner.state.open.situations.session.kind).toBe('running');
  });

  // Review 2 B3: a stall of a few seconds while the clock runs ahead of wall time gives one advance above 60 s. A
  // post-session jump must also outrun 60 times the wall gap of its step: the recorded simulation jumps are thousands of
  // seconds within one frame interval, while garage acceleration peaks at 31.6 times wall time, which leaves the factor
  // 60 a headroom of about 1.9.
  /** A 3 s stall at the peak advances the clock 94.8 s. */
  const STALL_ADVANCE = 3_000 * GARAGE_PEAK;

  it('a 3 s stall in a clock running at the peak (a 94.8 s advance) opens no post-session, and is no fall, no simulated end and no pause', () => {
    const { runner, results } = stall(3_000, STALL_ADVANCE);
    expect(runner.state.open.situations.session.kind).toBe('running');
    expect([rewoundSteps(results), clockKinds(runner).filter((k) => k !== 'jump'), pauses(runner)]).toEqual([[], [], []]);
  });
  it('a jump of 4500 s within one frame interval is still the simulated rest of the session: the post-session opens and simulatedEnd is appended', () => {
    const { runner } = stall(STEP, 4_500_000);
    expect([runner.state.open.situations.session.kind, clockKinds(runner)]).toEqual(['postSession', ['simulatedEnd']]);
  });
  it.each([
    [179_000, 'running', []],
    [181_000, 'postSession', ['simulatedEnd']],
  ] as const)('after a 3 s stall, an advance of %i ms leaves the phase %s: the jump must outrun 60 times the wall gap', (advanceMs, kind, ends) => {
    const { runner } = stall(3_000, advanceMs);
    expect([runner.state.open.situations.session.kind, clockKinds(runner).filter((k) => k === 'simulatedEnd')]).toEqual([kind, ends]);
  });
});

// Spec 3.3: any other forward jump (not the post-session jump) of more than 60 s is a `jump` fact with the game's times,
// and changes nothing else.
describe('any other forward jump of the session time', () => {
  it('a 3 s stall in the garage at the peak (a 94.8 s advance) appends a jump fact with both times, on its step and on no other', () => {
    const { runner, results } = stall(3_000, 94_800);
    expect(runner.state.log.clock).toMatchObject([{ kind: 'jump', fromMs: atPeak(99), toMs: atPeak(99) + 94_800 }]);
    expect(clockSteps(results)).toEqual([100]);
  });
  it('the jump changes nothing else: no fall, no rewind, no pause, the phase stays running', () => {
    const { runner, results } = stall(3_000, 94_800);
    expect([clockKinds(runner), results[100]!.delta.rewound !== undefined, results[100]!.changed.has('sessionPhases')]).toEqual([['jump'], false, false]);
    expect(pauses(runner)).toEqual([]);
    expect([runner.state.history.sessionPhases.map((p) => p.kind), runner.state.open.situations.session.kind]).toEqual([['preStart'], 'running']);
  });
  it('a forward jump of exactly 60 s appends no clock fact', () => {
    const { runner, results } = stall(3_000, 60_000);
    expect([rewoundSteps(results), runner.state.log.clock]).toEqual([[], []]);
  });
  it('the post-session jump appends simulatedEnd and no jump: it opens the post-session instead', () => {
    const { runner } = run(script(beats(150, (k) => ({ at: k < 100 ? atPeak(k) : 4_500_000 + k * STEP })), { session: { sessionType: 1 } }));
    expect(runner.state.open.situations.session.kind).toBe('postSession');
    expect(clockKinds(runner)).toEqual(['simulatedEnd']);
  });
  it('a forward jump in a race after a mid-race fall is a jump fact with the game’s times, and the race clock keeps its offset', () => {
    // the clock falls from raceAt(199) to 1 s at race frame 200, then jumps 90 s ahead at race frame 300 after a 3 s stall
    const OFFSET = raceAt(199) - 1000;
    const rawAt = (k: number) => 1000 + (k - 200) * STEP + (k >= 300 ? 90_000 : 0);
    const all = script(gridStart(400, (k) => ({
      ...(k >= 200 && { at: rawAt(k) }),
      ...(k >= 300 && { wall: (raceFrame(k) * STEP) + 3_000 }),
      ...(k === 350 && { events: [ovtk(0, 1)] }),
    })));
    const { runner, results } = run(all);
    expect(runner.state.log.clock).toMatchObject([
      { kind: 'fall', fromMs: raceAt(199), toMs: 1000, offsetMs: OFFSET },
      { kind: 'jump', fromMs: rawAt(299), toMs: rawAt(300) },
    ]);
    expect(clockSteps(results)).toEqual([raceFrame(200), raceFrame(300)]);
    expect(results[raceFrame(300)]!.delta.rewound).toBeUndefined();
    expect(runner.state.history.events.filter((e) => e.kind === 'overtake').map((e) => e.at)).toEqual([rawAt(350) + OFFSET]);
    expect(runner.state.open.situations.session.kind).toBe('racing');
  });
});

describe('a flashback after a mid-race fall of the session time (review 2 C5)', () => {
  // The clock falls at race frame 200 to 1 s (unless a test says otherwise); at race frame `from` the game goes back to race frame `target`, before the
  // fall or after it, and the fork has an overtake 5 frames after the target. The runner snapshots once per second of
  // session time (an engine constant), so the restore goes through snapshots taken on both sides of the fall.
  const FALL = 200;
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
    const runner = new SessionRunner(initFor(all));
    for (const f of all.slice(0, raceFrame(from) + 1)) runner.apply(f);
    const results = runAll(runner, after(fork, raceFrame(target + 1), raceFrame(from + 1)));
    expect(results[0]!.flashback?.targetFrameId).toBe(raceFrame(target));
    const fresh = new SessionRunner(initFor(fork));
    for (const f of fork) fresh.apply(f);
    expect(shown(runner.state)).toEqual(shown(fresh.state));
  });

  // Inventory 1.10 (raceSingaporeWet lap 44), as the supervisor ruled it: the frames right after a rewind that still
  // carry the pre-rewind session time belong to the rewind's target moment, so everything they record is stamped with
  // the target's time on the race clock. At race frame 240 the game rewinds to race frame `target`; its first two frames
  // still carry the raw session time of race frame 240. Car 0 drives 40 m a frame, so it passes a mini-sector boundary
  // in the second of them, and stands still on the frame after them (later crossings are then timed from that frame,
  // as in a fresh run). Cases: the clock fell 400 ms at race frame 200 and the rewind goes before the fall (its old raw
  // time still lies above the target's) or after it; and a plain rewind without any fall.
  it.each([
    ['across a mid-race fall, to before it', 180, 2_800],
    ['to after a mid-race fall', 220, 2_800],
    ['without any fall', 180, undefined],
  ] as const)('a rewind %s whose first frames still carry the old session time equals a fresh run to the same frame, those frames stamped at the target', (_, target, fallTo) => {
    const standAt = target + 3;
    const timeline = (extra: (k: number) => Beat = () => ({})) => script(gridStart(260, (k) => {
      const driven = k < standAt ? k : k - 1;
      return {
        ...(fallTo !== undefined && k >= FALL && { at: fallTo + (k - FALL) * STEP }),
        cars: (d) => lap(d, 0, { currentLapNum: 1 + Math.floor(driven / 90), lapDistance: (driven % 90) * 40 + 10, ...(driven >= 90 && { lastLapTimeInMs: 90 * STEP }) }),
        ...extra(k),
      };
    }));
    const all = timeline();
    const fork = timeline((k) => (k === target + 5 ? { events: [ovtk(1, 0)] } : {}));
    const runner = new SessionRunner(initFor(all));
    for (const f of all.slice(0, raceFrame(240) + 1)) runner.apply(f);
    const oldMs = all[raceFrame(240)]!.sessionTime;
    const continuation = after(fork, raceFrame(target + 1), raceFrame(241)).slice(0, 15).map((f, i) => (i < 2 ? { ...f, sessionTime: oldMs } : f));
    const results = runAll(runner, continuation);
    expect(results[0]!.flashback?.targetFrameId).toBe(raceFrame(target));

    // The fresh run to the same frame, noting the target's time on the race clock and the crossings of the two frames
    // the stale ones replace.
    const fresh = new SessionRunner(initFor(fork));
    let targetAt = 0;
    let staleCrossings = { from: 0, to: 0 };
    fork.slice(0, raceFrame(target + 15) + 1).forEach((f, i) => {
      if (i === raceFrame(target + 1)) staleCrossings.from = fresh.state.history.crossings.length;
      fresh.apply(f);
      if (i === raceFrame(target)) targetAt = fresh.state.sessionTime;
      if (i === raceFrame(target + 2)) staleCrossings = { ...staleCrossings, to: fresh.state.history.crossings.length };
    });
    expect(staleCrossings.to - staleCrossings.from).toBe(1);
    // The stale frames and the frame after them add no clock fact: the clock facts readers see are the fresh run's.
    expect(runner.state.history.clock).toEqual(fresh.state.history.clock);
    // The only difference the ruling allows: what the stale frames recorded (here one crossing) is stamped at the
    // target's time, where the fresh run has the frames' own times. Nothing else is left out.
    const { history } = fresh.state;
    const miniSectors = history.crossings.map((m, i) => (i >= staleCrossings.from && i < staleCrossings.to ? { ...m, at: targetAt } : m));
    // The log keeps the undone facts behind the void fact (C27), and the fresh run's differs in that crossing too: the
    // state readers see carries the comparison.
    const freshState = shown(fresh.state);
    expect(shown(runner.state)).toEqual({ ...freshState, history: { ...freshState.history, crossings: miniSectors } });
  });
});

// Review 3 E1: the stamp a frame got right after a rewind (it still carried the pre-rewind session time, so it belongs
// to the rewind's target moment) is reproduced whenever the frame is replayed. A second rewind about 1 s after the
// first one's target restores a snapshot from before those frames and replays them (inventory 1.10: SgW f56788, 0.8 s
// after f56743; raceSingaporeWet lap 44, two rewinds 1.5 s apart, the first with stale frames).
describe('a second rewind whose replay crosses the frames the first one stamped at its target', () => {
  const FALL = 200;
  /** Car 0 drives 40 m a frame; the clock falls to `fallTo` at race frame `FALL` when given; `extra` adds events. */
  const timeline = (fallTo: number | undefined, extra: (k: number) => Beat = () => ({})) => script(gridStart(260, (k) => ({
    ...(fallTo !== undefined && k >= FALL && { at: fallTo + (k - FALL) * STEP }),
    cars: (d) => lap(d, 0, { currentLapNum: 1 + Math.floor(k / 90), lapDistance: (k % 90) * 40 + 10, ...(k >= 90 && { lastLapTimeInMs: 90 * STEP }) }),
    ...extra(k),
  })));
  /** `frames` with race frames `from`.. (`count` of them) carrying the session time `ms`, packets unchanged. */
  const withTime = <F extends { sessionTime: number }>(frames: F[], from: number, count: number, ms: number): F[] =>
    frames.map((f, i) => (i >= raceFrame(from) && i < raceFrame(from + count) ? { ...f, sessionTime: ms } : f));

  // Rewind 1 at race frame 240 to race frame 180; rewind 2 at race frame `at2` of the new timeline to race frame
  // `target2`. Each rewind's first two frames still carry the session time the game had before it. Each timeline
  // differs from the one before by an overtake, so a frame of the wrong timeline shows. With the default snapshot
  // interval (1 s of session time) the first snapshot after rewind 1 comes at race frame 185, so rewind 2 restores one
  // from before race frame 180 and replays the stale frames.
  it.each([
    ['to after them, about 1 s later', undefined, 184, 240],
    ['onto the last of them, 6 frames later', undefined, 182, 188],
    ['to after them, about 1 s later, the first rewind across a mid-race fall to before it', 2_800, 184, 240],
  ] as const)('a second rewind %s equals a fresh run, every stale frame stamped at its rewind’s target (full state and history)', (_, fallTo, target2, at2) => {
    const all = timeline(fallTo);
    const fork1 = timeline(fallTo, (k) => (k === 183 ? { events: [ovtk(1, 0)] } : {}));
    const fork2 = timeline(fallTo, (k) => (k === 183 ? { events: [ovtk(1, 0)] } : k === target2 + 5 ? { events: [ovtk(0, 1)] } : {}));
    const runner = new SessionRunner(initFor(all));
    for (const f of all.slice(0, raceFrame(240) + 1)) runner.apply(f);

    const old1 = all[raceFrame(240)]!.sessionTime;
    const resumed1 = after(fork1, raceFrame(181), raceFrame(241)).slice(0, at2 - 180).map((f, i) => (i < 2 ? { ...f, sessionTime: old1 } : f));
    const results1 = runAll(runner, resumed1);
    expect(results1[0]!.flashback?.targetFrameId).toBe(raceFrame(180));

    const old2 = resumed1.at(-1)!.sessionTime;
    const resumed2 = after(fork2, raceFrame(target2 + 1), raceFrame(241) + resumed1.length).slice(0, 15).map((f, i) => (i < 2 ? { ...f, sessionTime: old2 } : f));
    const results2 = runAll(runner, resumed2);
    expect(results2[0]!.flashback?.targetFrameId).toBe(raceFrame(target2));

    // The fresh run over the last timeline, each rewind's stale frames carrying the session time of its target frame
    // (the ruling's stamp: what they record lies at the target's time on the race clock).
    const stamped1 = withTime(fork2, 181, 2, fork2[raceFrame(180)]!.sessionTime);
    const reference = withTime(stamped1, target2 + 1, 2, stamped1[raceFrame(target2)]!.sessionTime);
    const fresh = new SessionRunner(initFor(reference));
    for (const f of reference.slice(0, raceFrame(target2 + 15) + 1)) fresh.apply(f);
    // The stale frames and the frame after them add no clock fact (the timeline's own fall, at race frame 200, is one).
    expect(runner.state.history.clock).toEqual(fresh.state.history.clock);
    expect(shown(runner.state)).toEqual(shown(fresh.state));
  });
});

// Review 3 E2: the runner's decision that a frame reports a flashback reaches the clock one way, and a replay after a
// later rewind reproduces it. Here an FLBK that targets no frame behind the state (so no rewind is taken) comes with
// the session time falling 800 ms; it is a report, so the clock reads no fall on it. A later rewind replays it.
describe('a frame the runner took as a flashback report stays one when a later rewind replays it', () => {
  /** At race frame 200 an FLBK naming its own frame id, the clock 800 ms lower from there on; frame ids keep rising. */
  const frames = () => script(gridStart(300, (k) => ({
    ...(k >= 200 && { at: raceAt(k) - 800 }),
    ...(k === 200 && { events: [flbk(raceFrame(200), raceAt(150))] }),
    cars: (d) => lap(d, 0, { currentLapNum: 1 + Math.floor(k / 90), lapDistance: (k % 90) * 40 + 10, ...(k >= 90 && { lastLapTimeInMs: 90 * STEP }) }),
  })));

  it('the report appends no clock fact on the first pass', () => {
    const { runner, results } = run(frames().slice(0, raceFrame(210) + 1));
    expect([results[raceFrame(200)]!.flashback, runner.state.log.clock]).toEqual([undefined, []]);
  });
  it('a rewind at race frame 230 to race frame 205, replaying the report, equals a run without the rewind and appends no clock fact', () => {
    const all = frames();
    const { runner } = run(all.slice(0, raceFrame(230) + 1));
    const results = runAll(runner, after(all, raceFrame(206), raceFrame(231)).slice(0, 40));
    expect(results[0]!.flashback?.targetFrameId).toBe(raceFrame(205));
    expect(runner.state.log.clock).toEqual([]);
    const fresh = run(all.slice(0, raceFrame(245) + 1)).runner;
    expect(shown(runner.state)).toEqual(shown(fresh.state));
  });
});

// Review 5 R1 and review 6 R6-1: a live join, or a cut segment whose first frame after the Session packet carries an
// FLBK whose target lies below the Session packet's frame id. No frame was applied, so there is nothing to rewind: the
// frame is applied as the session's first, reports no flashback, and the frames after it read the pause and jump rules
// from it.
describe('a flashback report on the session’s first frame', () => {
  const JOIN = 10;
  const PAUSED_AT = 30;
  const FALL_AT = 45;
  /**
   * Practice from frame 0, joined at frame `JOIN` (a Session and a Participants packet there, so the runner's identity
   * wait ends on it) a minute of wall time in, the FLBK to frame 5 on the join's frame when `flashback`; a 3 s wall gap
   * before frame `PAUSED_AT`, a 1 s fall of the clock at `FALL_AT`.
   */
  const joined = (flashback: boolean) => {
    const all = script(beats(60, (k) => ({
      at: k * STEP - (k >= FALL_AT ? 1_000 : 0),
      wall: 60_000 + k * STEP + (k >= PAUSED_AT ? 3_000 : 0),
      ...(k === JOIN && { session: {}, ...(flashback && { events: [flbk(5, 5 * STEP)] }) }),
    })), { session: { sessionType: 1 } });
    return [{ ...all[JOIN]!, participants: all[0]!.participants! }, ...all.slice(JOIN + 1)];
  };
  const runJoined = (flashback: boolean) => {
    const frames = joined(flashback);
    const runner = new SessionRunner(initFor(frames));
    // The first step's result but its state (the state is compared on its own below).
    const { state: _state, ...firstStep } = applyOne(runner, frames[0]!);
    const { lastFrameId, sessionTime, session, cars, history, open } = runner.state;
    // What readers see after the first frame, and the clock's state it left for the pause and jump rules.
    const first = structuredClone({ lastFrameId, sessionTime, session, cars, history, situations: open.situations, clock: clockInput(runner.state) });
    return { runner, first, firstStep, rest: runAll(runner, frames.slice(1)) };
  };

  // Review 6 R6-1: before the first applied frame there is nothing to rewind, so the report is no flashback: the
  // engineer's feed shows none (no "flashback, lap 0"), and readers get no discarded timeline.
  it('the first step reports no flashback and is not truncated: its result equals the same frame’s without the FLBK', () => {
    const { firstStep } = runJoined(true);
    expect([firstStep.flashback, firstStep.delta.rewound !== undefined]).toEqual([undefined, false]);
    expect(firstStep).toEqual(runJoined(false).firstStep);
  });

  it('the frame is applied (no throw) as the session’s first: what it leaves equals the same frame without the FLBK', () => {
    const frames = joined(true);
    expect([frames[0]!.frameId, frames[0]!.events.map((e) => e.details.code)]).toEqual([JOIN, ['FLBK']]);
    const { first } = runJoined(true);
    expect(first).toEqual(runJoined(false).first);
    expect(first.lastFrameId).toBe(JOIN);
  });
  it('a minute of wall time before the first frame is no pause; the 3 s gap later is one paused span, measured from the frame before it', () => {
    const { runner } = runJoined(true);
    expect(pauses(runner)).toMatchObject([{ machine: 'clock', id: 0, kind: 'paused', start: (PAUSED_AT - 1) * STEP, detail: { source: 'offline', wallMs: 3_000 + STEP } }]);
  });
  it('the frames after it read the jump rules from it: the fall is a fact of its step, and every step and the final state equal a session without the FLBK', () => {
    const withFlbk = runJoined(true);
    const plain = runJoined(false);
    expect(withFlbk.runner.state.log.clock).toMatchObject([{ kind: 'fall', fromMs: (FALL_AT - 1) * STEP, toMs: FALL_AT * STEP - 1_000 }]);
    expect(clockSteps(withFlbk.rest)).toEqual([FALL_AT - JOIN - 1]);
    expect(rewoundSteps(withFlbk.rest)).toEqual(rewoundSteps(plain.rest));
    expect(clockSteps(withFlbk.rest)).toEqual(clockSteps(plain.rest));
    expect(withFlbk.runner.state).toEqual(plain.runner.state);
  });
});

// Pauses (spec 3.1, C7, C20; ported from session-phase.test.ts): the clock's one span kind, `paused`. Offline: no
// frame for over 2 s of wall time beyond what the session time advanced opens and closes one paused span. Online: the
// Session packet's `gamePaused` 1 opens one that stays open in the situation until `gamePaused` 0 closes it.
describe('pauses', () => {
  /** A race whose race frame 50 arrives `gapMs` of wall time after the one before (no packets in between). */
  const gap = (gapMs: number) => run(script(gridStart(100, (k) => (k === 50 ? { wall: raceFrame(50) * STEP + gapMs } : {}))));
  /** An online race paused by the game from race frame 50 to race frame 100, `n` race frames. */
  const online = (n: number) =>
    run(script(gridStart(n, (k) => (k === 50 ? { session: { gamePaused: 1 } } : k === 100 ? { session: { gamePaused: 0 } } : {})), { session: { networkGame: 1 } }));

  it('offline: no packets for more than 2 s opens and closes one paused span; it changes no phase', () => {
    const { runner } = gap(3_000);
    const [pause] = pauses(runner);
    expect(pauses(runner)).toMatchObject([{ machine: 'clock', id: 0, kind: 'paused', start: raceAt(49), detail: { source: 'offline' } }]);
    expect((pause!.detail as { wallMs: number }).wallMs).toBeGreaterThanOrEqual(3_000);
    expect((pause!.detail as { wallMs: number }).wallMs).toBeLessThanOrEqual(3_000 + STEP);
    expect(pause!.end).toBeGreaterThanOrEqual(pause!.start);
    expect(openPause(runner)).toEqual([]);
    expect(runner.state.open.situations.session).toEqual({ kind: 'racing', start: 0, startLeaderLap: 1 });
  });
  it('offline: a gap of 2 s or less is no pause', () => {
    expect(pauses(gap(2_000 - STEP).runner)).toEqual([]);
  });
  it('online: gamePaused 1 opens a paused span, open in the situation (byMachine.clock) while the pause lasts', () => {
    const { runner } = online(80);
    expect(openPause(runner)).toMatchObject([{ machine: 'clock', id: 0, kind: 'paused', start: raceAt(50), detail: { source: 'online' } }]);
    expect([situationOf(runner.state).paused, clockInput(runner.state).paused, pauses(runner)]).toEqual([true, true, []]);
  });
  it('online: gamePaused 0 closes the span into spans:clock with the pause’s wall time; it changes no phase', () => {
    const { runner } = online(150);
    expect(pauses(runner)).toMatchObject([{ machine: 'clock', id: 0, kind: 'paused', start: raceAt(50), end: raceAt(100), detail: { source: 'online', wallMs: 50 * STEP } }]);
    expect([openPause(runner), situationOf(runner.state).paused, clockInput(runner.state).paused]).toEqual([[], false, false]);
    expect(runner.state.open.situations.session).toEqual({ kind: 'racing', start: 0, startLeaderLap: 1 });
  });
  it('no other pause record exists: the log and the projection have no pauses list', () => {
    const { runner } = online(150);
    expect(['pauses' in runner.state.history, 'pauses' in runner.state.log]).toEqual([false, false]);
  });
  it('the session’s end (closeSession) closes the clock’s open paused span at the last frame’s time', () => {
    const { runner } = online(80);
    const end = runner.state.sessionTime;
    runner.finish();
    expect(runner.state.log.spans['clock']).toMatchObject([{ machine: 'clock', id: 0, kind: 'paused', start: raceAt(50), end, detail: { source: 'online' } }]);
    expect(openPause(runner)).toEqual([]);
  });
});
