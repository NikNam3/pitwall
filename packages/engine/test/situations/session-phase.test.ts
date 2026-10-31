// The situation tracker's session phases (spec docs/superpowers/specs/2026-10-30-situations-design.md 3.1): which
// signal opens and closes each phase, the confirmations, the session ends, joins, pauses and a flashback across a
// phase boundary. Closed phases are `history.sessionPhases`; the phase in progress is `open.situations.session`.
import { describe, expect, it } from 'vitest';
import { activeFlagPhaseOf, situationOf, type SessionRunner, type StepResult } from '../../src/index.ts';
import { after } from '../support/runner.ts';
import { expectScheduledIncremental, input, quick, sched, underNeutralisation, underPhase } from '../support/scheduler.ts';
import {
  beats,
  CHQF,
  FIRST_LIGHT,
  GRID_START_TRUNCATED,
  gridStart,
  lap,
  LGOT,
  LIGHTS_OUT,
  ovtk,
  raceAt,
  rcwn,
  RDFL,
  run,
  scar,
  script,
  SEND,
  status,
  STEP,
  stlg,
  TRACK,
  type Beat,
} from './script.ts';

const closed = (r: SessionRunner) => r.state.history.sessionPhases;
const kinds = (r: SessionRunner) => closed(r).map((p) => p.kind);
const current = (r: SessionRunner) => r.state.open.situations.session;
/** Index of race frame k of `gridStart` among the frames. */
const raceFrame = (k: number) => LIGHTS_OUT + 1 + k;
/**
 * A race of `n` frames after a grid start whose race frame k has the beat `at[k]`. With `jump`, the session time jumps
 * forward by `ms` at race frame `from` and runs on from there.
 */
const raceScript = (n: number, at: Record<number, Beat>, jump?: { from: number; ms: number }) =>
  script(gridStart(n, (k) => ({ ...(jump && k >= jump.from && { at: raceAt(k) + jump.ms }), ...at[k] })));
const race = (n: number, at: Record<number, Beat>, jump?: { from: number; ms: number }) => run(raceScript(n, at, jump));
/** The steps that discarded history (`delta.truncated`), by frame index. */
const truncated = (results: StepResult[]) => results.flatMap((r, i) => (r.delta.truncated ? [i] : []));

describe('the start of a race without a formation lap', () => {
  it('the grid is preStart, the first start light opens startLights, lights out opens racing', () => {
    const { runner } = run(script(gridStart(20)));
    expect(closed(runner).map((p) => [p.kind, p.start, p.end])).toEqual([['preStart', 0, 0], ['startLights', 0, 0]]);
    expect(current(runner)).toEqual({ kind: 'racing', start: 0, startLeaderLap: 1 });
  });
  it('a step that opens or closes a phase is tagged sessionPhases, and no other step is', () => {
    const { results } = run(script(gridStart(20)));
    const tagged = results.flatMap((r, i) => (i > 0 && r.changed.has('sessionPhases') ? [i] : []));
    expect(tagged).toEqual([FIRST_LIGHT, LIGHTS_OUT]);
  });
  it('a lights out before any start light is no race start', () => {
    const { runner } = run(script(beats(30, (k) => ({ at: 0, ...(k === 5 && { events: [LGOT] }) }))));
    expect([kinds(runner), current(runner).kind]).toEqual([[], 'preStart']);
  });
});

