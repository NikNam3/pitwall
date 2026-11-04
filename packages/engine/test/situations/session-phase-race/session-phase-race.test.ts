// The race's session-phase sub-machine (contract C9, C14, C17, C18, C20, C26, C29, C36), ported from the legacy tracker's
// tests (`situations/session-phase.test.ts`, the race parts): which signal opens and closes each span, the confirmation
// of a neutralisation (C18: an unconfirmed one closes `confirmed: false`, nothing is dropped), the session's ends
// (Review Focus 3), joins (Review Focus 2) and a flashback across a span boundary (Review Focus 1). Closed spans are
// the projection's `spans['session-phase-race']`, the open one `byMachine['session-phase-race']` of the machine's
// situation (C20). No step but a flashback rewinds: the old mechanisms that cut or moved recorded facts are gone (C24).
// The rows of every declared transition are in session-phase-race.transitions.ts; the segments in
// session-phase-race.segments.test.ts; the formation lap's hiding in ../formation.test.ts.
import { describe, expect, it } from 'vitest';
import { sessionPhaseRaceSpans } from '@pitwall/domain';
import { activeFlagPhaseOf, SessionRunner, type StepResult } from '../../../src/index.ts';
import machine from '../../../src/situations/session-phase-race/machine.ts';
import { situationOf } from '../../../src/situations/run.ts';
import type { Situation } from '../../../src/situations/situation.ts';
import { initFor } from '../../support/run.ts';
import { inputs } from '../../support/transition-table.ts';
import { all, carStatus, inPhase, RACE, timerOfCar1 } from '../session-phase/inputs.ts';
import { after, applyOne, runAll, shown } from '../../support/runner.ts';
import { expectScheduledIncremental, input, quick, sched, underNeutralisation, underPhase } from '../../support/scheduler.ts';
import {
  beats,
  CHQF,
  FIRST_LIGHT,
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
} from '../script.ts';

const MACHINE = 'session-phase-race';
const closed = (r: SessionRunner) => r.state.history.spans[MACHINE] ?? [];
const kinds = (r: SessionRunner) => closed(r).map((s) => s.kind);
const current = (r: SessionRunner) => situationOf(r.state).byMachine[MACHINE]?.[0];
/** Index of race frame k of `gridStart` among the frames; its frame number is one more (C26). */
const raceFrame = (k: number) => LIGHTS_OUT + 1 + k;
/**
 * A race of `n` frames after a grid start whose race frame k has the beat `at[k]`. With `jump`, the session time jumps
 * forward by `ms` at race frame `from` and runs on from there.
 */
const raceScript = (n: number, at: Record<number, Beat>, jump?: { from: number; ms: number }) =>
  script(gridStart(n, (k) => ({ ...(jump && k >= jump.from && { at: raceAt(k) + jump.ms }), ...at[k] })));
const race = (n: number, at: Record<number, Beat>, jump?: { from: number; ms: number }) => run(raceScript(n, at, jump));
/** The steps that rewound (`delta.rewound` set), by frame index: a flashback's only (C27, C30). */
const rewound = (results: StepResult[]) => results.flatMap((r, i) => (r.delta.rewound !== undefined ? [i] : []));

describe('session-phase-race: id, span declaration, inputs', () => {
  it('is the sub-machine session-phase-race, its spans the session-scoped declaration in domain, for the race phase only, after the weekend phase', () => {
    expect([machine.id, machine.spans, machine.appliesTo]).toEqual(['session-phase-race', sessionPhaseRaceSpans, ['race']]);
    expect(machine.spans.scope).toBe('session');
    expect(machine.inputs.upstream).toEqual(['weekend-phase', 'car-status']);
  });
});

