// The warnings sub-machine (contract C9, C12, C15, C17, C18): per car, `noWarning` until the first warning and then one
// `warned` span per count. A span opens whenever `totalWarnings` changes, on the frame of the change; the PENA (type 5)
// that explains a rise arrives on the frame of the rise or up to 16 frames before it (the order the recordings show), so
// it waits in the open state until the rise takes it (used once). A span is never withdrawn or rewritten (C18).
// `cornerCuttingWarnings` is declared as an input: the game counts those warnings inside `totalWarnings`.
import { known, unknown, warningsSpans, type CarId, type Known, type OpenSpan, type SessionTime, type WarnedDetail } from '@pitwall/domain';
import type { MachineStep, SubMachine } from '../machine.ts';

/** How many frames a PENA waits for the rise it explains (the longest gap the recordings show). */
export const PENDING_FRAMES = 16;
/** The PENA type of a warning. */
const WARNING_PENALTY = 5;

type Pending = { infringement: number; at: SessionTime; frameNumber: number };
type Held = { id: number; kind: 'noWarning' | 'warned'; start: SessionTime; startFrame: number; detail: object; joinedAt?: true };
type CarOpen = { span: Held; count: number; pending: Pending | undefined };
type Open = { cars: CarOpen[] };

const opened = (id: number, count: number, at: SessionTime, frameNumber: number, infringement: Known<number>, joinedAt: boolean): Held => ({
  id,
  kind: count === 0 ? 'noWarning' : 'warned',
  start: at,
  startFrame: frameNumber,
  detail: count === 0 ? {} : ({ count, infringement } satisfies WarnedDetail),
  ...(joinedAt ? { joinedAt: true as const } : {}),
});

const machine: SubMachine<Open> = {
  id: 'warnings',
  appliesTo: 'all',
  spans: warningsSpans,
  inputs: { signals: ['events', 'totalWarnings', 'cornerCuttingWarnings'], values: [], upstream: [] },
  transitions: [['none', 'noWarning'], ['none', 'warned'], ['noWarning', 'warned'], ['warned', 'warned'], ['warned', 'noWarning']],
  init: () => ({ cars: [] }),
  openSpans: (open) =>
    open.cars.map(({ span }, index): OpenSpan => ({
      machine: 'warnings',
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
      if (car === undefined) return { span: opened(0, signals.totalWarnings, input.at, input.frameNumber, unknown('notReceived'), true), count: signals.totalWarnings, pending: undefined };
      let pending = car.pending;
      for (const event of input.signals.events) {
        if (event.code === 'PENA' && event.carId === index && event.penaltyType === WARNING_PENALTY) {
          pending = { infringement: event.infringementType, at: input.at, frameNumber: input.frameNumber };
        }
      }
      if (pending !== undefined && input.frameNumber - pending.frameNumber > PENDING_FRAMES) pending = undefined;
      if (signals.totalWarnings === car.count) return { span: car.span, count: car.count, pending };
      const rise = signals.totalWarnings > car.count;
      closed.push({
        machine: 'warnings',
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
      const infringement = rise && pending !== undefined ? known(pending.infringement, pending.at) : unknown('notReceived');
      return {
        span: opened(car.span.id + 1, signals.totalWarnings, input.at, input.frameNumber, infringement, false),
        count: signals.totalWarnings,
        pending: rise ? undefined : pending,
      };
    });
    return { open: { cars }, closed };
  },
};

export default machine;