describe('a neutralisation (SC, VSC)', () => {
  it('an SC opens on its deployment and closes on its resume, with every stage on the way', () => {
    const { runner } = race(300, {
      50: { events: [scar(1, 0)] },
      60: { session: status(1) },
      100: { events: [scar(1, 1)] },
      120: { cars: (d) => lap(d, 0, { currentLapNum: 2, lastLapTimeInMs: 100_000 }) },
      150: { events: [scar(1, 2)] },
      200: { events: [scar(1, 3)] },
      210: { session: status(0) },
    });
    expect(closed(runner).slice(2)).toEqual([
      { kind: 'racing', start: 0, end: raceAt(50), startLeaderLap: 1, endLeaderLap: 1 },
      {
        kind: 'neutralised', start: raceAt(50), end: raceAt(200), startLeaderLap: 1, endLeaderLap: 2,
        detail: { kind: 'neutralised', car: 'SC', stages: [
          { stage: 'deployed', at: raceAt(50) }, { stage: 'returning', at: raceAt(100) },
          { stage: 'returned', at: raceAt(150) }, { stage: 'resume', at: raceAt(200) }] },
      },
    ]);
    expect(current(runner)).toEqual({ kind: 'racing', start: raceAt(200), startLeaderLap: 2 });
  });
  it('a VSC records deployed, returning and resume', () => {
    const { runner } = race(200, { 50: { events: [scar(2, 0)] }, 60: { session: status(2) }, 100: { events: [scar(2, 1)] },
      150: { events: [scar(2, 3)] }, 160: { session: status(0) } });
    expect(closed(runner).at(-1)).toMatchObject({ kind: 'neutralised', start: raceAt(50), end: raceAt(150),
      detail: { kind: 'neutralised', car: 'VSC', stages: [{ stage: 'deployed', at: raceAt(50) }, { stage: 'returning', at: raceAt(100) },
        { stage: 'resume', at: raceAt(150) }] } });
  });
  it('the safety car status going green closes it when it comes before the resume; the late resume changes nothing', () => {
    const { runner } = race(200, { 50: { events: [scar(1, 0)] }, 60: { session: status(1) }, 150: { session: status(0) },
      160: { events: [scar(1, 3)] } });
    expect(closed(runner).filter((p) => p.kind === 'neutralised').map((p) => [p.start, p.end])).toEqual([[raceAt(50), raceAt(150)]]);
    expect(current(runner)).toEqual({ kind: 'racing', start: raceAt(150), startLeaderLap: 1 });
  });
  it('a status change to SC without a deployment event opens it at that frame', () => {
    const { runner } = race(100, { 50: { session: status(1) } });
    expect(current(runner)).toMatchObject({ kind: 'neutralised', start: raceAt(50), detail: { kind: 'neutralised', car: 'SC' } });
  });
  it('one Session packet without the SC status keeps the deployment open: its confirmation may still come', () => {
    const { runner } = race(70, { 50: { events: [scar(1, 0)] }, 60: { session: status(0) } });
    expect(current(runner)).toMatchObject({ kind: 'neutralised', start: raceAt(50) });
  });
  // The confirmation window: the status must show the deployment within 3 s of its SCAR (recorded lags 0.5–1.31 s, inventory 1.4).
  const WITHIN = Math.floor(2_900 / STEP);
  const AFTER = Math.ceil(3_100 / STEP);
  it('a deployment the status confirms within 3 s stands, after packets that still show green', () => {
    const { runner } = race(50 + WITHIN + 10, { 50: { events: [scar(1, 0)] }, 60: { session: status(0) }, 90: { session: status(0) }, [50 + WITHIN]: { session: status(1) } });
    expect(current(runner)).toMatchObject({ kind: 'neutralised', start: raceAt(50), detail: { car: 'SC' } });
  });
  it('a deployment the status does not confirm within 3 s is dropped: racing goes on as if it never opened, and no flag phase is left', () => {
    const { runner } = race(50 + AFTER + 10, { 50: { events: [scar(1, 0)] }, 60: { session: status(0) }, 90: { session: status(0) }, [50 + AFTER]: { session: status(0) } });
    expect(kinds(runner)).toEqual(['preStart', 'startLights']);
    expect(current(runner)).toEqual({ kind: 'racing', start: 0, startLeaderLap: 1 });
    expect([runner.state.history.flagPhases, activeFlagPhaseOf(runner.state)]).toEqual([[], undefined]);
  });
  it('an SC deployed while a VSC is on closes the VSC and opens the SC at the same time', () => {
    const { runner } = race(150, { 50: { events: [scar(2, 0)] }, 60: { session: status(2) }, 100: { events: [scar(1, 0)] },
      110: { session: status(1) } });
    expect(closed(runner).at(-1)).toEqual({ kind: 'neutralised', start: raceAt(50), end: raceAt(100), startLeaderLap: 1, endLeaderLap: 1,
      detail: { kind: 'neutralised', car: 'VSC', stages: [{ stage: 'deployed', at: raceAt(50) }] } });
    expect(current(runner)).toEqual({ kind: 'neutralised', start: raceAt(100), startLeaderLap: 1,
      detail: { kind: 'neutralised', car: 'SC', stages: [{ stage: 'deployed', at: raceAt(100) }] } });
  });
  it('a resume sent twice (types 1 and 0) closes the SC once; a later type-0 resume changes nothing', () => {
    const { runner } = race(200, { 50: { events: [scar(1, 0)] }, 60: { session: status(1) }, 100: { events: [scar(1, 3), scar(0, 3)] },
      110: { session: status(0) }, 130: { events: [scar(0, 3)] } });
    expect(closed(runner).filter((p) => p.kind === 'neutralised')).toMatchObject([{ start: raceAt(50), end: raceAt(100),
      detail: { stages: [{ stage: 'deployed' }, { stage: 'resume', at: raceAt(100) }] } }]);
    expect(current(runner)).toEqual({ kind: 'racing', start: raceAt(100), startLeaderLap: 1 });
  });
  it('the flag phases readers still get come from the neutralised span', () => {
    const { runner } = race(200, { 50: { events: [scar(1, 0)] }, 60: { session: status(1) }, 150: { events: [scar(1, 3)] }, 160: { session: status(0) } });
    expect(runner.state.history.flagPhases).toMatchObject([{ kind: 'SC', start: raceAt(50), end: raceAt(150),
      scPhases: [{ phase: 'deployed', at: raceAt(50) }, { phase: 'resume', at: raceAt(150) }] }]);
  });
});

