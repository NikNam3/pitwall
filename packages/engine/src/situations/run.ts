// Step 2, the machine (contract C9, C14, C18, C20, C22, C26, C40): the registered sub-machines that apply to the
// weekend phase run in their order (`MACHINE_ORDER`); each reads the signals, the live state, the clock's state and the
// open spans its upstreams have after this frame, and the frame's number. A span records the frame numbers it opened
// and closed on (C26): a sub-machine sets `startFrame`, and its closed spans are appended to `spans:<id>` with
// `endFrame` the frame that closed them. Which spans a fact belongs to is computed by the projection alone, from frame
// numbers (C28). Each sub-machine's open state is kept in `open.machines[id]`, so snapshots carry it and a rewind
// restores its span count with it (C26). A sub-machine's open spans are built once per open state (`spansOf`), and a
// span that did not change is the same object as on the frame before, so the `spans:<id>` tag compares identities first
// (C40).
import type { ClockFact, FrameNumber, MachineId, OpenSpan, SessionTime, Span, WeekendPhase } from '@pitwall/domain';
import type { Frame } from '../frame/frame.ts';
import { logWriter } from '../log/log.ts';
import type { EngineState } from '../state/engine-state.ts';
import type { ChangeTag, StepOutput } from '../step/types.ts';
import type { DeepReadonly } from '../util/deep-readonly.ts';
import { clockInput, STEP0_CLOCK } from './clock/clock.ts';
import type { MachineStep, SubMachine } from './machine.ts';
import { MACHINE_ORDER } from './registry.ts';
import type { Situation } from './situation.ts';
import { phaseOfSpan } from './weekend-phase/machine.ts';

type Closed = MachineStep<unknown>['closed'];

/** The registered sub-machines' change tags (C40), built once; `SPAN_TAGS` holds them as literals. */
const SPAN_TAG_OF: ReadonlyMap<MachineId, ChangeTag> = new Map(MACHINE_ORDER.map((m) => [m.id, `spans:${m.id}` as ChangeTag]));

/** A sub-machine's change tag (C40). */
const spanTag = (machine: MachineId): ChangeTag => SPAN_TAG_OF.get(machine) ?? (`spans:${machine}` as ChangeTag);

/** The upstream of a sub-machine that reads none: one empty record, which no sub-machine writes (its input is read-only). */
const NO_UPSTREAM: Readonly<Record<MachineId, OpenSpan[]>> = Object.freeze({});

/** The sub-machine that decides the weekend phase (C14). */
const WEEKEND_PHASE: MachineId = 'weekend-phase';

/** The registered weekend-phase sub-machine, looked up once. */
const WEEKEND_PHASE_MACHINE = MACHINE_ORDER.find((m) => m.id === WEEKEND_PHASE);

/** The weekend phase: the open span of the weekend-phase sub-machine, `pending` while none is open (C14). */
const weekendPhaseOf = (state: DeepReadonly<EngineState>): WeekendPhase =>
  phaseOfSpan(WEEKEND_PHASE_MACHINE === undefined ? undefined : openSpansOf(state, WEEKEND_PHASE_MACHINE)[0]);

/** A sub-machine runs in a weekend phase it applies to; a per-phase one never while the phase is pending or `none` (C14). */
const applies = (machine: SubMachine<unknown>, phase: WeekendPhase): boolean =>
  machine.appliesTo === 'all' || (machine.appliesTo as readonly string[]).includes(phase.kind);

/**
 * The open spans of each open state, by the open state's identity: a sub-machine's `openSpans` runs once per open
 * state, so `runMachine`, `situationOf` and the weekend phase read the same spans on a frame. An open state is never
 * changed in place (a step returns a new one), and a restored snapshot is a copy, which builds its spans again (C27).
 */
const spansByOpen = new WeakMap<object, { machine: MachineId; spans: OpenSpan[] }>();

/** The open spans of `machine`'s open state `open`, built once per open state. */
const spansOf = (machine: SubMachine<unknown>, open: unknown): OpenSpan[] => {
  if (typeof open !== 'object' || open === null) return machine.openSpans(open);
  const known = spansByOpen.get(open);
  if (known !== undefined && known.machine === machine.id) return known.spans;
  const spans = machine.openSpans(open);
  spansByOpen.set(open, { machine: machine.id, spans });
  return spans;
};

/** The open spans of a sub-machine that has run; none before it first ran. */
const openSpansOf = (state: DeepReadonly<EngineState>, machine: SubMachine<unknown>): OpenSpan[] =>
  machine.id in state.open.machines ? spansOf(machine, state.open.machines[machine.id]) : [];

/**
 * Two plain values are equal: the same primitives, arrays and objects all the way down (also step 0's tag rule). The
 * same object is equal without a walk, so an unchanged span costs one comparison.
 */
