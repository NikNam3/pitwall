// The car-driver sub-machine (contract C3, C9, C12, C13, C15, C17, C18, C19, C26): per car slot, who drives the car, the
// AI (`ai`) or a human (`human`), from the `aiControlled` signal alone. A new span on every flip, none withdrawn (C18);
// spans carry no detail. Shared by every weekend phase. The signal defaults to `true` before any Participants packet, so
// a car's first span opens, with `joinedAt`, on the first frame its Participants data is in the live state
// (`updatedAt.participants`, the identity area), and only while a car of the session holds the slot (car-status's rule,
// `slotsInUse`, from the signals `resultStatus` and `numActiveCars`): the game's empty slots read `aiControlled` 0. A
// takeover (`ai -> human`, `human -> ai`) is known only from the game's spec (C19). The facts behind the rule:
// docs/research/10-situations-catalogue.md, "car-driver".
import { carDriverSpans, carId as toCarId, type FrameNumber, type OpenSpan, type SessionTime } from '@pitwall/domain';
import type { MachineStep, SubMachine } from '../machine.ts';
import { sameEntries } from '../same-entries.ts';
import { slotsInUse } from '../car-status/slots.ts';

type Kind = 'ai' | 'human';
/** Per car slot: the open span (the same object while it holds, C40) and how many spans the car has had. */
type Open = { cars: Array<{ span: OpenSpan; opened: number } | undefined> };

const opening = (id: number, index: number, kind: Kind, start: SessionTime, startFrame: FrameNumber, joined: boolean): OpenSpan => ({
  machine: 'car-driver',
  id,
  carId: toCarId(index),
  kind,
  start,
  startFrame,
  confirmed: true,
  detail: undefined,
  ...(joined ? { joinedAt: true as const } : {}),
});

const machine: SubMachine<Open> = {
  id: 'car-driver',
  appliesTo: 'all',
  spans: carDriverSpans,
  inputs: { signals: ['aiControlled', 'resultStatus', 'numActiveCars'], values: ['identity'], upstream: [] },
  transitions: [
    ['none', 'ai'],
    ['none', 'human'],
    ['ai', 'human'],
    ['human', 'ai'],
  ],
  init: () => ({ cars: [] }),
  openSpans: (open) => open.cars.flatMap((car): OpenSpan[] => (car === undefined ? [] : [car.span])),
  step(open, input): MachineStep<Open> {
    const closed: MachineStep<Open>['closed'] = [];
    let slots: number | undefined;
    const cars = input.signals.cars.map((signals, index) => {
      const before = open.cars[index];
      if (before === undefined) {
        if (input.live.cars[index]?.updatedAt.participants === undefined) return undefined;
        slots ??= slotsInUse(input.signals);
        if (index >= slots) return undefined;
      }
      const kind: Kind = signals.aiControlled ? 'ai' : 'human';
      if (before !== undefined && before.span.kind === kind) return before;
      if (before !== undefined) closed.push({ ...before.span, end: input.at });
      const id = before?.opened ?? 0;
      return { span: opening(id, index, kind, input.at, input.frameNumber, before === undefined), opened: id + 1 };
    });
    return { open: sameEntries(open.cars, cars) ? open : { cars }, closed };
  },
};

export default machine;
