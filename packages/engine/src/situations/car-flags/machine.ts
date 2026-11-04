// The car-flags sub-machine (contract C9, C15, C17, C18): per car, the flag race control shows it (signal `fiaFlag`), one
// span per flag: a new span on every change. Every car slot has a span from the session's first frame on. Shared.
import { carFlagsSpans, carId as toCarId, type OpenSpan } from '@pitwall/domain';
import { FLAG_TRANSITIONS, flagKind } from '../flag-kind.ts';
import type { MachineStep, SubMachine } from '../machine.ts';

type Held = { id: number; kind: string; start: number; startFrame: number; joinedAt?: true };
/** Per car slot: the open span and how many spans the car has had. */
type Open = { cars: Array<{ held: Held; opened: number } | undefined> };

const machine: SubMachine<Open> = {
  id: 'car-flags',
  appliesTo: 'all',
  spans: carFlagsSpans,
  inputs: { signals: ['fiaFlag'], values: [], upstream: [] },
  transitions: FLAG_TRANSITIONS,
  init: () => ({ cars: [] }),
  openSpans: (open) =>
    open.cars.flatMap((car, carId): OpenSpan[] =>
      car === undefined ? [] : [{ machine: 'car-flags', id: car.held.id, carId: toCarId(carId), kind: car.held.kind, start: car.held.start, startFrame: car.held.startFrame, confirmed: true, detail: undefined, ...(car.held.joinedAt ? { joinedAt: true as const } : {}) }],
    ),
  step(open, input): MachineStep<Open> {
    const first = open.cars.length === 0;
    const closed: MachineStep<Open>['closed'] = [];
    const cars = input.signals.cars.map((signals, carId) => {
      const kind = flagKind(signals.fiaFlag);
      const before = open.cars[carId];
      if (before !== undefined && before.held.kind === kind) return before;
      if (before !== undefined) closed.push({ machine: 'car-flags', id: before.held.id, carId: toCarId(carId), kind: before.held.kind, start: before.held.start, end: input.at, confirmed: true, detail: undefined, startFrame: before.held.startFrame, ...(before.held.joinedAt ? { joinedAt: true as const } : {}) });
      const id = before === undefined ? 0 : before.opened;
      return { held: { id, kind, start: input.at, startFrame: input.frameNumber, ...(first ? { joinedAt: true as const } : {}) }, opened: id + 1 };
    });
    return { open: { cars }, closed };
  },
};

export default machine;