describe('a neutralisation dropped unconfirmed is a discarded timeline (review 2 B2)', () => {
  /** The first race frame more than 3 s after a deployment at race frame 50: the deployment expires there. */
  const EXPIRY = 50 + Math.floor(3_000 / STEP) + 1;
  /** Car 0 drives 40 m a frame from lights out, so mini-sector crossings come while the deployment waits. */
  const driving = (k: number): Beat => ({
    cars: (d) => lap(d, 0, { currentLapNum: 1 + Math.floor((10 + 40 * k) / TRACK), lapDistance: (10 + 40 * k) % TRACK }),
  });

  it('a deployment that expires after 3 s: that step is truncated, and no other but the grid start’s lights out, and it reports no flashback', () => {
    const { results } = race(EXPIRY + 20, { 50: { events: [scar(1, 0)] } });
    expect(truncated(results)).toEqual([...GRID_START_TRUNCATED, raceFrame(EXPIRY)]);
    expect(results[raceFrame(EXPIRY)]!.flashback).toBeUndefined();
  });
  it('a deployment dropped at SEND: the SEND step is truncated, and no other but the grid start’s lights out', () => {
    const { results } = race(200, { 190: { events: [scar(1, 0)] }, 199: { events: [SEND] } });
    // SEND and the packets after it carry frame id 0, so the assembler adds them to the frame before: race frame 198.
    expect(truncated(results)).toEqual([...GRID_START_TRUNCATED, raceFrame(198)]);
  });
  it('a deployment dropped at the simulated end: the step of the jump is truncated, and no other but the grid start’s lights out', () => {
    const { results } = race(150, { 90: { events: [scar(2, 0)] } }, { from: 100, ms: 6_000_000 });
    expect(truncated(results)).toEqual([...GRID_START_TRUNCATED, raceFrame(100)]);
  });
  it('a deployment the status confirms truncates no step: the only truncated step is the grid start’s lights out', () => {
    const { results } = race(EXPIRY + 20, { 50: { events: [scar(1, 0)] }, 60: { session: status(1) } });
    expect(truncated(results)).toEqual(GRID_START_TRUNCATED);
  });
  it('a flashback from after the drop to the wait before it equals a run that never saw the discarded frames', () => {
    const scarAt50 = { 50: { events: [scar(1, 0)] } };
    const first = raceScript(EXPIRY + 40, scarAt50);
    const fork = raceScript(EXPIRY + 40, { ...scarAt50, [EXPIRY - 20]: { events: [ovtk(1, 0)] } });
    const { runner } = run(first.slice(0, raceFrame(EXPIRY + 20) + 1));
    const results = after(fork, raceFrame(EXPIRY - 29), raceFrame(EXPIRY + 21)).map((f) => runner.apply(f));
    expect(results[0]!.flashback?.targetFrameId).toBe(raceFrame(EXPIRY - 30));
    expect(runner.state).toEqual(run(fork).runner.state);
  });
  it.each([
    ['its 3 s expiry', EXPIRY + 40, undefined],
    ['the simulated end', 150, { from: 100, ms: 6_000_000 }],
  ] as const)('a reader that folds what happened under a neutralisation equals a fresh init on every step, across a deployment dropped at %s', (_, n, jump) => {
    const frames = script(gridStart(n, (k) => ({ ...driving(k), ...(jump && k >= jump.from && { at: raceAt(k) + jump.ms }), ...(k === 50 && { events: [scar(1, 0)] }) })));
    expectScheduledIncremental(underNeutralisation, frames);
  });
});

describe('a suspension (red flag)', () => {
  it('a red flag suspends the race; a standing restart goes through the start lights to racing, which is no new race start', () => {
    const { runner, results } = race(250, {
      50: { events: [RDFL] },
      ...Object.fromEntries([1, 2, 3, 4, 5].map((n) => [90 + 10 * n, { events: [stlg(n)] }])),
      160: { events: [LGOT] },
    });
    expect(closed(runner).slice(2)).toMatchObject([
      { kind: 'racing', start: 0, end: raceAt(50) },
      { kind: 'suspended', start: raceAt(50), end: raceAt(100), detail: { kind: 'suspended', restart: { known: true, value: 'standing' } } },
      { kind: 'startLights', start: raceAt(100), end: raceAt(160) },
    ]);
    expect(current(runner)).toEqual({ kind: 'racing', start: raceAt(160), startLeaderLap: 1 });
    expect(results[raceFrame(160)]!.delta.truncated).toBe(false);
    expect(runner.state.history.flagPhases).toMatchObject([{ kind: 'red', start: raceAt(50), end: raceAt(100) }]);
  });
  it('a rolling restart behind the safety car closes the suspension and opens the SC', () => {
    const { runner } = race(150, { 50: { events: [RDFL] }, 100: { session: status(1) } });
    expect(closed(runner).at(-1)).toMatchObject({ kind: 'suspended', start: raceAt(50), end: raceAt(100),
      detail: { kind: 'suspended', restart: { known: true, value: 'rolling' } } });
    expect(current(runner)).toMatchObject({ kind: 'neutralised', start: raceAt(100), detail: { car: 'SC' } });
  });
});

describe('the end of a race', () => {
  it('the race winner opens finished, the chequered flag after it changes nothing, SEND opens the post-session', () => {
    const { runner } = race(200, { 100: { events: [rcwn(0)] }, 150: { events: [CHQF] }, 199: { events: [SEND] } });
    expect(closed(runner).slice(2).map((p) => [p.kind, p.start, p.end])).toEqual([['racing', 0, raceAt(100)], ['finished', raceAt(100), raceAt(199)]]);
    expect(current(runner)).toMatchObject({ kind: 'postSession', start: raceAt(199) });
  });
  it('a chequered flag without a race winner opens finished too', () => {
    const { runner } = race(200, { 150: { events: [CHQF] } });
    expect(current(runner)).toMatchObject({ kind: 'finished', start: raceAt(150) });
  });
  it('a race left mid-lap: the last frame sets every car finished and SEND follows; that is a session end, not a finish', () => {
    const { runner } = race(200, { 199: { events: [SEND], cars: (d) => { lap(d, 0, { resultStatus: 3 }); lap(d, 1, { resultStatus: 3 }); } } });
    expect(kinds(runner)).toEqual(['preStart', 'startLights', 'racing']);
    expect(current(runner).kind).toBe('postSession');
  });
  it('online, without SEND: a jump of the session time by more than 60 s opens the post-session (the simulated rest)', () => {
    const { runner } = race(150, {}, { from: 100, ms: 6_000_000 });
    expect(kinds(runner)).toEqual(['preStart', 'startLights', 'racing']);
    expect(current(runner).kind).toBe('postSession');
  });
  it('a neutralisation announced just before the simulated end is never confirmed and leaves no span', () => {
    const { runner } = race(150, { 90: { events: [scar(2, 0)] } }, { from: 100, ms: 6_000_000 });
    expect(kinds(runner)).toEqual(['preStart', 'startLights', 'racing']);
    expect(current(runner).kind).toBe('postSession');
  });
  it.each([
    ['60 s', 60_000, 'racing'],
    ['60.001 s', 60_001, 'postSession'],
  ] as const)('a jump forward of %s leaves the phase %s', (_, jumpMs, kind) => {
    const { runner } = race(150, {}, { from: 100, ms: jumpMs - STEP });
    expect(current(runner).kind).toBe(kind);
  });
  it('a final classification opens the post-session', () => {
    const { runner } = race(150, { 100: { cars: (d) => { d.add('finalClassification', { numCars: 2 }); } } });
    expect(kinds(runner)).toEqual(['preStart', 'startLights', 'racing']);
    expect(current(runner).kind).toBe('postSession');
  });
});

