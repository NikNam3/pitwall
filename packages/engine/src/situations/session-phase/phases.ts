// Shared by the three session-phase sub-machines (contract C9, C14, C15, C17, C26): their open state, how a span opens
// and closes, the session's end and the cars in the session (from the signals they declare). No `machine.ts` here, so the generator registers nothing of
// this folder (C15). Ported from the legacy tracker (`history/situations/session-phase.ts`, Task 9); the facts behind
// each rule: docs/research/09-situations-inventory.md §1, §7.
import { carId, type CarId, type MachineId, type OpenSpan, type SessionTime, type Span } from '@pitwall/domain';
import { isActiveCar, slotsInUse } from '../../step/active-cars.ts';
import type { DeepReadonly } from '../../util/deep-readonly.ts';
import type { MachineInput, MachineStep } from '../machine.ts';

/** A session-phase span still open: its kind and detail (`NeutralisedDetail`, `SuspendedDetail` or none). */
export type PhaseSpan = OpenSpan<string, unknown>;

/**
 * A session-phase sub-machine's open state (C9): plain data, so snapshots carry it and a rewind restores it (C26). A
 * machine may keep more (the race's safety car bookkeeping) in a type that extends it.
 */
export type PhaseOpen = {
  /** The spans opened so far: the next one's id (C26). */
  opened: number;
  /** The span in progress; undefined before the first frame the machine runs. */
  span: PhaseSpan | undefined;
  /** The previous frame's race-clock time; undefined before the first frame the machine runs. */
  lastAt: SessionTime | undefined;
};

export const initialPhaseOpen = (): PhaseOpen => ({ opened: 0, span: undefined, lastAt: undefined });

/** What a phase opens with: its detail, `joinedAt` on a join (C85), `confirmed: false` while a confirmation waits (C18). */
type Opening = { detail?: unknown; joined?: boolean; confirmed?: boolean };

/** One frame of a session-phase sub-machine: its open state as it goes, the spans it closed and the frame it runs on. */
export type PhaseDraft<O extends PhaseOpen = PhaseOpen> = {
  readonly machine: MachineId;
  readonly input: DeepReadonly<MachineInput>;
  open: O;
  readonly closed: Array<Omit<Span, 'endFrame'>>;
};

export const draftOf = <O extends PhaseOpen>(machine: MachineId, open: DeepReadonly<O>, input: DeepReadonly<MachineInput>): PhaseDraft<O> => ({
  machine,
  input,
  open: open as O,
  closed: [],
});

/** The kind of the span in progress; undefined before the first frame. */
export const kindOf = (d: PhaseDraft<PhaseOpen>): string | undefined => d.open.span?.kind;

/** The race-clock time the span in progress closed at, with its final detail: the closed span of `spans:<machine>`. */
const close = (d: PhaseDraft<PhaseOpen>, at: SessionTime, detail?: unknown): void => {
  const { span } = d.open;
  if (span === undefined) return;
  d.closed.push({ ...span, ...(detail !== undefined && { detail }), end: at });
};

/**
 * Closes the span in progress at `at` (with `closingDetail` in place of its detail when given) and opens a span of
 * `kind` there, on this frame (C26), with the next id.
 */
export const enter = <O extends PhaseOpen>(d: PhaseDraft<O>, kind: string, at: SessionTime, opening: Opening = {}, closingDetail?: unknown): void => {
  close(d, at, closingDetail);
  const span: PhaseSpan = {
    machine: d.machine,
    id: d.open.opened,
    kind,
    start: at,
    startFrame: d.input.frameNumber,
    confirmed: opening.confirmed ?? true,
    ...(opening.joined === true && { joinedAt: true as const }),
    detail: opening.detail,
  };
  d.open = { ...d.open, opened: d.open.opened + 1, span };
};

/** The span in progress with `detail` (a new object: nothing that was handed out changes). */
export const withDetail = <O extends PhaseOpen>(d: PhaseDraft<O>, detail: unknown): void => {
  if (d.open.span) d.open = { ...d.open, span: { ...d.open.span, detail } };
};

/** The draft as the sub-machine's step: the frame's time noted for the next frame. */
export const stepOf = <O extends PhaseOpen>(d: PhaseDraft<O>): MachineStep<O> => ({ open: { ...d.open, lastAt: d.input.at }, closed: d.closed });

/** The session's end phase is open: nothing opens after it but at the session's close (`closeSession`). */
export const isPostSession = (d: PhaseDraft<PhaseOpen>): boolean => kindOf(d) === 'postSession';

/**
 * The game simulated the rest of the session (the clock's `simulatedEnd`, C36): the post-session opens at the time of
 * that fact, the last frame before the jump, through `enterPhase` (the machine's own `enter`). Read before the frame's
 * other signals, as the clock runs before them (C7); never before the span in progress opened (a span the machine's
 * first frame opened is the only one that can be later).
 */
export const simulatedEnd = <O extends PhaseOpen>(
  d: PhaseDraft<O>,
  enterPhase: (d: PhaseDraft<O>, kind: string, at: SessionTime) => void = enter,
): void => {
  const at = d.input.clock.simulatedEnd;
  const { span } = d.open;
  if (at !== undefined && span !== undefined && !isPostSession(d)) enterPhase(d, 'postSession', Math.max(at, span.start));
};

/** The cars in the session, by id: from the signals `resultStatus` and `numActiveCars` alone (C12, `isActiveCar`). */
export const carsInSession = (input: DeepReadonly<MachineInput>): CarId[] => {
  const { signals } = input;
  const slots = slotsInUse({ cars: signals.cars.map((c) => ({ timing: { resultStatus: c.resultStatus } })), session: signals.session });
  return signals.cars.flatMap((c, i) => (isActiveCar(i, slots, c.resultStatus) ? [carId(i)] : []));
};

/** Every car in the session has finished: time over in practice or qualifying (a player who left retires instead). */
export const everyCarFinished = (input: DeepReadonly<MachineInput>): boolean => {
  const cars = carsInSession(input);
  return cars.length > 0 && cars.every((id) => input.signals.cars[id]?.resultStatus === 'finished');
};

/** The session's events of this frame (C12), in arrival order. */
export const eventsOf = (input: DeepReadonly<MachineInput>) => input.signals.events;
