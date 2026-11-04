// The car-status sub-machine (contract C3, C9, C12, C15, C17, C18, C19, C26, C43): per car slot, whether a car still
// competes in the session: `competing`, `retired` (with its cause), `disqualified`, `absent`. Shared by every weekend
// phase. It is the one decider of which cars are in the session (C43): a slot is `absent` while no car of the session
// holds it (`isActiveCar` over `slotsInUse`, from the signals `resultStatus` and `numActiveCars`); a car is in the session
// while its status is not `absent` (`in-session.ts`, for the readers).
// - A car's first span opens, with `joinedAt`, on the first frame its Participants data is in the live state
//   (`updatedAt.participants`, the identity area); before it nobody knows whether the slot holds a car (C3), so no span
//   opens, `absent` included.
// - Otherwise the status follows `resultStatus` when it changes: active or finished `competing`, retired, did not finish
//   or not classified `retired` (not classified: not yet seen, C19), disqualified `disqualified`.
// - A competing car retires on its earliest signal (C18): a PENA of type 16, an RTMT or the result status. The cause is
//   the one known on the opening frame, never rewritten: the PENA 16 infringement, else the RTMT reason, else
//   `unknown('notReceived')`. An RTMT with reason black flagged disqualifies; finished, session skipped and session
//   simulated change no status. Every RTMT reason but invalid is not yet seen (C19).
// - A disqualification opens unconfirmed and is confirmed by a PENA of type 6 or by 2 s unchanged; a status that changes
//   first closes it `confirmed: false` (C18). The pending confirmation is the span's own open state.
// The facts behind each rule: docs/research/09-situations-inventory.md §2.9, §2.11, §2.12.
import { carId as toCarId, carStatusSpans, known, unknown, type Known, type OpenSpan, type ResultStatus, type RetiredDetail, type SessionTime } from '@pitwall/domain';
import type { RetirementReason, SituationEvent } from '../../signals/types.ts';
import type { DeepReadonly } from '../../util/deep-readonly.ts';
import type { MachineStep, SubMachine } from '../machine.ts';
import { isActiveCar, slotsInUse } from './slots.ts';

type Kind = 'competing' | 'retired' | 'disqualified' | 'absent';
type Cause = RetiredDetail['cause'];

/** How long a disqualification holds unchanged before it counts as confirmed, without a PENA of type 6. */
export const DSQ_CONFIRM_MS = 2000;
/** The PENA types that retire and disqualify a car. */
const RETIRED_PENALTY = 16;
const DISQUALIFIED_PENALTY = 6;

/** The status a result status stands for. */
const KIND_OF_RESULT: Readonly<Record<ResultStatus, Kind>> = {
  invalid: 'absent',
  inactive: 'absent',
  active: 'competing',
  finished: 'competing',
  retired: 'retired',
  didNotFinish: 'retired',
  notClassified: 'retired',
  disqualified: 'disqualified',
};

/** The status an RTMT reason gives a competing car; none for a reason that changes no status. */
const KIND_OF_REASON: Readonly<Record<RetirementReason, Kind | undefined>> = {
  invalid: 'retired',
  retired: 'retired',
  finished: undefined,
  terminalDamage: 'retired',
  inactive: 'retired',
  notEnoughLapsCompleted: 'retired',
  blackFlagged: 'disqualified',
  redFlagged: 'retired',
  mechanicalFailure: 'retired',
  sessionSkipped: undefined,
  sessionSimulated: undefined,
};

type CauseValue = Cause extends Known<infer T> ? T : never;

/** The cause an RTMT reason gives; none for invalid and the reasons that do not retire. */
const CAUSE_OF_REASON: Readonly<Partial<Record<RetirementReason, CauseValue>>> = {
  mechanicalFailure: 'mechanical',
  terminalDamage: 'terminalDamage',
  retired: 'other',
  notEnoughLapsCompleted: 'other',
  redFlagged: 'other',
  inactive: 'other',
};

/** The cause a PENA 16 infringement gives. */
const causeOfInfringement = (infringement: number): CauseValue =>
  infringement === 41 ? 'mechanical' : infringement === 42 ? 'terminalDamage' : 'other';

type Pena = Extract<SituationEvent, { code: 'PENA' }>;
type Rtmt = Extract<SituationEvent, { code: 'RTMT' }>;
/** The frame's events about one car that car-status reads. */
type CarEvents = { retiredPena: Pena | undefined; disqualifiedPena: boolean; rtmt: Rtmt | undefined };

const carEventsOf = (events: DeepReadonly<SituationEvent[]>, index: number): CarEvents => {
  const own = events.filter((e) => 'carId' in e && e.carId === index);
  return {
    retiredPena: own.find((e): e is Pena => e.code === 'PENA' && e.penaltyType === RETIRED_PENALTY),
    disqualifiedPena: own.some((e) => e.code === 'PENA' && e.penaltyType === DISQUALIFIED_PENALTY),
    rtmt: own.find((e): e is Rtmt => e.code === 'RTMT'),
  };
};

