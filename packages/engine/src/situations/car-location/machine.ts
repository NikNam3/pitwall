// The car-location sub-machine (contract C3, C9, C12, C15, C17, C26): per car slot, where the car physically is, from
// the signals `driverStatus` and `pitStatus` alone: `garage` while the driver status is in the garage (some cars show pit
// status none there), otherwise `pitLane` while the pit status is pitting or in the pit area, otherwise `track`. A new
// span on every change of the location, none withdrawn (C18). Shared by every weekend phase. A car's first span opens,
// with `joinedAt`, on the first frame its Participants data is in the live state (`updatedAt.participants`, the identity
// area): before it nobody knows whether the slot holds a car (C3). The facts behind each rule:
// docs/research/09-situations-inventory.md §2.1-2.5.
import { carId as toCarId, carLocationSpans, type DriverStatus, type OpenSpan, type PitStatus, type SessionTime } from '@pitwall/domain';
import type { MachineStep, SubMachine } from '../machine.ts';

type Kind = 'garage' | 'pitLane' | 'track';
type Held = { id: number; kind: Kind; start: SessionTime; startFrame: number; joinedAt?: true };
/** Per car slot: the open span and how many spans the car has had. */
type Open = { cars: Array<{ held: Held; opened: number } | undefined> };

/** Where a car is by its driver and pit status. */
const kindOf = (driverStatus: DriverStatus, pitStatus: PitStatus): Kind => {
  if (driverStatus === 'inGarage') return 'garage';
  return pitStatus === 'none' ? 'track' : 'pitLane';
};

const toOpenSpan = (held: Held, index: number): OpenSpan => ({
  machine: 'car-location',
  id: held.id,
  carId: toCarId(index),
  kind: held.kind,
  start: held.start,
  startFrame: held.startFrame,
  confirmed: true,
  detail: undefined,
  ...(held.joinedAt ? { joinedAt: true as const } : {}),
});

const machine: SubMachine<Open> = {
  id: 'car-location',
  appliesTo: 'all',
  spans: carLocationSpans,
  inputs: { signals: ['driverStatus', 'pitStatus'], values: ['identity'], upstream: [] },
  transitions: [
    ['none', 'garage'],
    ['none', 'pitLane'],
    ['none', 'track'],
    ['garage', 'pitLane'],
    ['garage', 'track'],
    ['pitLane', 'track'],
    ['pitLane', 'garage'],
    ['track', 'pitLane'],
    ['track', 'garage'],
  ],
  init: () => ({ cars: [] }),
  openSpans: (open) => open.cars.flatMap((car, index): OpenSpan[] => (car === undefined ? [] : [toOpenSpan(car.held, index)])),
  step(open, input): MachineStep<Open> {
    const closed: MachineStep<Open>['closed'] = [];
    const cars = input.signals.cars.map((signals, index) => {
      const before = open.cars[index];
      if (before === undefined && input.live.cars[index]?.updatedAt.participants === undefined) return undefined;
      const kind = kindOf(signals.driverStatus, signals.pitStatus);
      if (before !== undefined && before.held.kind === kind) return before;
      if (before !== undefined) closed.push({ ...toOpenSpan(before.held, index), end: input.at });
      const id = before?.opened ?? 0;
      return { held: { id, kind, start: input.at, startFrame: input.frameNumber, ...(before === undefined ? { joinedAt: true as const } : {}) }, opened: id + 1 };
    });
    return { open: { cars }, closed };
  },
};

export default machine;