describe('the start of a race without a formation lap', () => {
  it('the grid is grid, the first start light opens startLights, lights out opens racing; each span records the frame it opened on (C26)', () => {
    const { runner } = run(script(gridStart(20)));
    expect(closed(runner).map((s) => [s.kind, s.start, s.end, s.startFrame, s.endFrame])).toEqual([
      ['grid', 0, 0, 1, FIRST_LIGHT + 1],
      ['startLights', 0, 0, FIRST_LIGHT + 1, LIGHTS_OUT + 1],
    ]);
    expect(current(runner)).toMatchObject({ machine: MACHINE, id: 2, kind: 'racing', start: 0, startFrame: LIGHTS_OUT + 1, confirmed: true });
    expect(current(runner)).not.toHaveProperty('joinedAt');
  });
  it('a step that opens or closes a span is tagged spans:session-phase-race, and no other step is (C40)', () => {
    const { results } = run(script(gridStart(20)));
    const tagged = results.flatMap((r, i) => (r.changed.has(`spans:${MACHINE}` as never) ? [i] : []));
    expect(tagged).toEqual([0, FIRST_LIGHT, LIGHTS_OUT]);
  });
  it('a lights out before any start light is no race start', () => {
    const { runner } = run(script(beats(30, (k) => ({ at: 0, ...(k === 5 && { events: [LGOT] }) }))));
    expect([kinds(runner), current(runner)?.kind]).toEqual([[], 'grid']);
  });
  it('lights out rewinds nothing: no step of a grid start sets delta.rewound, and no reader restarts (C29, C30)', () => {
    const { results } = run(script(gridStart(40)));
    expect(rewound(results)).toEqual([]);
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
    expect(closed(runner).slice(2)).toMatchObject([
      { kind: 'racing', start: 0, end: raceAt(50), confirmed: true },
      {
        kind: 'neutralised', start: raceAt(50), end: raceAt(200), confirmed: true, startFrame: raceFrame(50) + 1, endFrame: raceFrame(200) + 1,
        detail: { car: 'SC', stages: [
          { stage: 'deployed', at: raceAt(50) }, { stage: 'returning', at: raceAt(100) },
          { stage: 'returned', at: raceAt(150) }, { stage: 'resume', at: raceAt(200) }] },
      },
    ]);
    expect(current(runner)).toMatchObject({ kind: 'racing', start: raceAt(200), startFrame: raceFrame(200) + 1 });
  });
  it('a VSC records deployed, returning and resume', () => {
    const { runner } = race(200, { 50: { events: [scar(2, 0)] }, 60: { session: status(2) }, 100: { events: [scar(2, 1)] },
      150: { events: [scar(2, 3)] }, 160: { session: status(0) } });
    expect(closed(runner).at(-1)).toMatchObject({ kind: 'neutralised', start: raceAt(50), end: raceAt(150), confirmed: true,
      detail: { car: 'VSC', stages: [{ stage: 'deployed', at: raceAt(50) }, { stage: 'returning', at: raceAt(100) }, { stage: 'resume', at: raceAt(150) }] } });
  });
  it('the safety car status going green closes it when it comes before the resume; the late resume changes nothing', () => {
    const { runner } = race(200, { 50: { events: [scar(1, 0)] }, 60: { session: status(1) }, 150: { session: status(0) },
      160: { events: [scar(1, 3)] } });
    expect(closed(runner).filter((s) => s.kind === 'neutralised').map((s) => [s.start, s.end])).toEqual([[raceAt(50), raceAt(150)]]);
    expect(current(runner)).toMatchObject({ kind: 'racing', start: raceAt(150) });
  });
  it('a status change to SC without a deployment event opens it at that frame, confirmed', () => {
    const { runner } = race(100, { 50: { session: status(1) } });
    expect(current(runner)).toMatchObject({ kind: 'neutralised', start: raceAt(50), confirmed: true, detail: { car: 'SC', stages: [] } });
  });
  it('the deployment opens the span at once, unconfirmed while it waits: one Session packet without the SC status keeps it open (C18)', () => {
    const { runner } = race(70, { 50: { events: [scar(1, 0)] }, 60: { session: status(0) } });
    expect(current(runner)).toMatchObject({ kind: 'neutralised', start: raceAt(50), confirmed: false, detail: { car: 'SC', stages: [{ stage: 'deployed', at: raceAt(50) }] } });
  });
  // The confirmation window: the status must show the deployment within 3 s of its SCAR (recorded lags 0.5-1.31 s, inventory 1.4).
  const WITHIN = Math.floor(2_900 / STEP);
  /** The first race frame more than 3 s after a deployment at race frame 50: the deployment expires there. */
  const EXPIRY = 50 + Math.floor(3_000 / STEP) + 1;
  it('a deployment the status confirms within 3 s stands, after packets that still show green: the open span turns confirmed', () => {
    const { runner } = race(50 + WITHIN + 10, { 50: { events: [scar(1, 0)] }, 60: { session: status(0) }, 90: { session: status(0) }, [50 + WITHIN]: { session: status(1) } });
    expect(current(runner)).toMatchObject({ kind: 'neutralised', start: raceAt(50), confirmed: true, detail: { car: 'SC' } });
  });
  it('an SCAR never confirmed within 3 s closes as `neutralised` with `confirmed: false`, and racing opens again (C18)', () => {
    const { runner } = race(EXPIRY + 10, { 50: { events: [scar(1, 0)] }, 60: { session: status(0) }, 90: { session: status(0) } });
    expect(closed(runner).slice(2)).toMatchObject([
      { kind: 'racing', start: 0, end: raceAt(50), confirmed: true },
      { kind: 'neutralised', start: raceAt(50), end: raceAt(EXPIRY), confirmed: false, startFrame: raceFrame(50) + 1, endFrame: raceFrame(EXPIRY) + 1,
        detail: { car: 'SC', stages: [{ stage: 'deployed', at: raceAt(50) }] } },
    ]);
    expect(current(runner)).toMatchObject({ kind: 'racing', start: raceAt(EXPIRY), startFrame: raceFrame(EXPIRY) + 1, confirmed: true });
  });
  it('a deployment never confirmed leaves no flag phase', () => {
    const { runner } = race(EXPIRY + 10, { 50: { events: [scar(1, 0)] } });
    expect([runner.state.history.flagPhases, activeFlagPhaseOf(runner.state)]).toEqual([[], undefined]);
  });
  it('an SC deployed while a VSC is on closes the VSC and opens the SC at the same time', () => {
    const { runner } = race(150, { 50: { events: [scar(2, 0)] }, 60: { session: status(2) }, 100: { events: [scar(1, 0)] },
      110: { session: status(1) } });
    expect(closed(runner).at(-1)).toMatchObject({ kind: 'neutralised', start: raceAt(50), end: raceAt(100), confirmed: true,
      detail: { car: 'VSC', stages: [{ stage: 'deployed', at: raceAt(50) }] } });
    expect(current(runner)).toMatchObject({ kind: 'neutralised', start: raceAt(100), confirmed: true,
      detail: { car: 'SC', stages: [{ stage: 'deployed', at: raceAt(100) }] } });
  });
  it('a resume sent twice (types 1 and 0) closes the SC once; a later type-0 resume changes nothing', () => {
    const { runner } = race(200, { 50: { events: [scar(1, 0)] }, 60: { session: status(1) }, 100: { events: [scar(1, 3), scar(0, 3)] },
      110: { session: status(0) }, 130: { events: [scar(0, 3)] } });
    expect(closed(runner).filter((s) => s.kind === 'neutralised')).toMatchObject([{ start: raceAt(50), end: raceAt(100),
      detail: { stages: [{ stage: 'deployed' }, { stage: 'resume', at: raceAt(100) }] } }]);
    expect(current(runner)).toMatchObject({ kind: 'racing', start: raceAt(100) });
  });
  it('the flag phases readers still get come from the neutralised span, with the leader laps of the frames it opened and closed on', () => {
    const { runner } = race(200, { 50: { events: [scar(1, 0)] }, 60: { session: status(1) }, 120: { cars: (d) => lap(d, 0, { currentLapNum: 2, lastLapTimeInMs: 100_000 }) },
      150: { events: [scar(1, 3)] }, 160: { session: status(0) } });
    expect(runner.state.history.flagPhases).toMatchObject([{ kind: 'SC', start: raceAt(50), end: raceAt(150), startLeaderLap: 1, endLeaderLap: 2,
      scPhases: [{ phase: 'deployed', at: raceAt(50) }, { phase: 'resume', at: raceAt(150) }] }]);
  });
});

