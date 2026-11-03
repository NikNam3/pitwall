// Step 2, the machine (contract C9, C14, C18, C20, C22, C26, C40): the registered sub-machines that apply to the
// weekend phase run in their order (`MACHINE_ORDER`); each reads the signals, the live state, the clock's state and the
// open spans its upstreams have after this frame, and the frame's number. A span records the frame numbers it opened
// and closed on (C26): a sub-machine sets `startFrame`, and its closed spans are appended to `spans:<id>` with
// `endFrame` the frame that closed them. Which spans a fact belongs to is computed by the projection alone, from frame
// numbers (C28). Each sub-machine's open state is kept in `open.machines[id]`, so snapshots carry it and a rewind
// restores its span count with it (C26).
import type { FrameNumber, MachineId, OpenSpan, SessionTime, WeekendPhase } from '@pitwall/domain';
import type { Frame } from '../frame/frame.ts';
import { logWriter } from '../log/log.ts';
import type { EngineState } from '../state/engine-state.ts';
import type { ChangeTag, StepOutput } from '../step/types.ts';
import type { DeepReadonly } from '../util/deep-readonly.ts';
import { clockInput, STEP0_CLOCK } from './clock/clock.ts';
import type { MachineStep, SubMachine } from './machine.ts';
import { MACHINE_ORDER } from './registry.ts';
import type { Situation } from './situation.ts';

type Closed = MachineStep<unknown>['closed'];

/** A sub-machine's change tag (C40); `SPAN_TAGS` holds the registered ones' as literals. */
const spanTag = (machine: MachineId): ChangeTag => `spans:${machine}` as ChangeTag;

/** The weekend phase: `pending` until the weekend-phase sub-machine decides it (C14, Task 8). */
const weekendPhaseOf = (_state: DeepReadonly<EngineState>): WeekendPhase => ({ kind: 'pending' });

/** A sub-machine runs in a weekend phase it applies to; a per-phase one never while the phase is pending or `none` (C14). */
const applies = (machine: SubMachine<unknown>, phase: WeekendPhase): boolean =>
  machine.appliesTo === 'all' || (machine.appliesTo as readonly string[]).includes(phase.kind);

/** The open spans of a sub-machine that has run; none before it first ran. */
const openSpansOf = (state: DeepReadonly<EngineState>, machine: SubMachine<unknown>): OpenSpan[] =>
  machine.id in state.open.machines ? machine.openSpans(state.open.machines[machine.id]) : [];

/** Two plain values are equal: the same primitives, arrays and objects all the way down (also step 0's tag rule). */
export const samePlain = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null || Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((k) => k in b && samePlain((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
};

/** Appends closed spans to `spans:<id>` (C22), each closed on frame `endFrame` (C26). */
const appendClosed = (state: EngineState, closed: ReadonlyArray<{ machine: MachineId; spans: Closed }>, endFrame: FrameNumber): void => {
  const log = logWriter(state.log);
  for (const { machine, spans } of closed) {
    for (const span of spans) log.append(`spans:${machine}`, { ...span, endFrame });
  }
};

/**
 * Step 2 on one frame (C9): runs every registered sub-machine that applies to the weekend phase, in `MACHINE_ORDER`,
 * with the frame's number (`state.frameNumber`, set by `step`), appends the spans they closed to `spans:<id>`, each
 * closed on this frame, and tags `spans:<id>` when a machine's spans changed (C40).
 */
export function runMachine(state: EngineState, frame: Frame, out: StepOutput): void {
  const weekendPhase = weekendPhaseOf(state);
  const clock = clockInput(state);
  const after: Record<MachineId, OpenSpan[]> = {};
  const closed: Array<{ machine: MachineId; spans: Closed }> = [];
  for (const machine of MACHINE_ORDER) {
    if (!applies(machine, weekendPhase)) continue;
    const before = openSpansOf(state, machine);
    const open = machine.id in state.open.machines ? state.open.machines[machine.id] : machine.init();
    const upstream = Object.fromEntries(machine.inputs.upstream.map((id) => [id, after[id] ?? []]));
    const step = machine.step(open, { at: frame.sessionTime, frameId: frame.frameId, frameNumber: state.frameNumber, signals: state.signals, live: state, clock, upstream, weekendPhase });
    state.open.machines[machine.id] = step.open;
    after[machine.id] = machine.openSpans(step.open);
    if (step.closed.length > 0) closed.push({ machine: machine.id, spans: step.closed });
    if (step.closed.length > 0 || !samePlain(before, after[machine.id])) out.changed.add(spanTag(machine.id));
  }
  appendClosed(state, closed, state.frameNumber);
}

/** The machine's open spans (C20): the clock's (a pause in progress), every registered sub-machine's, and the weekend phase. */
export function situationOf(state: DeepReadonly<EngineState>): Situation {
  const byMachine: Record<MachineId, OpenSpan[]> = { [STEP0_CLOCK.id]: STEP0_CLOCK.openSpans(state.open.clock) };
  for (const machine of MACHINE_ORDER) byMachine[machine.id] = openSpansOf(state, machine);
  return { weekendPhase: weekendPhaseOf(state), session: undefined, byMachine };
}

/**
 * The session ended (C18): every open span of every sub-machine is closed as a fact at `at`, on the frame after the last
 * applied one (`endFrame`, so it still covers that frame, C26); a pending confirmation closes as it stands,
 * `confirmed: false`. The clock's pause in progress closes too. The open states go, so every log is complete and no
 * span stays open.
 */
export function closeSession(state: EngineState, at: SessionTime): void {
  const closeAll = (machine: MachineId, open: readonly DeepReadonly<OpenSpan>[]) => ({ machine, spans: open.map((span) => ({ ...span, end: at })) });
  const closed = [
    closeAll(STEP0_CLOCK.id, STEP0_CLOCK.openSpans(state.open.clock)),
    ...MACHINE_ORDER.map((machine) => closeAll(machine.id, openSpansOf(state, machine))),
  ];
  appendClosed(state, closed, state.frameNumber + 1);
  state.open.clock = { ...state.open.clock, pause: undefined };
  state.open.machines = {};
}
