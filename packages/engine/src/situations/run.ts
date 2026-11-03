// Step 2, the machine (contract C9, C14, C18, C20, C22, C26, C40): the registered sub-machines that apply to the
// weekend phase run in their order (`MACHINE_ORDER`); each reads the signals, the live state, the clock's state and the
// open spans its upstreams have after this frame. Their closed spans are appended to `spans:<id>`, stamped like the
// recorders' facts, and the frame's stamps go to the recorders. Each sub-machine's open state is kept in
// `open.machines[id]`, so snapshots carry it and a rewind restores its span count with it (C26).
import { MAX_CARS, type MachineId, type OpenSpan, type SessionTime, type Span, type WeekendPhase } from '@pitwall/domain';
import type { Frame } from '../frame/frame.ts';
import { logWriter } from '../log/log.ts';
import type { EngineState } from '../state/engine-state.ts';
import { stampOf, type ChangeTag, type FrameStamps, type StepOutput } from '../step/types.ts';
import type { DeepReadonly } from '../util/deep-readonly.ts';
import type { ClockInput, MachineStep, SubMachine } from './machine.ts';
import { MACHINE_ORDER } from './registry.ts';
import type { Situation } from './situation.ts';

type Closed = MachineStep<unknown>['closed'];

/** A sub-machine's change tag (C40); `SPAN_TAGS` holds the registered ones' as literals. */
const spanTag = (machine: MachineId): ChangeTag => `spans:${machine}` as ChangeTag;

/** The weekend phase: `pending` until the weekend-phase sub-machine decides it (C14, Task 8). */
const weekendPhaseOf = (_state: DeepReadonly<EngineState>): WeekendPhase => ({ kind: 'pending' });

/** Step 0's clock as the sub-machines read it (the situation tracker's clock until Task 7 makes it step 0). */
const clockInputOf = (state: EngineState): ClockInput => ({
  paused: state.open.phaseBook.onlinePause !== undefined,
  offsetMs: state.open.phaseBook.clockOffsetMs,
});

/** A sub-machine runs in a weekend phase it applies to; a per-phase one never while the phase is pending or `none` (C14). */
const applies = (machine: SubMachine<unknown>, phase: WeekendPhase): boolean =>
  machine.appliesTo === 'all' || (machine.appliesTo as readonly string[]).includes(phase.kind);

/** The open spans of a sub-machine that has run; none before it first ran. */
const openSpansOf = (state: DeepReadonly<EngineState>, machine: SubMachine<unknown>): OpenSpan[] =>
  machine.id in state.open.machines ? machine.openSpans(state.open.machines[machine.id]) : [];

/** Two plain values are equal: the same primitives, arrays and objects all the way down. */
const samePlain = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null || Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((k) => k in b && samePlain((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
};

/**
 * The stamps of the open spans (C26): the session-scoped spans, and per car that car's car-scoped spans. Zone-scoped
 * spans are never stamped.
 */
const stampsOf = (state: DeepReadonly<EngineState>): FrameStamps => {
  const session: Record<MachineId, number> = {};
  const cars: Array<Record<MachineId, number>> = Array.from({ length: MAX_CARS }, () => ({}));
  for (const machine of MACHINE_ORDER) {
    if (machine.scope === 'zone') continue;
    for (const span of openSpansOf(state, machine)) {
      const stamp = machine.scope === 'session' ? session : span.carId !== undefined ? cars[span.carId] : undefined;
      if (stamp) stamp[machine.id] = span.id;
    }
  }
  return { session, cars };
};

/** Appends closed spans to `spans:<id>` (C22), each stamped with `stamps`. */
const appendClosed = (state: EngineState, closed: ReadonlyArray<{ machine: MachineId; spans: Closed }>, stamps: FrameStamps): void => {
  const log = logWriter(state.log);
  for (const { machine, spans } of closed) {
    // The log's span lists hold every sub-machine's spans, whatever their detail (`Span` in log/types.ts).
    for (const span of spans) log.append(`spans:${machine}`, { ...span, in: stampOf(stamps, span.carId) } as Span);
  }
};

/**
 * Step 2 on one frame (C9): runs every registered sub-machine that applies to the weekend phase, in `MACHINE_ORDER`,
 * appends the spans they closed to `spans:<id>`, tags `spans:<id>` when a machine's spans changed (C40) and returns
 * the frame's stamps.
 */
export function runMachine(state: EngineState, frame: Frame, out: StepOutput): FrameStamps {
  const weekendPhase = weekendPhaseOf(state);
  const clock = clockInputOf(state);
  const after: Record<MachineId, OpenSpan[]> = {};
  const closed: Array<{ machine: MachineId; spans: Closed }> = [];
  for (const machine of MACHINE_ORDER) {
    if (!applies(machine, weekendPhase)) continue;
    const before = openSpansOf(state, machine);
    const open = machine.id in state.open.machines ? state.open.machines[machine.id] : machine.init();
    const upstream = Object.fromEntries(machine.inputs.upstream.map((id) => [id, after[id] ?? []]));
    const step = machine.step(open, { at: frame.sessionTime, frameId: frame.frameId, signals: state.signals, live: state, clock, upstream, weekendPhase });
    state.open.machines[machine.id] = step.open;
    after[machine.id] = machine.openSpans(step.open);
    if (step.closed.length > 0) closed.push({ machine: machine.id, spans: step.closed });
    if (step.closed.length > 0 || !samePlain(before, after[machine.id])) out.changed.add(spanTag(machine.id));
  }
  const stamps = stampsOf(state);
  appendClosed(state, closed, stamps);
  return stamps;
}

/** The machine's open spans (C20): every registered sub-machine's, and the weekend phase. */
export function situationOf(state: DeepReadonly<EngineState>): Situation {
  const byMachine: Record<MachineId, OpenSpan[]> = {};
  for (const machine of MACHINE_ORDER) byMachine[machine.id] = openSpansOf(state, machine);
  return { weekendPhase: weekendPhaseOf(state), session: undefined, byMachine };
}

/**
 * The session ended (C18): every open span of every sub-machine is closed as a fact at `at`, stamped with the spans open
 * then; a pending confirmation closes as it stands, `confirmed: false`. The open states go, so every log is complete
 * and no span stays open. The clock's paused span joins once the clock is step 0 (Task 7).
 */
export function closeSession(state: EngineState, at: SessionTime): void {
  const stamps = stampsOf(state);
  const closed = MACHINE_ORDER.map((machine) => ({ machine: machine.id, spans: openSpansOf(state, machine).map((span) => ({ ...span, end: at })) }));
  appendClosed(state, closed, stamps);
  state.open.machines = {};
}