describe('a neutralisation never confirmed is a closed span, not a discarded timeline (C18, C24)', () => {
  /** The first race frame more than 3 s after a deployment at race frame 50: the deployment expires there. */
  const EXPIRY = 50 + Math.floor(3_000 / STEP) + 1;
  /** Car 0 drives 40 m a frame from lights out, so mini-sector crossings come while the deployment waits. */
  const driving = (k: number): Beat => ({
    cars: (d) => lap(d, 0, { currentLapNum: 1 + Math.floor((10 + 40 * k) / TRACK), lapDistance: (10 + 40 * k) % TRACK }),
  });

  it.each([
    ['its 3 s expiry', () => race(EXPIRY + 20, { 50: { events: [scar(1, 0)] } })],
    ['SEND', () => race(200, { 190: { events: [scar(1, 0)] }, 199: { events: [SEND] } })],
    ['the simulated end', () => race(150, { 90: { events: [scar(2, 0)] } }, { from: 100, ms: 6_000_000 })],
  ])('a deployment closed unconfirmed at %s rewinds no step', (_, scripted) => {
    const { runner, results } = scripted();
    expect(rewound(results)).toEqual([]);
    expect(closed(runner).filter((s) => s.kind === 'neutralised').map((s) => s.confirmed)).toEqual([false]);
  });
  it('a flashback from after the expiry to the wait before it equals a run that never saw the undone frames', () => {
    const scarAt50 = { 50: { events: [scar(1, 0)] } };
    const first = raceScript(EXPIRY + 40, scarAt50);
    const fork = raceScript(EXPIRY + 40, { ...scarAt50, [EXPIRY - 20]: { events: [ovtk(1, 0)] } });
    const { runner } = run(first.slice(0, raceFrame(EXPIRY + 20) + 1));
    const results = runAll(runner, after(fork, raceFrame(EXPIRY - 29), raceFrame(EXPIRY + 21)));
    expect(results[0]!.flashback?.targetFrameId).toBe(raceFrame(EXPIRY - 30));
    expect(shown(runner.state)).toEqual(shown(run(fork).runner.state));
  });
  it.each([
    ['its 3 s expiry', EXPIRY + 40, undefined],
    ['the simulated end', 150, { from: 100, ms: 6_000_000 }],
  ] as const)('a reader that folds what happened under a neutralisation equals a fresh init on every step, across a deployment closed unconfirmed at %s', (_, n, jump) => {
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
      { kind: 'suspended', start: raceAt(50), end: raceAt(100), detail: { restart: { known: true, value: 'standing' } } },
      { kind: 'startLights', start: raceAt(100), end: raceAt(160) },
    ]);
    expect(current(runner)).toMatchObject({ kind: 'racing', start: raceAt(160) });
    expect(results[raceFrame(160)]!.delta.rewound).toBeUndefined();
    expect(runner.state.history.flagPhases).toMatchObject([{ kind: 'red', start: raceAt(50), end: raceAt(100) }]);
  });
  it('while it lasts the suspension does not know its restart', () => {
    const { runner } = race(80, { 50: { events: [RDFL] } });
    expect(current(runner)).toMatchObject({ kind: 'suspended', start: raceAt(50), detail: { restart: { known: false } } });
  });
  it('a rolling restart behind the safety car closes the suspension and opens the SC', () => {
    const { runner } = race(150, { 50: { events: [RDFL] }, 100: { session: status(1) } });
    expect(closed(runner).at(-1)).toMatchObject({ kind: 'suspended', start: raceAt(50), end: raceAt(100), detail: { restart: { known: true, value: 'rolling' } } });
    expect(current(runner)).toMatchObject({ kind: 'neutralised', start: raceAt(100), detail: { car: 'SC' } });
  });
});