export const samePlain = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!samePlain(a[i], b[i])) return false;
    return true;
  }
  if (Array.isArray(b)) return false;
  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  let keys = 0;
  for (const k in x) {
    if (!Object.hasOwn(x, k)) continue;
    keys += 1;
    if (!(k in y) || !samePlain(x[k], y[k])) return false;
  }
  for (const k in y) if (Object.hasOwn(y, k)) keys -= 1;
  return keys === 0;
};

/** Appends closed spans to `spans:<id>` (C22), each closed on frame `endFrame` (C26); returns them as appended, by machine. */
const appendClosed = (state: EngineState, closed: ReadonlyArray<{ machine: MachineId; spans: Closed }>, endFrame: FrameNumber): Record<MachineId, Span[]> => {
  const log = logWriter(state.log);
  const appended: Record<MachineId, Span[]> = {};
  for (const { machine, spans } of closed) {
    const list = spans.map((span): Span => ({ ...span, endFrame }));
    for (const span of list) log.append(`spans:${machine}`, span);
    appended[machine] = list;
  }
  return appended;
};

/**
 * Step 2 on one frame (C9): runs every registered sub-machine that applies to the weekend phase, in `MACHINE_ORDER`,
 * with the frame's number (`state.frameNumber`, set by `step`) and step 0's clock (`clockFacts`: the clock facts step 0
 * gave the frame, C7), appends the spans they closed to `spans:<id>`, each closed on this frame, and tags `spans:<id>`
 * when a machine's spans changed (C40). The weekend phase is the one the weekend-phase sub-machine decided on this
 * frame, once it ran: a per-phase sub-machine (ordered after it, its upstream) runs from the frame the phase is decided
 * on (C14). Returns the spans it closed on the frame, by machine, as appended: step 2's closed spans, which step 3
 * reads (C9, C10).
 */
export function runMachine(state: EngineState, frame: Frame, out: StepOutput, clockFacts: readonly ClockFact[] = []): Record<MachineId, Span[]> {
  let weekendPhase = weekendPhaseOf(state);
  const clock = clockInput(state, clockFacts);
  const after: Record<MachineId, OpenSpan[]> = {};
  const closed: Array<{ machine: MachineId; spans: Closed }> = [];
  for (const machine of MACHINE_ORDER) {
    if (!applies(machine, weekendPhase)) continue;
    const before = openSpansOf(state, machine);
    const open = machine.id in state.open.machines ? state.open.machines[machine.id] : machine.init();
    const upstream = machine.inputs.upstream.length === 0 ? NO_UPSTREAM : Object.fromEntries(machine.inputs.upstream.map((id) => [id, after[id] ?? []]));
    const step = machine.step(open, { at: frame.sessionTime, frameId: frame.frameId, frameNumber: state.frameNumber, signals: state.signals, live: state, clock, upstream, weekendPhase });
    state.open.machines[machine.id] = step.open;
    after[machine.id] = spansOf(machine, step.open);
    if (step.closed.length > 0) closed.push({ machine: machine.id, spans: step.closed });
    if (step.closed.length > 0 || !samePlain(before, after[machine.id])) out.changed.add(spanTag(machine.id));
    if (machine.id === WEEKEND_PHASE) weekendPhase = phaseOfSpan(after[machine.id]?.[0]);
  }
  return appendClosed(state, closed, state.frameNumber);
}

/** The machine's open spans (C20): the clock's (`running` or `paused`), every registered sub-machine's, and the weekend phase. */
export function situationOf(state: DeepReadonly<EngineState>): Situation {
  const byMachine: Record<MachineId, OpenSpan[]> = { [STEP0_CLOCK.id]: STEP0_CLOCK.openSpans(state.open.clock) };
  for (const machine of MACHINE_ORDER) byMachine[machine.id] = openSpansOf(state, machine);
  return { weekendPhase: weekendPhaseOf(state), byMachine };
}

/**
 * The session ended (C18): every open span of every sub-machine is closed as a fact at `at`, on the frame after the last
 * applied one (`endFrame`, so it still covers that frame, C26); a pending confirmation closes as it stands,
 * `confirmed: false`. The clock's open span (`running` or `paused`) closes too. The open states go, so every log is complete and no
 * span stays open.
 */
export function closeSession(state: EngineState, at: SessionTime): void {
  const closeAll = (machine: MachineId, open: readonly DeepReadonly<OpenSpan>[]) => ({ machine, spans: open.map((span) => ({ ...span, end: at })) });
  const closed = [
    closeAll(STEP0_CLOCK.id, STEP0_CLOCK.openSpans(state.open.clock)),
    ...MACHINE_ORDER.map((machine) => closeAll(machine.id, openSpansOf(state, machine))),
  ];
  appendClosed(state, closed, state.frameNumber + 1);
  state.open.clock = { ...state.open.clock, current: undefined };
  state.open.machines = {};
}