describe('practice, qualifying and time trial', () => {
  /** The clock holds at 0 for 10 frames, then runs. */
  const session = (sessionType: number, n: number, last: Beat = {}) =>
    run(script(beats(n, (k) => ({ at: k < 10 ? 0 : (k - 9) * STEP, ...(k === n - 1 && last) })), { session: { sessionType } }));

  it('practice: preStart until the session clock runs, then running; no formation or start lights', () => {
    const { runner } = session(1, 100);
    expect(closed(runner).map((p) => [p.kind, p.start, p.end])).toEqual([['preStart', 0, STEP]]);
    expect(current(runner)).toEqual({ kind: 'running', start: STEP, startLeaderLap: 1 });
  });
  it('qualifying: time over (SEND with every car finished) closes running with finished, then the post-session', () => {
    const { runner } = session(6, 100, { events: [SEND], cars: (d) => { lap(d, 0, { resultStatus: 3 }); lap(d, 1, { resultStatus: 3 }); } });
    expect(kinds(runner)).toEqual(['preStart', 'running', 'finished']);
    expect(current(runner).kind).toBe('postSession');
  });
  it('practice left from the menu (the player retired, the others set finished, then SEND) has no finished phase', () => {
    const { runner } = session(1, 100, { events: [SEND], cars: (d) => { lap(d, 0, { resultStatus: 7 }); lap(d, 1, { resultStatus: 3 }); } });
    expect(kinds(runner)).toEqual(['preStart', 'running']);
    expect(current(runner).kind).toBe('postSession');
  });
  it('time trial: running only', () => {
    const { runner } = session(18, 100);
    expect([kinds(runner), current(runner).kind]).toEqual([[], 'running']);
  });
});

describe('a bridge that joins mid-session', () => {
  it('joining a race mid-lap: racing from the first frame, marked joined, and no transition after it', () => {
    const { runner } = run(script(beats(100, (k) => ({
      at: 200_000 + k * STEP,
      cars: (d) => { lap(d, 0, { currentLapNum: 3, lapDistance: 1200 + 40 * k, currentLapTimeInMs: 30_000 + k * STEP }); lap(d, 1, { currentLapNum: 3, lapDistance: 1100 + 40 * k }); },
    }))));
    expect(kinds(runner)).toEqual([]);
    expect(current(runner)).toEqual({ kind: 'racing', start: 200_000, startLeaderLap: 3, joinedAt: true });
  });
  it('joining under the safety car: neutralised from the first frame, marked joined; its resume opens racing', () => {
    const { runner } = run(script(beats(100, (k) => ({
      at: 300_000 + k * STEP,
      ...(k === 0 && { session: status(1), cars: (d) => { lap(d, 0, { currentLapNum: 5, lapDistance: 900 }); lap(d, 1, { currentLapNum: 5, lapDistance: 800 }); } }),
      ...(k === 50 && { events: [scar(1, 3)] }),
    }))));
    expect(closed(runner)).toMatchObject([{ kind: 'neutralised', start: 300_000, joinedAt: true, detail: { kind: 'neutralised', car: 'SC' } }]);
    expect(current(runner)).toEqual({ kind: 'racing', start: 300_000 + 50 * STEP, startLeaderLap: 5 });
  });
  // Review 2 B1: a bridge started in the start lights' hold (after the fifth light) or within 1 s after lights out sees
  // no start light and no lap timer past 1 s, so it opens the grid; the race is under way once a timer passes 1 s.
  /** Both cars' lap timers read `ms`. */
  const timers = (ms: number): NonNullable<Beat['cars']> => (d) => { lap(d, 0, { currentLapTimeInMs: ms }); lap(d, 1, { currentLapTimeInMs: ms }); };
  it('joining after the fifth start light: racing opens, marked joined, on the first frame a lap timer runs past 1 s; the race winner finishes it', () => {
    const { runner } = run(script([
      ...beats(30, (k) => ({ at: 0, ...(k === 29 && { events: [LGOT] }) })),
      ...beats(200, (k) => ({ at: (k + 1) * STEP, cars: timers((k + 1) * STEP), ...(k === 150 && { events: [rcwn(0)] }) })),
    ]));
    expect(closed(runner)).toMatchObject([
      { kind: 'preStart', start: 0, end: 1008 },
      { kind: 'racing', start: 1008, end: 151 * STEP, joinedAt: true },
    ]);
    expect(current(runner)).toMatchObject({ kind: 'finished', start: 151 * STEP });
  });
  it('joining within 1 s after lights out: racing opens, marked joined, once a lap timer runs past 1 s; the chequered flag finishes it', () => {
    const { runner } = run(script(beats(150, (k) => ({ at: 500 + k * STEP, cars: timers(500 + k * STEP), ...(k === 100 && { events: [CHQF] }) }))));
    expect(closed(runner)).toMatchObject([
      { kind: 'preStart', start: 500, end: 500 + 32 * STEP },
      { kind: 'racing', start: 500 + 32 * STEP, end: 500 + 100 * STEP, joinedAt: true },
    ]);
    expect(current(runner)).toMatchObject({ kind: 'finished', start: 500 + 100 * STEP });
  });
  it('on the grid a lap timer below 1 s (a car standing past the line) is no race under way: the grid waits for the start lights', () => {
    const { runner } = run(script(gridStart(20, () => ({})).map((beat, k) => (k <= LIGHTS_OUT ? { ...beat, cars: (d) => lap(d, 1, { currentLapTimeInMs: 510 }) } : beat))));
    expect(kinds(runner)).toEqual(['preStart', 'startLights']);
  });
  // Review 6 R6-6: until a frame is applied the state carries the Session packet's time, so a phase the first frame
  // opens lies at or below it; no earlier frame recorded anything, so nothing is moved and nothing is discarded.
  it('a phase the session’s first frame opens (a race joined on the frame of its first start light, the clock held) truncates no step', () => {
    const { runner, results } = run(script(beats(30, (k) => ({ at: 0, ...(k === 0 && { events: [stlg(1)] }) }))));
    expect([closed(runner).map((p) => [p.kind, p.start, p.end]), current(runner).kind]).toEqual([[['preStart', 0, 0]], 'startLights']);
    expect(results[0]!.changed.has('sessionPhases')).toBe(true);
    expect(truncated(results)).toEqual([]);
  });
  it('joining a practice mid-session: running from the first frame, marked joined', () => {
    const { runner } = run(script(beats(100, (k) => ({ at: 121_552 + k * STEP })), { session: { sessionType: 1, sessionDuration: 3600, sessionTimeLeft: 3478 } }));
    expect(kinds(runner)).toEqual([]);
    expect(current(runner)).toMatchObject({ kind: 'running', start: 121_552, joinedAt: true });
  });
});

