// The car-flags sub-machine (contract C9, C15, C17, C18): per car, the flag race control shows it (signal `fiaFlag`), one
// span per flag: a new span on every change. Every car slot has a span from the session's first frame on. Shared.
import { carFlagsSpans, carId as toCarId, type OpenSpan } from '@pitwall/domain';
import { FLAG_TRANSITIONS, flagKind } from '../flag-kind.ts';
import type { MachineStep, SubMachine } from '../machine.ts';

/** Per car slot: the open span (the same object while it holds, C40) and how many spans the car has had. */
type Open = { cars: Array<{ span: OpenSpan; opened: number } | undefined> };

const machine: SubMachine<Open> = {
  id: 'car-flags',
  appliesTo: 'all',
  spans: carFlagsSpans,
  inputs: { signals: ['fiaFlag'], values: [], upstream: [] },
  transitions: FLAG_TRANSITIONS,
  init: () => ({ cars: [] }),
  openSpans: (open) => open.cars.flatMap((car): OpenSpan[] => (car === undefined ? [] : [car.span])),
  step(open, input): MachineStep<Open> {
    const first = open.cars.length === 0;
    const closed: MachineStep<Open>['closed'] = [];
    const cars = input.signals.cars.map((signals, carId) => {
      const kind = flagKind(signals.fiaFlag);
      const before = open.cars[carId];
      if (before !== undefined && before.span.kind === kind) return before;
      if (before !== undefined) closed.push({ ...before.span, end: input.at });
      const id = before === undefined ? 0 : before.opened;
      const span: OpenSpan = { machine: 'car-flags', id, carId: toCarId(carId), kind, start: input.at, startFrame: input.frameNumber, confirmed: true, detail: undefined, ...(first ? { joinedAt: true as const } : {}) };
      return { span, opened: id + 1 };
    });
    return { open: { cars }, closed };
  },
};

export default machine;
