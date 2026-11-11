// The penalties sub-machine (contract C9, C12, C15, C17, C18, C19, C26): per car, race only, one span for what the car
// owes now: `clear`, `timePenalty` (`{ totalMs, infringement }`), `driveThroughPending` or `stopGoPending`
// (`{ driveThroughs, stopGos, infringement, totalMs }`), named after the oldest unserved penalty. A new span on every
// change of what it owes. The unserved counts decide: a rise queues a penalty (a drive-through before a stop-go on one
// frame), taking the infringement of the oldest unused PENA of its type (type 0 drive-through, 1 stop-go) of the same
// frame or up to PENDING_FRAMES before; a fall serves the oldest of its type. A rise of the time penalties' total takes
// the infringement of a PENA of type 4 the same way; a `timePenalty` span names it while that total stands. DTSV and SGSV are never read: they open, close and rewrite nothing (C18).
// It reads the weekend phase as upstream (C14): it runs from the frame the phase is decided on.
// Stop-gos and both kinds at once are not yet seen in any recording (C19): implemented from the game's spec.
import { known, unknown, type CarId, type FrameNumber, type Known, type OpenSpan, type PendingPenaltyDetail, penaltiesSpans, type SessionTime, type TimePenaltyDetail } from '@pitwall/domain';
import type { MachineStep, SubMachine } from '../machine.ts';
import { sameEntries } from '../same-entries.ts';

/** How many frames a PENA waits for the rise it explains. */
export const PENDING_FRAMES = 16;
/** The PENA types that give a penalty to serve. */
const DRIVE_THROUGH = 0;
const STOP_GO = 1;
/** The PENA type of a time penalty. */
const TIME_PENALTY = 4;
const WAITING_TYPES: ReadonlySet<number> = new Set([DRIVE_THROUGH, STOP_GO, TIME_PENALTY]);

type Kind = 'clear' | 'timePenalty' | 'driveThroughPending' | 'stopGoPending';
type Pena = { type: number; infringement: number; at: SessionTime; frameNumber: number };
type Owed = { type: 'dt' | 'sg'; infringement: Known<number> };
/**
 * Per car slot: the open span (the same object while it holds, C40) and its key (kind and detail), the unserved counts
 * and the time penalties' total of the frame before, the penalties owed in order, the infringement of the PENA that
 * last raised the total, and the PENAs waiting for a rise.
 */
type CarOpen = { span: OpenSpan; key: string; dt: number; sg: number; totalMs: number; queue: Owed[]; timeInfringement: Known<number>; penas: Pena[] };
type Open = { cars: CarOpen[] };

const take = (penas: Pena[], type: number): Known<number> => {
  const index = penas.findIndex((p) => p.type === type);
  const pena = penas[index];
  if (pena === undefined) return unknown('notReceived');
  penas.splice(index, 1);
  return known(pena.infringement, pena.at);
};

const describe = (queue: Owed[], dt: number, sg: number, totalMs: number, timeInfringement: Known<number>): { kind: Kind; detail: object } => {
  const head = queue[0];
  if (dt === 0 && sg === 0) {
    return totalMs === 0 ? { kind: 'clear', detail: {} } : { kind: 'timePenalty', detail: { totalMs, infringement: timeInfringement } satisfies TimePenaltyDetail };
  }
  const detail: PendingPenaltyDetail = { driveThroughs: dt, stopGos: sg, infringement: head?.infringement ?? unknown('notReceived'), totalMs };
  const named = head?.type ?? (dt > 0 ? 'dt' : 'sg');
  return { kind: named === 'dt' ? 'driveThroughPending' : 'stopGoPending', detail };
};

/** A span's key: its kind and detail, which a new span opens on every change of (C18). */
const keyOf = (described: { kind: Kind; detail: object }): string => described.kind + JSON.stringify(described.detail);

const opened = (id: number, index: number, described: { kind: Kind; detail: object }, at: SessionTime, frameNumber: FrameNumber, joined: boolean): Pick<CarOpen, 'span' | 'key'> => {
  const { kind, detail } = described;
  const span: OpenSpan = { machine: 'penalties', id, carId: index as CarId, kind, start: at, startFrame: frameNumber, confirmed: true, detail, ...(joined ? { joinedAt: true as const } : {}) };
  return { span, key: keyOf(described) };
};