describe('pauses', () => {
  /** A race whose race frame 50 arrives `gapMs` of wall time after the one before (no packets in between). */
  const gap = (gapMs: number) => race(100, { 50: { wall: raceFrame(50) * STEP + gapMs } });

  it('offline: no packets for more than 2 s with a frozen session time is a pause; it changes no phase', () => {
    const { runner } = gap(3_000);
    const [pause] = runner.state.history.pauses;
    expect(runner.state.history.pauses).toMatchObject([{ start: raceAt(49), kind: 'offline' }]);
    expect(pause!.wallMs).toBeGreaterThanOrEqual(3_000);
    expect(pause!.wallMs).toBeLessThanOrEqual(3_000 + STEP);
    expect(current(runner)).toEqual({ kind: 'racing', start: 0, startLeaderLap: 1 });
  });
  it('offline: a gap of 2 s or less is no pause', () => {
    expect(gap(2_000 - STEP).runner.state.history.pauses).toEqual([]);
  });
  it('online: the game paused from one Session packet to the next is a pause; paused while it lasts', () => {
    const beatsOf = (n: number) => script(gridStart(n, (k) => (k === 50 ? { session: { gamePaused: 1 } } : k === 100 ? { session: { gamePaused: 0 } } : {})),
      { session: { networkGame: 1 } });
    const during = run(beatsOf(80)).runner;
    expect([situationOf(during.state).paused, during.state.history.pauses]).toEqual([true, []]);
    const { runner } = run(beatsOf(150));
    expect(situationOf(runner.state).paused).toBe(false);
    expect(runner.state.history.pauses).toEqual([{ start: raceAt(50), wallMs: 50 * STEP, kind: 'online' }]);
    expect(current(runner)).toEqual({ kind: 'racing', start: 0, startLeaderLap: 1 });
  });
});

describe('a flashback across a phase boundary', () => {
  // The SC is deployed at race frame 50 and resumes at 150; at 200 the game goes back to race frame 80, inside the SC,
  // and the fork resumes at 180 instead.
  const sc = (resumeAt: number) => script(gridStart(300, (k) => ({
    50: { events: [scar(1, 0)] }, 60: { session: status(1) }, [resumeAt]: { events: [scar(1, 3)] }, [resumeAt + 10]: { session: status(0) },
  } as Record<number, Beat>)[k] ?? {}));

  it('the spans after the target go, the open phase is the target’s, and every reader equals a run that never saw the discarded frames', () => {
    const first = sc(150).slice(0, raceFrame(200) + 1);
    const fork = sc(180);
    const { runner } = run(first);
    const rewind = runner.apply(after(fork, raceFrame(81), raceFrame(201))[0]!);
    expect(rewind.flashback?.targetFrameId).toBe(raceFrame(80));
    expect(kinds(runner)).toEqual(['preStart', 'startLights', 'racing']);
    expect(current(runner)).toMatchObject({ kind: 'neutralised', start: raceAt(50), detail: { stages: [{ stage: 'deployed', at: raceAt(50) }] } });
    for (const f of after(fork, raceFrame(82), raceFrame(202))) runner.apply(f);
    const fresh = run(fork).runner;
    expect({ phases: closed(runner), open: runner.state.open.situations, flags: runner.state.history.flagPhases })
      .toEqual({ phases: closed(fresh), open: fresh.state.open.situations, flags: fresh.state.history.flagPhases });
  });
});

