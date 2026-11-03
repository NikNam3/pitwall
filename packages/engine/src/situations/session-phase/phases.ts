// Shared by the three session-phase sub-machines (contract C9, C14, C17, C18, C26): their open state, how a span opens
// and closes, the session's end and the cars they read. No `machine.ts` here, so the generator registers nothing of
// this folder (C15). Ported from the legacy tracker (`history/situations/session-phase.ts`, Task 9); the facts behind
// each rule: docs/research/09-situations-inventory.md §1, §7.
import type { MachineId, OpenSpan, SessionFlag, SessionTime, Span } from '@pitwall/domain';
import { isActiveCar, slotsInUse } from '../../step/active-cars.ts';
import type { DeepReadonly } from '../../util/deep-readonly.ts';
import type { MachineInput, MachineStep } from '../machine.ts';

/** A session-phase span still open: its kind and detail (`NeutralisedDetail`, `SuspendedDetail` or none). */
export type PhaseSpan = OpenSpan<string, unknown>;

/** The car of a neutralisation. */
export type NeutralisingCar = 'SC' | 'VSC';

/**
 * A neutralisation opened on its SCAR deployment and not yet confirmed by the safety car status (C18): the machine's
 * pending confirmation. `replaced`: the span the deployment closed, as it was open, which goes on if the deployment is
 * never confirmed in time.
 */
export type PendingDeployment = { car: NeutralisingCar; deployedAt: SessionTime; replaced: { kind: string; detail: unknown } };

/** A session-phase sub-machine's open state (C9): plain data, so snapshots carry it and a rewind restores it (C26). */
export type PhaseOpen = {
  /** The spans opened so far: the next one's id (C26). */
  opened: number;
  /** The span in progress; undefined before the first frame the machine runs. */
  span: PhaseSpan | undefined;
  /** The previous frame's race-clock time; undefined before the first frame the machine runs. */
  lastAt: SessionTime | undefined;
  /** The safety car status (a signal, C12) on the previous frame. */
  lastStatus: SessionFlag | undefined;
  /** The deployment the open neutralisation waits to see confirmed (race only). */
  pending?: PendingDeployment | undefined;
};

export const initialPhaseOpen = (): PhaseOpen => ({ opened: 0, span: undefined, lastAt: undefined, lastStatus: undefined });

/** What a phase opens with: its detail, `joinedAt` on a join (C85), `confirmed: false` while a confirmation waits (C18). */
type Opening = { detail?: unknown; joined?: boolean; confirmed?: boolean };

/** One frame of a session-phase sub-machine: its open state as it goes, the spans it closed and the frame it runs on. */
export type PhaseDraft = {
  readonly machine: MachineId;
  readonly input: DeepReadonly<MachineInput>;
  open: PhaseOpen;
  readonly closed: Array<Omit<Span, 'endFrame'>>;
};

export const draftOf = (machine: MachineId, open: DeepReadonly<PhaseOpen>, input: DeepReadonly<MachineInput>): PhaseDraft => ({
  machine,
  input,
  open: open as PhaseOpen,
  closed: [],
});

/** The kind of the span in progress; undefined before the first frame. */
export const kindOf = (d: PhaseDraft): string | undefined => d.open.span?.kind;

/** The race-clock time the span in progress closed at, with its final detail: the closed span of `spans:<machine>`. */
const close = (d: PhaseDraft, at: SessionTime, detail?: unknown): void => {
  const { span } = d.open;
  if (span === undefined) return;
  d.closed.push({ ...span, ...(detail !== undefined && { detail }), end: at });
};

/**
 * Closes the span in progress at `at` (with `closingDetail` in place of its detail when given) and opens a span of
 * `kind` there, on this frame (C26), with the next id. A pending confirmation belongs to the closed span: it goes.
 */
export const enter = (d: PhaseDraft, kind: string, at: SessionTime, opening: Opening = {}, closingDetail?: unknown): void => {
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
  d.open = { ...d.open, opened: d.open.opened + 1, span, pending: undefined };
};

/** The span in progress with `detail` (a new object: nothing that was handed out changes). */
export const withDetail = (d: PhaseDraft, detail: unknown): void => {
  if (d.open.span) d.open = { ...d.open, span: { ...d.open.span, detail } };
};

/** The draft as the sub-machine's step: the frame's time and status noted for the next frame. */
export const stepOf = (d: PhaseDraft): MachineStep<PhaseOpen> => ({
  open: { ...d.open, lastAt: d.input.at, lastStatus: d.input.signals.session.safetyCarStatus },
  closed: d.closed,
});

/** The session's end phase is open: nothing opens after it but at the session's close (`closeSession`). */
export const isPostSession = (d: PhaseDraft): boolean => kindOf(d) === 'postSession';

/**
 * The game simulated the rest of the session (the clock's `simulatedEnd`, C36): the post-session opens at the time of
 * that fact, the last frame before the jump. Read before the frame's other signals, as the clock runs before them (C7);
 * never before the span in progress opened (a span the machine's first frame opened is the only one that can be later).
 */
export const simulatedEnd = (d: PhaseDraft): void => {
  const at = d.input.clock.simulatedEnd;
  const { span } = d.open;
  if (at !== undefined && span !== undefined && !isPostSession(d)) enter(d, 'postSession', Math.max(at, span.start));
};

/** The cars in the session (C12: `resultStatus`, `numActiveCars`), as the live state lists them. */
export const carsInSession = (input: DeepReadonly<MachineInput>) => {
  const { signals, live } = input;
  const slots = slotsInUse({ cars: signals.cars.map((c) => ({ timing: { resultStatus: c.resultStatus } })), session: signals.session });
  return live.cars.filter((car) => {
    const status = signals.cars[car.id]?.resultStatus;
    return status !== undefined && isActiveCar(car.id, slots, status);
  });
};

/** Every car in the session has finished: time over in practice or qualifying (a player who left retires instead). */
export const everyCarFinished = (input: DeepReadonly<MachineInput>): boolean => {
  const cars = carsInSession(input);
  return cars.length > 0 && cars.every((car) => input.signals.cars[car.id]?.resultStatus === 'finished');
};

/** The session's events of this frame (C12), in arrival order. */
export const eventsOf = (input: DeepReadonly<MachineInput>) => input.signals.events;