const machine: SubMachine<Open> = {
  id: 'penalties',
  appliesTo: ['race'],
  spans: penaltiesSpans,
  inputs: { signals: ['events', 'unservedDriveThroughs', 'unservedStopGos', 'timePenaltyMs'], values: [], upstream: ['weekend-phase'] },
  transitions: (['clear', 'timePenalty', 'driveThroughPending', 'stopGoPending'] as const).flatMap((to) => [
    ['none', to] as const,
    ...(['clear', 'timePenalty', 'driveThroughPending', 'stopGoPending'] as const).filter((from) => !(from === 'clear' && to === 'clear')).map((from) => [from, to] as const),
  ]),
  init: () => ({ cars: [] }),
  openSpans: (open) => open.cars.map(({ span }) => span),
  step(open, input): MachineStep<Open> {
    const closed: MachineStep<Open>['closed'] = [];
    const waiting = (p: Pena): boolean => input.frameNumber - p.frameNumber <= PENDING_FRAMES;
    const cars = input.signals.cars.map((signals, index): CarOpen => {
      const car = open.cars[index];
      const dt = signals.unservedDriveThroughs;
      const sg = signals.unservedStopGos;
      const totalMs = signals.timePenaltyMs;
      if (car === undefined) {
        const queue: Owed[] = [
          ...Array.from({ length: dt }, (): Owed => ({ type: 'dt', infringement: unknown('notReceived') })),
          ...Array.from({ length: sg }, (): Owed => ({ type: 'sg', infringement: unknown('notReceived') })),
        ];
        const timeInfringement = unknown('notReceived');
        return { ...opened(0, index, describe(queue, dt, sg, totalMs, timeInfringement), input.at, input.frameNumber, true), dt, sg, totalMs, queue, timeInfringement, penas: [] };
      }
      const penaOfCar = input.signals.events.length > 0 && input.signals.events.some((event) => event.code === 'PENA' && event.carId === index && WAITING_TYPES.has(event.penaltyType));
      // Nothing changed for the car: what it owes stands, and so does its entry.
      if (dt === car.dt && sg === car.sg && totalMs === car.totalMs && !penaOfCar && car.penas.every(waiting)) return car;
      const penas = car.penas.filter(waiting);
      for (const event of input.signals.events) {
        if (event.code === 'PENA' && event.carId === index && WAITING_TYPES.has(event.penaltyType)) {
          penas.push({ type: event.penaltyType, infringement: event.infringementType, at: input.at, frameNumber: input.frameNumber });
        }
      }
      const queue = [...car.queue];
      const serve = (type: 'dt' | 'sg') => {
        const at = queue.findIndex((o) => o.type === type);
        if (at >= 0) queue.splice(at, 1);
      };
      for (let n = car.dt; n > dt; n--) serve('dt');
      for (let n = car.sg; n > sg; n--) serve('sg');
      // A rise queues after what is already owed: the drive-throughs first (the game lists it first).
      for (let n = car.dt; n < dt; n++) queue.push({ type: 'dt', infringement: take(penas, DRIVE_THROUGH) });
      for (let n = car.sg; n < sg; n++) queue.push({ type: 'sg', infringement: take(penas, STOP_GO) });
      const timeInfringement = totalMs > car.totalMs ? take(penas, TIME_PENALTY) : car.timeInfringement;
      const current = describe(queue, dt, sg, totalMs, timeInfringement);
      const kept = { dt, sg, totalMs, queue, timeInfringement, penas };
      if (car.key === keyOf(current)) return { span: car.span, key: car.key, ...kept };
      closed.push({ ...car.span, end: input.at });
      return { ...opened(car.span.id + 1, index, current, input.at, input.frameNumber, false), ...kept };
    });
    return { open: sameEntries(open.cars, cars) ? open : { cars }, closed };
  },
};

export default machine;