// Wave 5 (W5-E), the counterexample of the scheduler property (seed 1759405573), shrunk by hand. The case: after a
// rewind the game's first frames still carry the old session time, and what they record is stamped at the rewind's
// target, so the target frame and those stale frames are one moment of the race clock. A frame of that moment records
// a mini-sector crossing (in the counterexample the target frame, its crossing exactly at its own time; here the first
// stale frame, which needs no exact hit); the SC status arrives in a later stale frame and opens the neutralisation at
// the same moment. A reader from scratch counts that crossing under the neutralisation (it lies at its start); a reader
// that folded it a step before the neutralisation opened must come to the same count. The cause is the shared moment,
// not the rewind: a run that never had the discarded frames sees the same moment as a clock standing for a few frames.
describe('a neutralisation that opens at a moment an earlier frame of it already recorded', () => {
  /** Car 0 drives 40 m a frame from lights out (a mini-sector crossing on every even race frame); the SC status from race frame `scAt`. */
  const driven = (k: number, scAt: number | undefined): Beat => ({
    cars: (d) => lap(d, 0, { currentLapNum: 1, lapDistance: 10 + 40 * k }),
    ...(k === scAt && { session: status(1) }),
  });
  const timeline = (scAt?: number) => script(gridStart(60, (k) => driven(k, scAt)));

  it('a rewind whose first stale frame crosses a mini-sector and whose second brings the SC status: a reader of the crossings under the neutralisation is incremental = from scratch on every step', () => {
    // The game runs to race frame 25 and goes back to race frame 19 (frame id going back); its new timeline has the SC
    // status from race frame 21. Race frames 20 (a crossing) and 21 still carry race frame 25's session time.
    const all = timeline();
    const oldMs = all[raceFrame(25)]!.sessionTime;
    const resumed = after(timeline(21), raceFrame(20), raceFrame(26)).slice(0, 20).map((f, i) => (i < 2 ? { ...f, sessionTime: oldMs } : f));
    expectScheduledIncremental(underNeutralisation, [...all.slice(0, raceFrame(25) + 1), ...resumed]);
  });
  it('the same moment without a rewind (race frames 20 to 23 at one session time, a crossing at 22, the SC status at 23): the reader is incremental = from scratch on every step', () => {
    const frames = script(gridStart(60, (k) => ({ ...(k >= 21 && k <= 23 && { at: raceAt(20) }), ...driven(k, 23) })));
    expectScheduledIncremental(underNeutralisation, frames);
  });
});

