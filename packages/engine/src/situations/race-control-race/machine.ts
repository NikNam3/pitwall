// The race's race-control sub-machine (contract C9, C12, C14, C15, C17, C18, C26): session-scoped, DRS in a race and sprint.
// Before the lights out (the upstream `session-phase-race` in grid, formation or startLights) DRS is `drsOff` with reason
// `notEnabledYet` and DRSE and DRSD do not count. After it, DRSE opens `drsOn` and a DRSD opens `drsOff` with its reason
// (a new span when the reason changes). A race joined after the lights out opens `drsOff` with reason `safetyCar` while
// neutralised, `redFlag` while suspended, and `drsOn` otherwise (supervisor rulings). Inventory 1.4 and 4.
import { raceControlRaceSpans, type FrameNumber, type DrsOffReason, type OpenSpan, type SessionTime } from '@pitwall/domain';
import type { SituationEvent } from '../../signals/types.ts';
import type { MachineInput, MachineStep, SubMachine } from '../machine.ts';

/** What DRS is: on, or off with its reason. */
type Drs = { kind: 'drsOff' | 'drsOn'; reason?: DrsOffReason };
/** The open span, the same object while it holds (C40). */
type Open = { span: OpenSpan | undefined };

const BEFORE_LIGHTS_OUT = ['grid', 'formation', 'startLights'];

/** A span of `drs` opening at `start`, with the reason as its detail while DRS is off. */
const opening = (id: number, drs: Drs, start: { start: SessionTime; startFrame: FrameNumber }, joined: boolean): OpenSpan => ({
  machine: 'race-control-race',
  id,
  kind: drs.kind,
  ...start,
  confirmed: true,
  detail: drs.kind === 'drsOff' ? { reason: drs.reason } : undefined,
  ...(joined ? { joinedAt: true as const } : {}),
});

/** The reason of an open span: its detail's while DRS is off. */
const reasonOf = (span: OpenSpan): DrsOffReason | undefined => (span.detail as { reason?: DrsOffReason } | undefined)?.reason;

/** The state DRS is in after this frame's events: the last DRSE or DRSD wins; undefined when none shows. */
const targetOf = (events: readonly SituationEvent[]): Drs | undefined => {
  let target: Drs | undefined;
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
  openSpans: (open): OpenSpan[] => (open.span === undefined ? [] : [open.span]),
  step(open, input: MachineInput): MachineStep<Open> {
    const phase = input.upstream['session-phase-race']?.[0]?.kind ?? 'grid';
    const before = BEFORE_LIGHTS_OUT.includes(phase);
    const start = { start: input.at, startFrame: input.frameNumber };
    if (open.span === undefined) {
      if (before) return { open: { span: opening(0, { kind: 'drsOff', reason: 'notEnabledYet' }, start, phase !== 'grid') }, closed: [] };
      const reason = phase === 'neutralised' ? 'safetyCar' : phase === 'suspended' ? 'redFlag' : undefined;
      return { open: { span: opening(0, reason === undefined ? { kind: 'drsOn' } : { kind: 'drsOff', reason }, start, true) }, closed: [] };
    }
    if (before) return { open, closed: [] };
    const target = targetOf(input.signals.events);
    const current = open.span;
    if (target === undefined || (target.kind === current.kind && target.reason === reasonOf(current))) return { open, closed: [] };
    return { open: { span: opening(current.id + 1, target, start, false) }, closed: [{ ...current, end: input.at }] };
  },
};

export default machine;