// The session's end in its shapes (inventory 1.6-1.7, Review Focus 3): SEND, the clock's simulated end (C36); never the
// arrival of the final classification (user ruling, Task 9).
describe('the end of a race', () => {
  it('the race winner opens finished, the chequered flag after it changes nothing, SEND opens the post-session (MxR, MiR)', () => {
    const { runner } = race(200, { 100: { events: [rcwn(0)] }, 150: { events: [CHQF] }, 199: { events: [SEND] } });
    expect(closed(runner).slice(2).map((s) => [s.kind, s.start, s.end])).toEqual([['racing', 0, raceAt(100)], ['finished', raceAt(100), raceAt(199)]]);
    expect(current(runner)).toMatchObject({ kind: 'postSession', start: raceAt(199) });
  });
  it('a chequered flag without a race winner opens finished too', () => {
    const { runner } = race(200, { 150: { events: [CHQF] } });
    expect(current(runner)).toMatchObject({ kind: 'finished', start: raceAt(150) });
  });
  it('a race left mid-lap (SgR, SgW): the last frame sets every car finished and SEND follows; that is a session end, not a finish', () => {
    const { runner } = race(200, { 199: { events: [SEND], cars: (d) => { lap(d, 0, { resultStatus: 3 }); lap(d, 1, { resultStatus: 3 }); } } });
    expect(kinds(runner)).toEqual(['grid', 'startLights', 'racing']);
    expect(current(runner)?.kind).toBe('postSession');
  });
  it('online, without SEND (ZvR, ZvR2: the shape with the UID-0 classification): the post-session opens on the simulated end, at the last frame before the jump', () => {
    const { runner } = race(150, {}, { from: 100, ms: 6_000_000 });
    expect(kinds(runner)).toEqual(['grid', 'startLights', 'racing']);
    expect(current(runner)).toMatchObject({ kind: 'postSession', start: raceAt(99), startFrame: raceFrame(100) + 1 });
  });
  it('a neutralisation announced just before the simulated end is never confirmed: it closes confirmed false and the post-session opens', () => {
    const { runner } = race(150, { 90: { events: [scar(2, 0)] } }, { from: 100, ms: 6_000_000 });
    expect(closed(runner).slice(2)).toMatchObject([
      { kind: 'racing', end: raceAt(90) },
      { kind: 'neutralised', start: raceAt(90), end: raceAt(99), confirmed: false, detail: { car: 'VSC' } },
    ]);
    expect(current(runner)?.kind).toBe('postSession');
  });
  it.each([
    ['60 s', 60_000, 'racing'],
    ['60.001 s', 60_001, 'postSession'],
  ] as const)('a jump forward of %s leaves the phase %s', (_, jumpMs, kind) => {
    const { runner } = race(150, {}, { from: 100, ms: jumpMs - STEP });
    expect(current(runner)?.kind).toBe(kind);
  });
  it('a final classification is no session end: the race goes on racing until a signal ends it (user ruling, Task 9)', () => {
    const { runner } = race(150, { 100: { cars: (d) => { d.add('finalClassification', { numCars: 2 }); } } });
    expect([kinds(runner), current(runner)?.kind]).toEqual([['grid', 'startLights'], 'racing']);
  });
  it('the simulated end of a race whose last frame before the jump recorded nothing rewinds no step; the post-session opens there', () => {
    const drivingCar = (k: number): Beat => ({ cars: (d) => lap(d, 0, { currentLapNum: 1 + Math.floor((10 + 40 * k) / TRACK), lapDistance: (10 + 40 * k) % TRACK }) });
    const { runner, results } = race(150, Object.fromEntries(Array.from({ length: 150 }, (_, k) => [k, { ...drivingCar(k), ...(k === 99 && { events: [ovtk(1, 0)] }) }])), { from: 100, ms: 6_000_000 });
    expect(current(runner)).toMatchObject({ kind: 'postSession', start: raceAt(99) });
    expect(rewound(results)).toEqual([]);
  });
});