// Review 5 R2, R3 and review 6 R6-0: the closing boundary, a boundary below the previous frame's stamp, every phase kind,
// and the condition of the rule (spec 3.1, "A boundary at a shared moment", ruling 2026-10-31 made exact after review
// 6): a boundary truncates when an earlier frame recorded an entry at or after its time, which the boundary moves into
// or out of the phase; a boundary at a shared moment with no entry there truncates nothing.
describe('a session phase boundary at a moment earlier frames share', () => {
  /** Car 0 drives 40 m a frame from lights out (a mini-sector crossing on every even race frame); `beat(k)` adds to race frame k. */
  const driving = (beat: (k: number) => Beat = () => ({})) => (k: number): Beat => ({
    cars: (d) => lap(d, 0, { currentLapNum: 1, lapDistance: 10 + 40 * k }),
    ...beat(k),
  });
  /** Race frames 21 to 23 carry race frame 20's session time: the clock stands for four frames, a crossing at 22. */
  const standing = (k: number): Beat => (k >= 21 && k <= 23 ? { at: raceAt(20) } : {});
  /** The SC status from race frame 5, green again from race frame `greenAt`. */
  const sc = (greenAt?: number) => (k: number): Beat => ({ ...(k === 5 && { session: status(1) }), ...(k === greenAt && { session: status(0) }) });
  /** The SC status from race frame `at`. */
  const scFrom = (at: number) => (k: number): Beat => (k === at ? { session: status(1) } : {});

  it('a race start on the grid’s held clock: lights out moves the start lights’ events, recorded at that time by earlier frames, into racing and is the only truncated step; the first start light finds no entry there', () => {
    const { runner, results } = run(script(gridStart(40)));
    expect(truncated(results)).toEqual([LIGHTS_OUT]);
    expect(GRID_START_TRUNCATED).toEqual([LIGHTS_OUT]);
    expect(closed(runner).map((p) => [p.kind, p.start, p.end])).toEqual([['preStart', 0, 0], ['startLights', 0, 0]]);
  });
  it('an entry an earlier grid frame recorded at the held time (an overtake at frame 5): the first start light moves it out of preStart and is truncated too', () => {
    const frames = script(gridStart(40).map((beat, k) => (k === 5 ? { ...beat, events: [ovtk(1, 0)] } : beat)));
    const { runner, results } = run(frames);
    expect(runner.state.history.events.filter((e) => e.kind === 'overtake').map((e) => e.at)).toEqual([0]);
    expect(truncated(results)).toEqual([FIRST_LIGHT, LIGHTS_OUT]);
  });
  it('a neutralisation closing on a standing clock (race frames 20 to 23 at one session time, the status green at 23): that step is truncated', () => {
    const { results } = run(script(gridStart(60, (k) => ({ ...standing(k), ...driving(sc(23))(k) }))));
    expect(truncated(results)).toEqual([...GRID_START_TRUNCATED, raceFrame(23)]);
  });
  it('a neutralisation closing on a standing clock: a reader of the crossings under the neutralisation is incremental = from scratch on every step', () => {
    expectScheduledIncremental(underNeutralisation, script(gridStart(60, (k) => ({ ...standing(k), ...driving(sc(23))(k) }))));
  });
  it('a neutralisation closing on a standing clock with no entry at that time (no car drives): no step but the grid start’s lights out is truncated', () => {
    const { runner, results } = run(script(gridStart(60, (k) => ({ ...standing(k), ...sc(23)(k) }))));
    expect(closed(runner).at(-1)).toMatchObject({ kind: 'neutralised', start: raceAt(5), end: raceAt(20) });
    expect(truncated(results)).toEqual(GRID_START_TRUNCATED);
  });
  it('a neutralisation opening on a standing clock with no entry at that time (no car drives, the SC status at 23): no step but the grid start’s lights out is truncated', () => {
    const { runner, results } = run(script(gridStart(60, (k) => ({ ...standing(k), ...scFrom(23)(k) }))));
    expect(current(runner)).toMatchObject({ kind: 'neutralised', start: raceAt(20) });
    expect(truncated(results)).toEqual(GRID_START_TRUNCATED);
  });
  it('a neutralisation opening on a standing clock after the only crossing near it, which lies before that time (the car stops at race frame 20): no step but the grid start’s lights out is truncated', () => {
    // Race frame 20 crosses at raceAt(19) + 12 ms, below the standing time raceAt(20); the car stands from there on.
    const stopped = (k: number): Beat => ({ cars: (d) => lap(d, 0, { currentLapNum: 1, lapDistance: 10 + 40 * Math.min(k, 20) }) });
    const { runner, results } = run(script(gridStart(60, (k) => ({ ...standing(k), ...stopped(k), ...scFrom(23)(k) }))));
    const crossings = runner.state.history.miniSectors.filter((m) => m.carId === 0).map((m) => m.at);
    expect(crossings.at(-1)).toBe(raceAt(19) + 12);
    expect(truncated(results)).toEqual(GRID_START_TRUNCATED);
  });
  it('a neutralisation closing after a rewind, in its second stale frame (the first crosses a mini-sector): that step is truncated after the rewind’s, and the reader is incremental = from scratch on every step', () => {
    // The game runs under the SC to race frame 25 and goes back to race frame 19 (frame id going back); its new timeline
    // is green from race frame 21. Race frames 20 (a crossing) and 21 still carry race frame 25's session time.
    const timeline = (greenAt?: number) => script(gridStart(60, driving(sc(greenAt))));
    const all = timeline();
    const oldMs = all[raceFrame(25)]!.sessionTime;
    const resumed = after(timeline(21), raceFrame(20), raceFrame(26)).slice(0, 20).map((f, i) => (i < 2 ? { ...f, sessionTime: oldMs } : f));
    const frames = [...all.slice(0, raceFrame(25) + 1), ...resumed];
    const { results } = run(frames);
    expect(truncated(results)).toEqual([...GRID_START_TRUNCATED, raceFrame(26), raceFrame(27)]);
    expect(results[raceFrame(26)]!.flashback?.targetFrameId).toBe(raceFrame(19));
    expectScheduledIncremental(underNeutralisation, frames);
  });
  it('the same rewind with no car driving (no entry at the rewind’s target time): only the rewind’s step is truncated, not the closing in its second stale frame', () => {
    const timeline = (greenAt?: number) => script(gridStart(60, sc(greenAt)));
    const all = timeline();
    const oldMs = all[raceFrame(25)]!.sessionTime;
    const resumed = after(timeline(21), raceFrame(20), raceFrame(26)).slice(0, 20).map((f, i) => (i < 2 ? { ...f, sessionTime: oldMs } : f));
    const { runner, results } = run([...all.slice(0, raceFrame(25) + 1), ...resumed]);
    expect(results[raceFrame(26)]!.flashback?.targetFrameId).toBe(raceFrame(19));
    expect(closed(runner).at(-1)).toMatchObject({ kind: 'neutralised', end: raceAt(19) });
    expect(truncated(results)).toEqual([...GRID_START_TRUNCATED, raceFrame(26)]);
  });
  it.each([
    ['closes', 'racing'],
    ['opens', 'finished'],
  ] as const)('a boundary of any phase kind: the chequered flag on a standing clock (at race frame 23) %s %s; a reader of the crossings under it is incremental = from scratch on every step', (_, kind) => {
    const frames = script(gridStart(60, (k) => ({ ...standing(k), ...driving((j) => (j === 23 ? { events: [CHQF] } : {}))(k) })));
    expect(truncated(run(frames).results)).toEqual([...GRID_START_TRUNCATED, raceFrame(23)]);
    expectScheduledIncremental(underPhase(kind), frames);
  });
  it('the chequered flag on a standing clock with no entry at that time: no step but the grid start’s lights out is truncated', () => {
    const { runner, results } = run(script(gridStart(60, (k) => ({ ...standing(k), ...(k === 23 && { events: [CHQF] }) }))));
    expect(current(runner)).toMatchObject({ kind: 'finished', start: raceAt(20) });
    expect(truncated(results)).toEqual(GRID_START_TRUNCATED);
  });

  // A boundary below the previous frame's stamp. On the grid, before the race start, a fall of the session time keeps
  // the game's lower time (spec 3.3; raceZandvoortUidReuse's first frames run at 57.2 s and fall to 0 at frame 7), so an
  // entry recorded before the fall lies above every boundary up to 57.2 s. What truncates is that entry, not the clock.
  /**
   * A race whose clock falls from 57.2 s to 0 at frame 7 and then runs; the formation status from frame `formationAt`;
   * with `overtake`, an overtake at frame 3 (57.248 s).
   */
  const fallen = (formationAt: number, overtake = false) =>
    script(beats(40, (k) => ({
      at: k < 7 ? 57_200 + k * STEP : (k - 7) * STEP,
      ...(k === formationAt && { session: status(3) }),
      ...(overtake && k === 3 && { events: [ovtk(1, 0)] }),
    })));
  const overtakesAt = (runner: SessionRunner) => runner.state.history.events.filter((e) => e.kind === 'overtake').map((e) => e.at);

  it('a formation opening on the fall’s frame, below an entry an earlier frame recorded (an overtake at 57.248 s): that step, and no other, is truncated', () => {
    const { runner, results } = run(fallen(7, true));
    expect(overtakesAt(runner)).toEqual([57_200 + 3 * STEP]);
    expect(truncated(results)).toEqual([7]);
    expect(current(runner)).toMatchObject({ kind: 'formation', start: 0 });
  });
  it('a formation opening on the fall’s frame, below the earlier frames’ stamps but with no entry there: no step is truncated', () => {
    const { runner, results } = run(fallen(7));
    expect(truncated(results)).toEqual([]);
    expect(current(runner)).toMatchObject({ kind: 'formation', start: 0 });
  });
  it('the formation opening one frame after the fall, above the previous frame’s stamp but below the overtake at 57.248 s: that step, and no other, is truncated', () => {
    const { runner, results } = run(fallen(8, true));
    expect(truncated(results)).toEqual([8]);
    expect(current(runner)).toMatchObject({ kind: 'formation', start: STEP });
  });
  it('the formation opening one frame after the fall, above the previous frame’s stamp, with no entry: no step is truncated', () => {
    const { runner, results } = run(fallen(8));
    expect(truncated(results)).toEqual([]);
    expect(current(runner)).toMatchObject({ kind: 'formation', start: STEP });
  });
});

