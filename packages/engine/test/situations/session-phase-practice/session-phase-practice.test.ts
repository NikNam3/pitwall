// The practice session-phase sub-machine (contract C9, C14, C17, C36), ported from the legacy tracker's tests
// (`situations/session-phase.test.ts`, the practice and time-trial parts): the grid until the session clock runs, then
// running; a session joined in progress (Review Focus 2); its ends (Review Focus 3): SEND left from the menu, the
// clock's simulated end. A time trial runs no session-phase machine (weekend phase `none`, C14). The rows of every
// declared transition are in session-phase-practice.transitions.ts.
import { describe, expect, it } from 'vitest';
import { sessionPhasePracticeSpans } from '@pitwall/domain';
import type { SessionRunner } from '../../../src/index.ts';
import machine from '../../../src/situations/session-phase-practice/machine.ts';
import { situationOf } from '../../../src/situations/run.ts';
import { beats, lap, run, script, SEND, STEP, type Beat } from '../script.ts';
import { inputs, type InputEdit } from '../../support/transition-table.ts';
import { all, carStatus, clockRuns, events, inPhase, PRACTICE, SEND as SEND_EVENT } from '../session-phase/inputs.ts';

const MACHINE = 'session-phase-practice';
const closed = (r: SessionRunner) => r.state.history.spans[MACHINE] ?? [];
const kinds = (r: SessionRunner) => closed(r).map((s) => s.kind);
const current = (r: SessionRunner) => situationOf(r.state).byMachine[MACHINE]?.[0];
/** A session of `sessionType`: the clock holds at 0 for 10 frames, then runs; `last` shapes the last frame. */
const session = (sessionType: number, n: number, last: Beat = {}) =>
  run(script(beats(n, (k) => ({ at: k < 10 ? 0 : (k - 9) * STEP, ...(k === n - 1 && last) })), { session: { sessionType } }));

describe('session-phase-practice: id, span declaration, inputs', () => {
  it('is the sub-machine session-phase-practice, its spans the session-scoped declaration in domain, for the practice phase only, after the weekend phase', () => {
    expect([machine.id, machine.spans, machine.appliesTo]).toEqual(['session-phase-practice', sessionPhasePracticeSpans, ['practice']]);
    expect(machine.spans.scope).toBe('session');
    expect(machine.inputs.upstream).toEqual(['weekend-phase', 'car-status']);
  });
});

describe('practice: the cars in the session are car-status’s (C43)', () => {
  /** The kinds of the spans the machine closes on a running practice's SEND frame, which also applies `last`. */
  const closedAtSend = (last: InputEdit) => {
    const built = inputs().frames(3, all(inPhase(PRACTICE), clockRuns)).frame(all(inPhase(PRACTICE), clockRuns, last, events(SEND_EVENT))).build();
    const open = built.slice(0, -1).reduce((o, input) => machine.step(o, input).open, machine.init());
    return machine.step(open, built.at(-1)!).closed.map((s) => s.kind);
  };
  /** Car `car` finished (its result status, a signal). */
  const finished = (car: number): InputEdit => (i) => {
    i.signals.cars[car]!.resultStatus = 'finished';
  };
  it('time over: every car whose status is not absent finished; a slot car-status holds absent does not hold back finished', () => {
    expect(closedAtSend(all(finished(0), carStatus(1, 'absent')))).toEqual(['running', 'finished']);
  });
  it('time over: a car still competing that has not finished holds back finished', () => {
    expect(closedAtSend(finished(0))).toEqual(['running']);
  });
});

describe('practice', () => {
  it('grid until the session clock runs, then running; no formation or start lights', () => {
    const { runner } = session(1, 100);
    expect(closed(runner).map((s) => [s.kind, s.start, s.end, s.startFrame, s.endFrame])).toEqual([['grid', 0, STEP, 1, 11]]);
    expect(current(runner)).toMatchObject({ id: 1, kind: 'running', start: STEP, startFrame: 11, confirmed: true });
  });
  it('left from the menu (MiP: the player retired, the others set finished, then SEND) has no finished span', () => {
    const { runner } = session(1, 100, { events: [SEND], cars: (d) => { lap(d, 0, { resultStatus: 7 }); lap(d, 1, { resultStatus: 3 }); } });
    expect(kinds(runner)).toEqual(['grid', 'running']);
    expect(current(runner)?.kind).toBe('postSession');
  });
  it('online, without SEND (ZvP, ZvP2): the simulated end opens the post-session at the last frame before the jump', () => {
    const { runner } = run(script(beats(150, (k) => ({ at: k < 100 ? k * STEP : 4_500_000 + k * STEP })), { session: { sessionType: 1 } }));
    expect(current(runner)).toMatchObject({ kind: 'postSession', start: 99 * STEP, startFrame: 101 });
  });
  it('joining a practice mid-session (MiP at 121.6 s): running from the first frame, marked joined (Review Focus 2)', () => {
    const { runner } = run(script(beats(100, (k) => ({ at: 121_552 + k * STEP })), { session: { sessionType: 1, sessionDuration: 3600, sessionTimeLeft: 3478 } }));
    expect(kinds(runner)).toEqual([]);
    expect(current(runner)).toMatchObject({ id: 0, kind: 'running', start: 121_552, startFrame: 1, joinedAt: true });
  });
});

describe('time trial', () => {
  it('runs no session-phase sub-machine: the weekend phase is none (C14)', () => {
    const { runner } = session(18, 100);
    const { byMachine, weekendPhase } = situationOf(runner.state);
    expect(weekendPhase).toEqual({ kind: 'none' });
    expect(Object.entries(byMachine).flatMap(([m, spans]) => (m.startsWith('session-phase') ? spans : []))).toEqual([]);
    expect(Object.keys(runner.state.history.spans).filter((m) => m.startsWith('session-phase'))).toEqual([]);
  });
});
