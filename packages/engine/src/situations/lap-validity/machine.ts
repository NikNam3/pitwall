// The lap-validity sub-machine (contract C9, C12, C15, C17, C18): per car, `valid` while `currentLapInvalid` is clear and
// `invalid` while it is set. The PENA of types 10-15 (the game's spec: 10, 12 this lap; 11, 13 this and the next; 14, 15
// this and the previous) gives the `reason` and the `scope`; it arrives on the frame the flag rises or a frame before, so
// it waits in the open state until the flag takes it (used once). A flag with no such PENA opens `invalid` with the
// detail unknown(notReceived) (C3); a PENA after the flag never changes the open span (C18).
import { known, lapValiditySpans, unknown, type CarId, type FrameNumber, type InvalidLapDetail, type OpenSpan, type SessionTime } from '@pitwall/domain';
import type { MachineStep, SubMachine } from '../machine.ts';

/** How many frames a PENA waits for the flag it explains. */
export const PENDING_FRAMES = 16;

type Scope = 'this' | 'thisAndNext' | 'thisAndPrevious';
/** The scope of each lap-invalidating penalty type. */
const SCOPES: Record<number, Scope> = { 10: 'this', 11: 'thisAndNext', 12: 'this', 13: 'thisAndNext', 14: 'thisAndPrevious', 15: 'thisAndPrevious' };

type Pending = { infringement: number; scope: Scope; at: SessionTime; frameNumber: number };
/** Per car slot: the open span (the same object while it holds, C40), the flag of the frame before and a waiting PENA. */
type CarOpen = { span: OpenSpan; invalid: boolean; pending: Pending | undefined };
type Open = { cars: CarOpen[] };

const opened = (id: number, index: number, invalid: boolean, at: SessionTime, frameNumber: FrameNumber, pending: Pending | undefined, joinedAt: boolean): OpenSpan => ({
  machine: 'lap-validity',
  id,
  carId: index as CarId,
  kind: invalid ? 'invalid' : 'valid',
  start: at,
  startFrame: frameNumber,
  confirmed: true,
  detail: !invalid
    ? {}
    : ({
        reason: pending ? known(pending.infringement, pending.at) : unknown('notReceived'),
        scope: pending ? known(pending.scope, pending.at) : unknown('notReceived'),
      } satisfies InvalidLapDetail),
  ...(joinedAt ? { joinedAt: true as const } : {}),
});

const machine: SubMachine<Open> = {
  id: 'lap-validity',
  appliesTo: 'all',
  spans: lapValiditySpans,
  inputs: { signals: ['events', 'currentLapInvalid'], values: [], upstream: [] },
  transitions: [['none', 'valid'], ['none', 'invalid'], ['valid', 'invalid'], ['invalid', 'valid']],
  init: () => ({ cars: [] }),
  openSpans: (open) => open.cars.map(({ span }) => span),
  step(open, input): MachineStep<Open> {
    const closed: MachineStep<Open>['closed'] = [];
    const cars = input.signals.cars.map((signals, index): CarOpen => {
      const car = open.cars[index];
      let pending = car?.pending;
      for (const event of input.signals.events) {
        const scope = event.code === 'PENA' ? SCOPES[event.penaltyType] : undefined;
        if (event.code === 'PENA' && event.carId === index && scope !== undefined) {
          pending = { infringement: event.infringementType, scope, at: input.at, frameNumber: input.frameNumber };
        }
      }
      if (pending !== undefined && input.frameNumber - pending.frameNumber > PENDING_FRAMES) pending = undefined;
      const invalid = signals.currentLapInvalid;
      if (car === undefined) return { span: opened(0, index, invalid, input.at, input.frameNumber, pending, true), invalid, pending: invalid ? undefined : pending };
      if (invalid === car.invalid) return { span: car.span, invalid, pending };
      closed.push({ ...car.span, end: input.at });
      return { span: opened(car.span.id + 1, index, invalid, input.at, input.frameNumber, pending, false), invalid, pending: invalid ? undefined : pending };
    });
    return { open: { cars }, closed };
  },
};

export default machine;