// Review 6 R6-0: the post-session simulation opens `postSession` at the last frame's time, a moment that frame shares
// with the jump's step. Only an entry that frame (or one before it) recorded at that time is moved into the post-session.
describe('the simulated end of a session', () => {
  /** Car 0 drives 40 m a frame from lights out: its crossings lie between two frames' times, none at a frame's own. */
  const drivingCar = (k: number): Beat => ({ cars: (d) => lap(d, 0, { currentLapNum: 1 + Math.floor((10 + 40 * k) / TRACK), lapDistance: (10 + 40 * k) % TRACK }) });
  /** A race of 150 race frames whose clock jumps 6000 s ahead at race frame 100 (the simulation); `at[k]` adds to race frame k. */
  const simulated = (at: Record<number, Beat> = {}) => race(150, Object.fromEntries(Array.from({ length: 150 }, (_, k) => [k, { ...drivingCar(k), ...at[k] }])), { from: 100, ms: 6_000_000 });

  it('a race whose last frame before the jump recorded nothing at its own time: the post-session opens there, and no step but the grid start’s lights out is truncated', () => {
    const { runner, results } = simulated();
    expect(current(runner)).toMatchObject({ kind: 'postSession', start: raceAt(99) });
    const { events, miniSectors } = runner.state.history;
    expect([...events, ...miniSectors].filter((e) => e.at === raceAt(99))).toEqual([]);
    expect(miniSectors.filter((m) => m.at < raceAt(99)).length).toBeGreaterThan(0);
    expect(truncated(results)).toEqual(GRID_START_TRUNCATED);
  });
  it('an overtake on the last frame before the jump lies at the post-session’s start: the jump’s step is truncated', () => {
    const { runner, results } = simulated({ 99: { events: [ovtk(1, 0)] } });
    expect(runner.state.history.events.filter((e) => e.kind === 'overtake').map((e) => e.at)).toEqual([raceAt(99)]);
    expect(truncated(results)).toEqual([...GRID_START_TRUNCATED, raceFrame(100)]);
  });
  it('practice whose last frame before the jump recorded nothing at its own time: no step is truncated', () => {
    const { runner, results } = run(script(beats(150, (k) => ({ at: k < 100 ? k * STEP : 4_500_000 + k * STEP })), { session: { sessionType: 1 } }));
    expect(current(runner)).toMatchObject({ kind: 'postSession', start: 99 * STEP });
    expect(truncated(results)).toEqual([]);
  });
});

describe('the view a calculator receives', () => {
  it('carries the situation of the scheduler input', () => {
    const seen: unknown[] = [];
    const s = sched([quick('probe', { compute: (v) => { seen.push(v.situation); return 0; } })]);
    const situation = { session: { kind: 'neutralised', start: 1000, startLeaderLap: 3, detail: { kind: 'neutralised', car: 'VSC', stages: [] } }, paused: true } as const;
    s.run({ ...input(1000), situation });
    expect(seen).toEqual([situation]);
  });
});