/** The cause as known on this frame: the PENA 16 infringement, else the RTMT reason, else not received. */
const causeOf = (events: CarEvents, at: SessionTime): Cause => {
  if (events.retiredPena !== undefined) return known(causeOfInfringement(events.retiredPena.infringementType), at);
  const value = events.rtmt === undefined ? undefined : CAUSE_OF_REASON[events.rtmt.reason];
  return value === undefined ? unknown('notReceived') : known(value, at);
};

/** The status the frame's events give a competing car: a PENA 16 retires it, an RTMT as its reason says. */
const kindOfEvents = (events: CarEvents): Kind | undefined => {
  if (events.retiredPena !== undefined) return 'retired';
  return events.rtmt === undefined ? undefined : KIND_OF_REASON[events.rtmt.reason];
};

type Held = { id: number; kind: Kind; start: SessionTime; startFrame: number; confirmed: boolean; detail: RetiredDetail | undefined; joinedAt?: true };
/** Per car slot: the open span, the spans the car has had, and the result status of the frame before. */
type CarOpen = { held: Held; opened: number; resultStatus: ResultStatus };
type Open = { cars: Array<CarOpen | undefined> };

/** The status of a slot on this frame given the one before (`before` undefined on its first span). */
const nextKind = (before: CarOpen | undefined, active: boolean, resultStatus: ResultStatus, events: CarEvents): Kind => {
  if (!active) return 'absent';
  const byResult = KIND_OF_RESULT[resultStatus];
  if (before === undefined || before.held.kind === 'absent') return byResult;
  if (resultStatus !== before.resultStatus && byResult !== before.held.kind) return byResult;
  if (before.held.kind === 'competing') return kindOfEvents(events) ?? 'competing';
  return before.held.kind;
};

const toOpenSpan = (held: Held, index: number): OpenSpan => ({
  machine: 'car-status',
  id: held.id,
  carId: toCarId(index),
  kind: held.kind,
  start: held.start,
  startFrame: held.startFrame,
  confirmed: held.confirmed,
  detail: held.detail,
  ...(held.joinedAt ? { joinedAt: true as const } : {}),
});

const machine: SubMachine<Open> = {
  id: 'car-status',
  appliesTo: 'all',
  spans: carStatusSpans,
  inputs: { signals: ['resultStatus', 'numActiveCars', 'events'], values: ['identity'], upstream: [] },
  transitions: [
    ['none', 'competing'],
    ['none', 'retired'],
    ['none', 'disqualified'],
    ['none', 'absent'],
    ['competing', 'retired'],
    ['competing', 'disqualified'],
    ['competing', 'absent'],
    ['retired', 'competing'],
    ['retired', 'disqualified'],
    ['retired', 'absent'],
    ['disqualified', 'competing'],
    ['disqualified', 'retired'],
    ['disqualified', 'absent'],
    ['absent', 'competing'],
    ['absent', 'retired'],
    ['absent', 'disqualified'],
  ],
  init: () => ({ cars: [] }),
  openSpans: (open) => open.cars.flatMap((car, index): OpenSpan[] => (car === undefined ? [] : [toOpenSpan(car.held, index)])),
  step(open, input): MachineStep<Open> {
    const { signals, at, frameNumber } = input;
    const closed: MachineStep<Open>['closed'] = [];
    const slots = slotsInUse({ cars: signals.cars.map((c) => ({ timing: { resultStatus: c.resultStatus } })), session: signals.session });
    const cars = signals.cars.map((car, index): CarOpen | undefined => {
      const before = open.cars[index];
      if (before === undefined && input.live.cars[index]?.updatedAt.participants === undefined) return undefined;
      const events = carEventsOf(signals.events, index);
      const kind = nextKind(before, isActiveCar(index, slots, car.resultStatus), car.resultStatus, events);
      if (before !== undefined && kind === before.held.kind) {
        const confirms = !before.held.confirmed && (events.disqualifiedPena || at - before.held.start >= DSQ_CONFIRM_MS);
        return { held: confirms ? { ...before.held, confirmed: true } : before.held, opened: before.opened, resultStatus: car.resultStatus };
      }
      if (before !== undefined) closed.push({ ...toOpenSpan(before.held, index), end: at });
      const id = before?.opened ?? 0;
      const held: Held = {
        id,
        kind,
        start: at,
        startFrame: frameNumber,
        confirmed: kind !== 'disqualified' || events.disqualifiedPena,
        detail: kind === 'retired' ? { cause: causeOf(events, at) } : undefined,
        ...(before === undefined ? { joinedAt: true as const } : {}),
      };
      return { held, opened: id + 1, resultStatus: car.resultStatus };
    });
    return { open: { cars }, closed };
  },
};

export default machine;
