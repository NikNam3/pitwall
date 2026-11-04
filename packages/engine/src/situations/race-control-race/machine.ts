// The race's race-control sub-machine (contract C9, C12, C14, C15, C17, C18, C26): session-scoped, DRS in a race and sprint.
// Before the lights out (the upstream `session-phase-race` in grid, formation or startLights) DRS is `drsOff` with reason
// `notEnabledYet` and DRSE and DRSD do not count. After it, DRSE opens `drsOn` and a DRSD opens `drsOff` with its reason
// (a new span when the reason changes). A race joined after the lights out opens `drsOff` with reason `safetyCar` while
// neutralised, `redFlag` while suspended, and `drsOn` otherwise (supervisor rulings). Inventory 1.4 and 4.
import { raceControlRaceSpans, type FrameNumber, type DrsOffReason, type OpenSpan, type SessionTime } from '@pitwall/domain';
import type { SituationEvent } from '../../signals/types.ts';
import type { MachineInput, MachineStep, SubMachine } from '../machine.ts';

type Held = { id: number; kind: 'drsOff' | 'drsOn'; reason?: DrsOffReason; start: SessionTime; startFrame: number; joinedAt?: true };
type Open = { span: Held | undefined };

const BEFORE_LIGHTS_OUT = ['grid', 'formation', 'startLights'];

const detailOf = (span: Held) => (span.kind === 'drsOff' ? { reason: span.reason } : undefined);

/** The state DRS is in after this frame's events: the last DRSE or DRSD wins; undefined when none shows. */
const targetOf = (events: readonly SituationEvent[]): Pick<Held, 'kind' | 'reason'> | undefined => {
  let target: Pick<Held, 'kind' | 'reason'> | undefined;
  for (const event of events) {
    if (event.code === 'DRSE') target = { kind: 'drsOn' };
    else if (event.code === 'DRSD') target = { kind: 'drsOff', reason: event.reason };
  }
  return target;
};

const machine: SubMachine<Open> = {
  id: 'race-control-race',
  appliesTo: ['race'],
  spans: raceControlRaceSpans,
  inputs: { signals: ['events'], values: [], upstream: ['session-phase-race'] },
  transitions: [
    ['none', 'drsOff'],
    ['none', 'drsOn'],
    ['drsOff', 'drsOn'],
    ['drsOn', 'drsOff'],
    ['drsOff', 'drsOff'],
  ],
  init: () => ({ span: undefined }),
  openSpans: (open): OpenSpan[] =>
    open.span === undefined
      ? []
      : [{ machine: 'race-control-race', id: open.span.id, kind: open.span.kind, start: open.span.start, startFrame: open.span.startFrame as FrameNumber, confirmed: true, detail: detailOf(open.span), ...(open.span.joinedAt ? { joinedAt: true as const } : {}) }],
  step(open, input: MachineInput): MachineStep<Open> {
    const phase = input.upstream['session-phase-race']?.[0]?.kind ?? 'grid';
    const before = BEFORE_LIGHTS_OUT.includes(phase);
    const start = { start: input.at, startFrame: input.frameNumber as number };
    if (open.span === undefined) {
      const joined = phase === 'grid' ? {} : { joinedAt: true as const };
      if (before) return { open: { span: { id: 0, kind: 'drsOff', reason: 'notEnabledYet', ...start, ...joined } }, closed: [] };
      const reason = phase === 'neutralised' ? 'safetyCar' : phase === 'suspended' ? 'redFlag' : undefined;
      const span: Held = reason === undefined ? { id: 0, kind: 'drsOn', ...start, joinedAt: true } : { id: 0, kind: 'drsOff', reason, ...start, joinedAt: true };
      return { open: { span }, closed: [] };
    }
    if (before) return { open, closed: [] };
    const target = targetOf(input.signals.events);
    const current = open.span;
    if (target === undefined || (target.kind === current.kind && target.reason === current.reason)) return { open, closed: [] };
    const closed = { machine: 'race-control-race' as const, id: current.id, kind: current.kind, start: current.start, end: input.at, confirmed: true, detail: detailOf(current), startFrame: current.startFrame as FrameNumber, ...(current.joinedAt ? { joinedAt: true as const } : {}) };
    return { open: { span: { id: current.id + 1, ...target, ...start } }, closed: [closed] };
  },
};

export default machine;
