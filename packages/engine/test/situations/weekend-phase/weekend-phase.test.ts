// The weekend-phase sub-machine (contract C14): the phase and format each session type decides, pending until the
// weekend structure arrives, fixed for the session; and the committed segment race-sprint-start, whose first Session
// packet has an empty structure and a later one [15, 16] (a sprint). The transition rows are in weekend-phase.transitions.ts.
import { beforeAll, describe, expect, it } from 'vitest';
import { feedId, type OpenSpan, type WeekendPhase } from '@pitwall/domain';
import { SessionRunner, SessionTracker, type Frame } from '../../../src/index.ts';
import type { MachineInput } from '../../../src/situations/machine.ts';
import { situationOf } from '../../../src/situations/run.ts';
import machine from '../../../src/situations/weekend-phase/machine.ts';
import { segmentPackets } from '../../../../../test-support/segments.ts';
import { inputs } from '../../support/transition-table.ts';
import { PHASE_CASES, UNKNOWN_TYPES } from './weekend-phase.transitions.ts';

const session = (sessionType: number, structure: number[]) => (i: MachineInput): void => {
  i.signals.session.sessionType = sessionType;
  i.signals.session.weekendStructure = structure;
};

/** The phase a span stands for: its kind with its detail (`format`, `segment`). */
const phaseOf = (span: OpenSpan | undefined): WeekendPhase | undefined =>
  span === undefined ? undefined : ({ kind: span.kind, ...(span.detail as object) } as WeekendPhase);

/** Steps the machine through the frames; the open spans after each. */
const run = (builder: ReturnType<typeof inputs>): Array<OpenSpan | undefined> => {
  let open = machine.init();
  return builder.build().map((input) => {
    open = machine.step(open, input).open;
    return machine.openSpans(open)[0];
  });
};

describe('weekend-phase: id, scope, applies to', () => {
  it('is the session-scope sub-machine weekend-phase and applies to every phase', () => {
    expect([machine.id, machine.scope, machine.appliesTo]).toEqual(['weekend-phase', 'session', 'all']);
  });
});

describe('weekend-phase: the phase and format of each session type', () => {
  for (const c of PHASE_CASES) {
    it(`${c.name}`, () => {
      const spans = run(inputs().frames(3, session(c.sessionType, [])).frames(2, session(c.sessionType, c.structure)));
      expect(phaseOf(spans.at(-1))).toEqual(c.phase);
    });
  }
  for (const type of UNKNOWN_TYPES) {
    it(`type ${type} is none`, () => {
      expect(phaseOf(run(inputs().frame(session(type, [])))[0])).toEqual({ kind: 'none' });
    });
  }
});

describe('weekend-phase: pending until the structure arrives, then fixed for the session', () => {
  it('opens no span while the structure is empty, then one span that stays', () => {
    const spans = run(inputs().frames(4, session(15, [])).frames(3, session(15, [15, 16])));
    expect(spans.slice(0, 4)).toEqual([undefined, undefined, undefined, undefined]);
    const opened = spans[4]!;
    expect(phaseOf(opened)).toEqual({ kind: 'race', format: 'sprint' });
    expect(spans.slice(5).map((s) => s?.id)).toEqual([opened.id, opened.id]);
  });
  it('a later change of the session type or the structure does not change the phase', () => {
    const spans = run(inputs().frames(2, session(5, [5])).frame(session(15, [15, 16])).frame(session(18, [])).frame(session(6, [6, 7])));
    const first = spans[0]!;
    expect(phaseOf(first)).toEqual({ kind: 'qualifying', format: 'grandPrix', segment: 1 });
    for (const s of spans) expect(s?.id).toBe(first.id);
    for (const s of spans) expect(phaseOf(s)).toEqual(phaseOf(first));
  });
  it('none, decided from the session type alone, is not changed by a structure that arrives later', () => {
    const spans = run(inputs().frames(2, session(18, [])).frames(2, session(18, [15, 16])));
    expect(spans.map(phaseOf)).toEqual(Array(4).fill({ kind: 'none' }));
    expect(new Set(spans.map((s) => s?.id)).size).toBe(1);
  });
  it('closes no span while stepping (the span is open until the session ends)', () => {
    let open = machine.init();
    for (const input of inputs().frames(3, session(15, [])).frames(3, session(15, [15, 16])).build()) {
      const step = machine.step(open, input);
      expect(step.closed).toEqual([]);
      open = step.open;
    }
  });
});

describe('weekend-phase: race-sprint-start (a sprint weekend, first Session packet without a structure)', () => {
  let phases: WeekendPhase[];
  beforeAll(async () => {
    const file = 'race-sprint-start.pwrec.gz';
    const tracker = new SessionTracker({ feedId: feedId(file) });
    const events = (await segmentPackets(file)).flatMap(({ packet, receivedAtMs }) => tracker.push(packet, receivedAtMs));
    const frames = [...events, ...tracker.end()].flatMap((e) => (e.type === 'frame' ? [e.frame] : []));
    const first = frames.find((f) => f.session !== undefined)!;
    const runner = new SessionRunner({ feedId: feedId(file), sessionUid: first.sessionUid, session: first.session! });
    phases = [];
    const onResult = (r: { state: Parameters<typeof situationOf>[0] }, _f: Frame) => void phases.push(situationOf(r.state).weekendPhase);
    for (const f of frames.slice(frames.indexOf(first))) runner.apply(f, onResult);
    runner.end(onResult);
  });
  it('is pending on the first packet', () => {
    expect(phases[0]).toEqual({ kind: 'pending' });
  });
  it('becomes the race, format sprint, once a Session packet carries [15, 16], and stays so', () => {
    const decided = phases.findIndex((p) => p.kind !== 'pending');
    expect(decided).toBeGreaterThan(0);
    expect(phases.slice(0, decided).every((p) => p.kind === 'pending')).toBe(true);
    expect(phases.slice(decided)).toEqual(Array(phases.length - decided).fill({ kind: 'race', format: 'sprint' }));
  });
});
