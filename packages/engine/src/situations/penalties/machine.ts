// The penalties sub-machine (contract C9, C12, C15, C17, C18, C19, C26): per car, race only, one span for what the car
// owes now: `clear`, `timePenalty` (`{ totalMs }`), `driveThroughPending` or `stopGoPending` (`{ driveThroughs, stopGos,
// infringement, totalMs }`), named after the oldest unserved penalty. A new span on every change of what it owes. The
// unserved counts decide: a rise queues a penalty (a drive-through before a stop-go on one frame), taking the infringement
// of the oldest unused PENA of its type (type 0 drive-through, 1 stop-go) of the same frame or up to PENDING_FRAMES
// before; a fall serves the oldest of its type. DTSV and SGSV are never read: they open, close and rewrite nothing (C18).
// It reads the weekend phase as upstream (C14): it runs from the frame the phase is decided on.
// Stop-gos and both kinds at once are not yet seen in any recording (C19): implemented from the game's spec.
import { known, unknown, type CarId, type Known, type OpenSpan, type PendingPenaltyDetail, penaltiesSpans, type SessionTime, type TimePenaltyDetail } from '@pitwall/domain';
import type { MachineStep, SubMachine } from '../machine.ts';

/** How many frames a PENA waits for the rise it explains. */
export const PENDING_FRAMES = 16;
/** The PENA types that give a penalty to serve. */
const DRIVE_THROUGH = 0;
const STOP_GO = 1;

type Kind = 'clear' | 'timePenalty' | 'driveThroughPending' | 'stopGoPending';
type Pena = { type: number; infringement: number; at: SessionTime; frameNumber: number };
type Owed = { type: 'dt' | 'sg'; infringement: Known<number> };
type Held = { id: number; kind: Kind; key: string; start: SessionTime; startFrame: number; detail: object; joinedAt?: true };
type CarOpen = { span: Held; dt: number; sg: number; queue: Owed[]; penas: Pena[] };
type Open = { cars: CarOpen[] };

const take = (penas: Pena[], type: number): Known<number> => {
  const index = penas.findIndex((p) => p.type === type);
  const pena = penas[index];
  if (pena === undefined) return unknown('notReceived');
  penas.splice(index, 1);
  return known(pena.infringement, pena.at);
};

const describe = (queue: Owed[], dt: number, sg: number, totalMs: number): { kind: Kind; detail: object } => {
  const head = queue[0];
  if (dt === 0 && sg === 0) return totalMs === 0 ? { kind: 'clear', detail: {} } : { kind: 'timePenalty', detail: { totalMs } satisfies TimePenaltyDetail };
  const detail: PendingPenaltyDetail = { driveThroughs: dt, stopGos: sg, infringement: head?.infringement ?? unknown('notReceived'), totalMs };
  const named = head?.type ?? (dt > 0 ? 'dt' : 'sg');
  return { kind: named === 'dt' ? 'driveThroughPending' : 'stopGoPending', detail };
};

const opened = (id: number, queue: Owed[], dt: number, sg: number, totalMs: number, at: SessionTime, frameNumber: number, joined: boolean): Held => {
  const { kind, detail } = describe(queue, dt, sg, totalMs);
  return { id, kind, key: kind + JSON.stringify(detail), start: at, startFrame: frameNumber, detail, ...(joined ? { joinedAt: true as const } : {}) };
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
  openSpans: (open) =>
    open.cars.map(({ span }, index): OpenSpan => ({
      machine: 'penalties',
      id: span.id,
      carId: index as CarId,
      kind: span.kind,
      start: span.start,
      startFrame: span.startFrame,
      confirmed: true,
      detail: span.detail,
      ...(span.joinedAt ? { joinedAt: true as const } : {}),
    })),
  step(open, input): MachineStep<Open> {
    const closed: MachineStep<Open>['closed'] = [];
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
        return { span: opened(0, queue, dt, sg, totalMs, input.at, input.frameNumber, true), dt, sg, queue, penas: [] };
      }
      const penas = car.penas.filter((p) => input.frameNumber - p.frameNumber <= PENDING_FRAMES);
      for (const event of input.signals.events) {
        if (event.code === 'PENA' && event.carId === index && (event.penaltyType === DRIVE_THROUGH || event.penaltyType === STOP_GO)) {
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
      const current = describe(queue, dt, sg, totalMs);
      if (car.span.key === current.kind + JSON.stringify(current.detail)) return { span: car.span, dt, sg, queue, penas };
      closed.push({
        machine: 'penalties',
        id: car.span.id,
        carId: index as CarId,
        kind: car.span.kind,
        start: car.span.start,
        end: input.at,
        startFrame: car.span.startFrame,
        confirmed: true,
        detail: car.span.detail,
        ...(car.span.joinedAt ? { joinedAt: true as const } : {}),
      });
      return { span: opened(car.span.id + 1, queue, dt, sg, totalMs, input.at, input.frameNumber, false), dt, sg, queue, penas };
    });
    return { open: { cars }, closed };
  },
};

export default machine;