describe('the cars in the session are car-status’s (C43)', () => {
  /** The span the machine opens on a race's first frame with `edit`. */
  const joined = (...edits: Parameters<typeof all>) => {
    const [first] = inputs().frame(all(inPhase(RACE), ...edits)).build();
    return machine.openSpans(machine.step(machine.init(), first!).open)[0];
  };
  it('a race joined with car 1’s lap timer past 1000 ms is under way while car 1 competes', () => {
    expect(joined(timerOfCar1(30_000))).toMatchObject({ kind: 'racing', joinedAt: true });
  });
  it('a slot car-status holds absent does not put the race under way: its lap timer is no car’s of the session (grid)', () => {
    expect(joined(timerOfCar1(30_000), carStatus(1, 'absent'))).toMatchObject({ kind: 'grid' });
  });
});

describe('a bridge that joins mid-race (Review Focus 2)', () => {
  it('joining a race mid-lap: racing from the first frame, marked joined, and no transition after it', () => {
    const { runner } = run(script(beats(100, (k) => ({
      at: 200_000 + k * STEP,
      cars: (d) => { lap(d, 0, { currentLapNum: 3, lapDistance: 1200 + 40 * k, currentLapTimeInMs: 30_000 + k * STEP }); lap(d, 1, { currentLapNum: 3, lapDistance: 1100 + 40 * k }); },
    }))));
    expect(kinds(runner)).toEqual([]);
    expect(current(runner)).toMatchObject({ id: 0, kind: 'racing', start: 200_000, startFrame: 1, joinedAt: true });
  });
  it('joining under the safety car: neutralised from the first frame, marked joined and confirmed; its resume opens racing', () => {
    const { runner } = run(script(beats(100, (k) => ({
      at: 300_000 + k * STEP,
      ...(k === 0 && { session: status(1), cars: (d) => { lap(d, 0, { currentLapNum: 5, lapDistance: 900 }); lap(d, 1, { currentLapNum: 5, lapDistance: 800 }); } }),
      ...(k === 50 && { events: [scar(1, 3)] }),
    }))));
    expect(closed(runner)).toMatchObject([{ kind: 'neutralised', start: 300_000, joinedAt: true, confirmed: true, detail: { car: 'SC' } }]);
    expect(current(runner)).toMatchObject({ kind: 'racing', start: 300_000 + 50 * STEP });
    expect(current(runner)).not.toHaveProperty('joinedAt');
  });
  // Review 2 B1: a bridge started in the start lights' hold (after the fifth light) or within 1 s after lights out sees
  // no start light and no lap timer past 1 s, so it opens the grid; the race is under way once a timer passes 1 s. That
  // racing span opens after the session's first frame, so it is no join (the harness's rule, C85).
  /** Both cars' lap timers read `ms`. */
  const timers = (ms: number): NonNullable<Beat['cars']> => (d) => { lap(d, 0, { currentLapTimeInMs: ms }); lap(d, 1, { currentLapTimeInMs: ms }); };
  it('joining after the fifth start light: racing opens on the first frame a lap timer runs past 1 s; the race winner finishes it', () => {
    const { runner } = run(script([
      ...beats(30, (k) => ({ at: 0, ...(k === 29 && { events: [LGOT] }) })),
      ...beats(200, (k) => ({ at: (k + 1) * STEP, cars: timers((k + 1) * STEP), ...(k === 150 && { events: [rcwn(0)] }) })),
    ]));
    expect(closed(runner)).toMatchObject([
      { kind: 'grid', start: 0, end: 1008 },
      { kind: 'racing', start: 1008, end: 151 * STEP },
    ]);
    expect(current(runner)).toMatchObject({ kind: 'finished', start: 151 * STEP });
  });
  it('joining within 1 s after lights out: racing opens once a lap timer runs past 1 s; the chequered flag finishes it', () => {
    const { runner } = run(script(beats(150, (k) => ({ at: 500 + k * STEP, cars: timers(500 + k * STEP), ...(k === 100 && { events: [CHQF] }) }))));
    expect(closed(runner)).toMatchObject([
      { kind: 'grid', start: 500, end: 500 + 32 * STEP },
      { kind: 'racing', start: 500 + 32 * STEP, end: 500 + 100 * STEP },
    ]);
    expect(current(runner)).toMatchObject({ kind: 'finished', start: 500 + 100 * STEP });
  });
  it('on the grid a lap timer below 1 s (a car standing past the line) is no race under way: the grid waits for the start lights', () => {
    const { runner } = run(script(gridStart(20, () => ({})).map((beat, k) => (k <= LIGHTS_OUT ? { ...beat, cars: (d) => lap(d, 1, { currentLapTimeInMs: 510 }) } : beat))));
    expect(kinds(runner)).toEqual(['grid', 'startLights']);
  });
  it('a race joined on the frame of its first start light, the clock held: the grid opens and closes on the first frame, startLights opens there', () => {
    const { runner, results } = run(script(beats(30, (k) => ({ at: 0, ...(k === 0 && { events: [stlg(1)] }) }))));
    expect([closed(runner).map((s) => [s.kind, s.start, s.end, s.startFrame, s.endFrame]), current(runner)?.kind]).toEqual([[['grid', 0, 0, 1, 1]], 'startLights']);
    expect(results[0]!.changed.has(`spans:${MACHINE}` as never)).toBe(true);
    expect(rewound(results)).toEqual([]);
  });
  it('while the weekend phase is pending no session-phase span opens; the first frame it is decided opens the current phase (C14)', () => {
    const frames = script(beats(40, (k) => ({ at: 200_000 + k * STEP, ...(k === 20 && { session: { numSessionsInWeekend: 1, weekendStructure: [15] } }),
      cars: (d) => lap(d, 0, { currentLapNum: 3, currentLapTimeInMs: 30_000 + k * STEP }) })), { session: { numSessionsInWeekend: 0, weekendStructure: [] } });
    // The runner keeps one state for every result: the open spans are copied on each step, in its callback.
    const runner = new SessionRunner(initFor(frames));
    const steps: Array<{ frameNumber: number; weekend: unknown[]; phase: unknown[] }> = [];
    for (const f of frames) {
      runner.apply(f, (r) => {
        const { byMachine } = situationOf(r.state);
        steps.push(structuredClone({ frameNumber: r.state.frameNumber, weekend: [...(byMachine['weekend-phase'] ?? [])], phase: [...(byMachine[MACHINE] ?? [])] }));
      });
    }
    const decided = steps.find((s) => s.weekend.length > 0)!;
    expect(decided.frameNumber).toBeGreaterThan(1);
    expect(steps.filter((s) => s.frameNumber < decided.frameNumber).flatMap((s) => s.phase)).toEqual([]);
    expect(decided.weekend).toMatchObject([{ kind: 'race', startFrame: decided.frameNumber }]);
    expect(decided.phase).toMatchObject([{ id: 0, kind: 'racing', startFrame: decided.frameNumber, joinedAt: true }]);
  });
});

