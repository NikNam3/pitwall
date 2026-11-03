// The qualifying session-phase sub-machine (contract C9, C14, C17, C36), ported from the legacy tracker's tests
// (`situations/session-phase.test.ts`, the qualifying part): time over (SEND with every car finished, SgQ) closes
// running with finished and opens the post-session on the same frame; a session joined in progress (Review Focus 2).
// The end of a session is a signal, never the final classification's arrival (user ruling, Task 9). The rows of every
// declared transition are in session-phase-qualifying.transitions.ts; the segment in
// session-phase-qualifying.segments.test.ts.
import { describe, expect, it } from 'vitest';
import { sessionPhaseQualifyingSpans } from '@pitwall/domain';
import type { SessionRunner } from '../../../src/index.ts';
import machine from '../../../src/situations/session-phase-qualifying/machine.ts';
import { situationOf } from '../../../src/situations/run.ts';
import { beats, lap, run, script, SEND, STEP, type Beat } from '../script.ts';

const MACHINE = 'session-phase-qualifying';
const closed = (r: SessionRunner) => r.state.history.spans[MACHINE] ?? [];
const kinds = (r: SessionRunner) => closed(r).map((s) => s.kind);
const current = (r: SessionRunner) => situationOf(r.state).byMachine[MACHINE]?.[0];
/** Q2 (type 6): the clock holds at 0 for 10 frames, then runs; `last` shapes the last frame. */
const q2 = (n: number, last: Beat = {}) =>
  run(script(beats(n, (k) => ({ at: k < 10 ? 0 : (k - 9) * STEP, ...(k === n - 1 && last) })), { session: { sessionType: 6 } }));
const everyCarFinished: NonNullable<Beat['cars']> = (d) => { lap(d, 0, { resultStatus: 3 }); lap(d, 1, { resultStatus: 3 }); };

describe('session-phase-qualifying: id, span declaration, inputs', () => {
  it('is the sub-machine session-phase-qualifying, its spans the session-scoped declaration in domain, for the qualifying phase only, after the weekend phase', () => {
    expect([machine.id, machine.spans, machine.appliesTo]).toEqual(['session-phase-qualifying', sessionPhaseQualifyingSpans, ['qualifying']]);
    expect(machine.spans.scope).toBe('session');
    expect(machine.inputs.upstream).toEqual(['weekend-phase']);
  });
});

describe('qualifying', () => {
  it('grid until the session clock runs, then running', () => {
    const { runner } = q2(100);
    expect(closed(runner).map((s) => [s.kind, s.start, s.end])).toEqual([['grid', 0, STEP]]);
    expect(current(runner)).toMatchObject({ kind: 'running', start: STEP });
  });
  it('time over (SgQ: SEND with every car finished) closes running with finished, then the post-session, both on the SEND frame', () => {
    const { runner } = q2(100, { events: [SEND], cars: everyCarFinished });
    expect(kinds(runner)).toEqual(['grid', 'running', 'finished']);
    const [, running, finished] = closed(runner);
    expect(finished).toMatchObject({ start: running!.end, end: running!.end, startFrame: running!.endFrame, endFrame: running!.endFrame });
    expect(current(runner)).toMatchObject({ kind: 'postSession', start: running!.end, startFrame: running!.endFrame });
  });
  it('every car finished without SEND is no time over: running goes on (no false finished, Review Focus 3)', () => {
    const { runner } = q2(100, { cars: everyCarFinished });
    expect([kinds(runner), current(runner)?.kind]).toEqual([['grid'], 'running']);
  });
  it('a final classification is no session end: running goes on until a signal ends it (user ruling, Task 9)', () => {
    const { runner } = q2(100, { cars: (d) => { d.add('finalClassification', { numCars: 2 }); } });
    expect(current(runner)?.kind).toBe('running');
  });
  it('joining a qualifying session in progress: running from the first frame, marked joined (Review Focus 2)', () => {
    const { runner } = run(script(beats(50, (k) => ({ at: 899_000 + k * STEP })), { session: { sessionType: 6, sessionDuration: 900, sessionTimeLeft: 1 } }));
    expect([kinds(runner), current(runner)]).toMatchObject([[], { id: 0, kind: 'running', start: 899_000, startFrame: 1, joinedAt: true }]);
  });
});
