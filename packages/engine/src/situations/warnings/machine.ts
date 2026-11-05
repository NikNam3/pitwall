// The warnings sub-machine (contract C9, C12, C15, C17, C18): per car, `noWarning` until the first warning and then one
// `warned` span per count. A span opens whenever `totalWarnings` changes, on the frame of the change; the PENA (type 5)
// that explains a rise arrives on the frame of the rise or up to 16 frames before it (the order the recordings show), so
// it waits in the open state until the rise takes it (used once). A span is never withdrawn or rewritten (C18).
// `cornerCuttingWarnings` is an input: the game counts those warnings inside `totalWarnings`; every `warned` span records it
// (`cornerCutting`) on the frame it opens.
import { known, unknown, warningsSpans, type CarId, type FrameNumber, type Known, type OpenSpan, type SessionTime, type WarnedDetail } from '@pitwall/domain';
import type { MachineStep, SubMachine } from '../machine.ts';

/** How many frames a PENA waits for the rise it explains (the longest gap the recordings show). */
export const PENDING_FRAMES = 16;
/** The PENA type of a warning. */
const WARNING_PENALTY = 5;

type Pending = { infringement: number; at: SessionTime; frameNumber: number };
/** Per car slot: the open span (the same object while it holds, C40), the warning count and a waiting PENA. */
type CarOpen = { span: OpenSpan; count: number; pending: Pending | undefined };
type Open = { cars: CarOpen[] };

const opened = (id: number, index: number, count: number, cornerCutting: number, at: SessionTime, frameNumber: FrameNumber, infringement: Known<number>, joinedAt: boolean): OpenSpan => ({
  machine: 'warnings',
  id,
  carId: index as CarId,
  kind: count === 0 ? 'noWarning' : 'warned',
  start: at,
  startFrame: frameNumber,
  confirmed: true,
  detail: count === 0 ? {} : ({ count, cornerCutting, infringement } satisfies WarnedDetail),
  ...(joinedAt ? { joinedAt: true as const } : {}),
});

const machine: SubMachine<Open> = {
  id: 'warnings',
  appliesTo: 'all',
  spans: warningsSpans,
  inputs: { signals: ['events', 'totalWarnings', 'cornerCuttingWarnings'], values: [], upstream: [] },
  transitions: [['none', 'noWarning'], ['none', 'warned'], ['noWarning', 'warned'], ['warned', 'warned'], ['warned', 'noWarning']],
  init: () => ({ cars: [] }),
  openSpans: (open) => open.cars.map(({ span }) => span),
  step(open, input): MachineStep<Open> {
    const closed: MachineStep<Open>['closed'] = [];
    const cars = input.signals.cars.map((signals, index): CarOpen => {
      const car = open.cars[index];
      if (car === undefined) return { span: opened(0, index, signals.totalWarnings, signals.cornerCuttingWarnings, input.at, input.frameNumber, unknown('notReceived'), true), count: signals.totalWarnings, pending: undefined };
      let pending = car.pending;
      for (const event of input.signals.events) {
        if (event.code === 'PENA' && event.carId === index && event.penaltyType === WARNING_PENALTY) {
          pending = { infringement: event.infringementType, at: input.at, frameNumber: input.frameNumber };
        }
      }
      if (pending !== undefined && input.frameNumber - pending.frameNumber > PENDING_FRAMES) pending = undefined;
      if (signals.totalWarnings === car.count) return { span: car.span, count: car.count, pending };
      const rise = signals.totalWarnings > car.count;
      closed.push({ ...car.span, end: input.at });
      const infringement = rise && pending !== undefined ? known(pending.infringement, pending.at) : unknown('notReceived');
      return {
        span: opened(car.span.id + 1, index, signals.totalWarnings, signals.cornerCuttingWarnings, input.at, input.frameNumber, infringement, false),
        count: signals.totalWarnings,
        pending: rise ? undefined : pending,
      };
    });
    return { open: { cars }, closed };
  },
};

export default machine;