describe('a flashback across a span boundary (Review Focus 1)', () => {
  // The SC is deployed at race frame 50 and resumes at 150; at 200 the game goes back to race frame 80, inside the SC,
  // and the fork resumes at 180 instead.
  const sc = (resumeAt: number) => script(gridStart(300, (k) => ({
    50: { events: [scar(1, 0)] }, 60: { session: status(1) }, [resumeAt]: { events: [scar(1, 3)] }, [resumeAt + 10]: { session: status(0) },
  } as Record<number, Beat>)[k] ?? {}));

  it('the spans after the target are voided, the open span is the target’s, and every reader equals a run that never saw the undone frames (C27, C33)', () => {
    const first = sc(150).slice(0, raceFrame(200) + 1);
    const fork = sc(180);
    const { runner } = run(first);
    const rewind = applyOne(runner, after(fork, raceFrame(81), raceFrame(201))[0]!);
    expect(rewind.flashback?.targetFrameId).toBe(raceFrame(80));
    expect(kinds(runner)).toEqual(['grid', 'startLights', 'racing']);
    expect(current(runner)).toMatchObject({ id: 3, kind: 'neutralised', start: raceAt(50), confirmed: true, detail: { stages: [{ stage: 'deployed', at: raceAt(50) }] } });
    for (const f of after(fork, raceFrame(82), raceFrame(202))) runner.apply(f);
    const fresh = run(fork).runner;
    expect({ spans: closed(runner), open: situationOf(runner.state).byMachine[MACHINE], flags: runner.state.history.flagPhases })
      .toEqual({ spans: closed(fresh), open: situationOf(fresh.state).byMachine[MACHINE], flags: fresh.state.history.flagPhases });
  });
});

