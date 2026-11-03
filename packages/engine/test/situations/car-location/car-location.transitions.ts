// The car-location transition table (contract C15, C17, C85): per car, where it physically is, from the signals
// `driverStatus` and `pitStatus` alone. `garage` while the driver status is in the garage (ds 0), whatever the pit status
// (inventory §2.1: some cars show ps 0 in the garage); otherwise `pitLane` while the pit status is pitting or in the pit
// area (ps 1, 2); otherwise `track`. A car has a span from the session's first frame on (lane-common: every car slot),
// so `none -> <kind>` is the first frame (a join row: the span has `joinedAt`, Review Focus 2); after it every change
// of the car's location closes its span and opens the next. No kind goes to `none`. The declared transitions:
//   none -> garage      the session's first frame, a car in the garage (join; every slot before its first LapData)
//   none -> pitLane     the session's first frame, a car in the pit lane (join)
//   none -> track       the session's first frame, a car on track (join)
//   garage -> pitLane   leaving the garage: ds 0 -> 3 with ps still 1 (§2.2; MiP 641.422)
//   garage -> track     leaving the garage under time acceleration: ds 0 -> 3 and ps 1 -> 0 in one frame (§2.2; SgQ 138.968)
//   pitLane -> track    the pit exit: ps 1 -> 0 (§2.2, §2.5; MiP 649.872)
//   pitLane -> garage   into the garage box: ds 2 -> 0 (after one frame of ps 2, or with ps staying 1) (§2.1, §2.3; MiP 542.879)
//   track -> pitLane    the pit entry: ps 0 -> 1 (§2.3, §2.5; ZvR2 548.387)
//   track -> garage     a teleport into the garage: ds -> 0 with no pit-lane passage (§2.4: the player's return to the
//                       garage, AI in-laps under time acceleration, a retired car about 70 s after its retirement)
import type { DriverStatus, PitStatus } from '@pitwall/domain';
import type { MachineInput } from '../../../src/situations/machine.ts';
import machine from '../../../src/situations/car-location/machine.ts';
import { car } from '../../support/car-edits.ts';
import { defineTransitionTable, inputs, type InputEdit, type TransitionRow } from '../../support/transition-table.ts';

/** Car `index` shows driver status `ds` and pit status `ps` from this frame on. */
export const at = (index: number, driverStatus: DriverStatus, pitStatus: PitStatus): InputEdit => car(index, { driverStatus, pitStatus });

/** Car 0 in the garage, in the pit lane on its out lap, on track on a flying lap. */
export const inGarage = at(0, 'inGarage', 'pitting');
export const outOfGarage = at(0, 'outLap', 'pitting');
export const onTrack = at(0, 'flyingLap', 'none');

const rows: TransitionRow<MachineInput>[] = [
  { name: 'the session’s first frame, a car in the garage: garage (join)', from: 'none', to: 'garage', input: inputs().frame(inGarage), join: true },
  { name: 'the session’s first frame, a car in the pit lane: pitLane (join)', from: 'none', to: 'pitLane', input: inputs().frame(outOfGarage), join: true },
  { name: 'the session’s first frame, a car on track: track (join)', from: 'none', to: 'track', input: inputs().frame(onTrack), join: true },
  {
    name: 'leaving the garage, ds 0 -> 3 with ps still 1 (MiP 641.422): garage -> pitLane',
    from: 'garage',
    to: 'pitLane',
    input: inputs().frames(3, inGarage).frame(outOfGarage),
  },
  {
    name: 'leaving the garage under time acceleration, ds 0 -> 3 and ps 1 -> 0 in one frame (SgQ 138.968): garage -> track',
    from: 'garage',
    to: 'track',
    input: inputs().frames(3, inGarage).frame(at(0, 'outLap', 'none')),
  },
  {
    name: 'the pit exit, ps 1 -> 0 (MiP 649.872): pitLane -> track',
    from: 'pitLane',
    to: 'track',
    input: inputs().frames(3, inGarage).frames(3, outOfGarage).frame(at(0, 'outLap', 'none')),
  },
  {
    name: 'into the garage box, one frame of ps 2, then ds 2 -> 0 with ps 2 -> 1 (MiP 542.845 / 542.879): pitLane -> garage',
    from: 'pitLane',
    to: 'garage',
    input: inputs().frames(3, at(0, 'inLap', 'pitting')).frame(at(0, 'inLap', 'inPitArea')).frame(at(0, 'inGarage', 'pitting')),
  },
  {
    name: 'into the garage box with ps staying 1 and no ps 2 (SgQ car 1 at 332.118): pitLane -> garage',
    from: 'pitLane',
    to: 'garage',
    input: inputs().frames(3, at(0, 'inLap', 'pitting')).frame(at(0, 'inGarage', 'pitting')),
  },
  {
    name: 'the pit entry, ps 0 -> 1 on the in lap (ZvR2 548.387): track -> pitLane',
    from: 'track',
    to: 'pitLane',
    input: inputs().frames(3, at(0, 'inLap', 'none')).frame(at(0, 'inLap', 'pitting')),
  },
  {
    name: 'the player’s return to the garage mid-lap, ds 1 -> 0 with ps 0 (SgQ 467.514): track -> garage',
    from: 'track',
    to: 'garage',
    input: inputs().frames(3, onTrack).frame(at(0, 'inGarage', 'none')),
  },
  {
    name: 'an AI in-lap teleported into the garage, ds 2 -> 0 and ps 0 -> 1 in one frame (SgQ, MiP): track -> garage',
    from: 'track',
    to: 'garage',
    input: inputs().frames(3, at(0, 'inLap', 'none')).frame(inGarage),
  },
  {
    name: 'a retired car put into the garage, ds 4 -> 0 with ps 0 -> 1 (MxR car 2 at 272.748): track -> garage',
    from: 'track',
    to: 'garage',
    input: inputs().frames(3, at(0, 'onTrack', 'none')).frame(inGarage),
  },
];

export default defineTransitionTable(machine, rows);