// Wave 5 (W5-E), the counterexample of the scheduler property (seed 1759405573), shrunk by hand: after a rewind the
// game's first frames still carry the old session time, so the target frame and those stale frames are one moment of
// the race clock; a frame of that moment records a crossing and a later one brings the SC status. Membership is by frame
// number (C26), so a reader that folded the crossing before the neutralisation opened comes to the same count as one
// from scratch.
describe('a neutralisation that opens at a moment an earlier frame of it already recorded', () => {
  /** Car 0 drives 40 m a frame from lights out (a mini-sector crossing on every even race frame); the SC status from race frame `scAt`. */
  const driven = (k: number, scAt: number | undefined): Beat => ({
    cars: (d) => lap(d, 0, { currentLapNum: 1, lapDistance: 10 + 40 * k }),
    ...(k === scAt && { session: status(1) }),
  });
  const timeline = (scAt?: number) => script(gridStart(60, (k) => driven(k, scAt)));

  it('a rewind whose first stale frame crosses a mini-sector and whose second brings the SC status: a reader of the crossings under the neutralisation is incremental = from scratch on every step', () => {
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

// Review 5 R2, R3 and review 6 R6-0, ported: a span boundary at a moment earlier frames share (a standing clock) moves
// nothing, since membership is by frame number (C26); no step rewinds, and a reader under the span is incremental = from
// scratch.
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

  it('a neutralisation closing on a standing clock rewinds nothing, and a reader of the crossings under it is incremental = from scratch on every step', () => {
    const frames = script(gridStart(60, (k) => ({ ...standing(k), ...driving(sc(23))(k) })));
    const { runner, results } = run(frames);
    expect(closed(runner).at(-1)).toMatchObject({ kind: 'neutralised', start: raceAt(5), end: raceAt(20), endFrame: raceFrame(23) + 1 });
    expect(rewound(results)).toEqual([]);
    expectScheduledIncremental(underNeutralisation, frames);
  });
  it('a neutralisation closing after a rewind, in its second stale frame (the first crosses a mini-sector): only the rewind’s step rewinds, and the reader is incremental = from scratch on every step', () => {
    const timeline = (greenAt?: number) => script(gridStart(60, driving(sc(greenAt))));
    const all = timeline();
    const oldMs = all[raceFrame(25)]!.sessionTime;
    const resumed = after(timeline(21), raceFrame(20), raceFrame(26)).slice(0, 20).map((f, i) => (i < 2 ? { ...f, sessionTime: oldMs } : f));
    const frames = [...all.slice(0, raceFrame(25) + 1), ...resumed];
    const { results } = run(frames);
    expect(rewound(results)).toEqual([raceFrame(26)]);
    expect(results[raceFrame(26)]!.flashback?.targetFrameId).toBe(raceFrame(19));
    expectScheduledIncremental(underNeutralisation, frames);
  });
  it.each([
    ['closes', 'racing'],
    ['opens', 'finished'],
  ] as const)('a boundary of any span kind: the chequered flag on a standing clock (at race frame 23) %s %s; a reader of the crossings under it is incremental = from scratch on every step', (_, kind) => {
    const frames = script(gridStart(60, (k) => ({ ...standing(k), ...driving((j) => (j === 23 ? { events: [CHQF] } : {}))(k) })));
    expect(rewound(run(frames).results)).toEqual([]);
    expectScheduledIncremental(underPhase(kind), frames);
  });

  // A pre-start fall (raceZandvoortUidReuse's first frames run at 57.2 s and fall to 0 at frame 7) is carried over like
  // any fall that is no flashback (C36): the race clock runs on from 57.296 s.
  /** A race whose clock falls from 57.2 s to 0 at frame 7 and then runs; the formation status from frame `formationAt`. */
  const fallen = (formationAt: number) =>
    script(beats(40, (k) => ({
      at: k < 7 ? 57_200 + k * STEP : (k - 7) * STEP,
      ...(k === formationAt && { session: status(3) }),
      ...(k === 3 && { events: [ovtk(1, 0)] }),
    })));
  /** Frame k's race-clock time after the fall: the session time plus the fall's size. */
  const continued = (k: number) => 57_200 + 6 * STEP + (k - 7) * STEP;
  it.each([7, 8])('a formation opening on frame %i (the fall’s, or the one after) opens on the race clock above the grid, and no step rewinds', (at) => {
    const { runner, results } = run(fallen(at));
    expect(rewound(results)).toEqual([]);
    expect(current(runner)).toMatchObject({ kind: 'formation', start: continued(at), startFrame: at + 1 });
    expect(closed(runner)).toMatchObject([{ kind: 'grid', start: 57_200, end: continued(at) }]);
  });
});

describe('the view a calculator receives', () => {
  it('carries the situation of the scheduler input: the open spans, the clock\'s pause and the session phase among them (C20)', () => {
    const seen: unknown[] = [];
    const s = sched([quick('probe', { compute: (v) => { seen.push(v.situation); return 0; } })]);
    const paused = { machine: 'clock', id: 1, kind: 'paused', start: 900, confirmed: true, detail: { source: 'online' }, startFrame: 50 };
    const racing = { machine: 'session-phase-race', id: 2, kind: 'racing', start: 0, confirmed: true, detail: undefined, startFrame: 1 };
    const situation: Situation = { weekendPhase: { kind: 'race', format: 'grandPrix' }, byMachine: { clock: [paused], 'session-phase-race': [racing] } };
    s.run({ ...input(1000), situation });
    expect(seen).toEqual([situation]);
  });
});
