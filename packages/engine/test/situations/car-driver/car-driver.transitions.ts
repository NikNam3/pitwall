// The car-driver transition table (contract C15, C17, C18, C19, C85): per car, who drives it, the AI or a human, from the
// `aiControlled` signal. The signal defaults to `true` before any Participants packet, so a car's first span opens on the
// first frame its Participants data is in the live state (`updatedAt.participants`, a value of the identity area) while
// a car of the session holds the slot (car-status's rule, `slotsInUse`: `numActiveCars`, `resultStatus`; ruling R7),
// with `joinedAt` (a join row): `none -> <kind>`. After it every flip of the signal closes the car's span and opens the
// other. No kind goes to `none`. The declared transitions:
//   none -> ai       the first frame with the car's Participants data, the AI driving (join)
//   none -> human    the first frame with the car's Participants data, a human driving (join)
//   ai -> human      a human takes the car over from the AI (online, a driver joining a slot; not yet seen, C19)
//   human -> ai      the AI takes the car over from a human (online, a driver dropping out; not yet seen, C19)
import type { MachineInput } from '../../../src/situations/machine.ts';
import machine from '../../../src/situations/car-driver/machine.ts';
import { all, car, participants } from '../../support/car-edits.ts';
import { defineTransitionTable, inputs, type InputEdit, type TransitionRow } from '../../support/transition-table.ts';

/** Every slot in use by car-status's rule (`slotsInUse`): `numActiveCars` the number of slots; it holds on the frames after it. */
export const allInUse: InputEdit = (input) => {
  input.signals.session.numActiveCars = input.signals.cars.length;
};

/** Car `index` driven by the AI (`ai`) or a human from this frame on, the Participants data in (`participants`), every slot in use. */
export const drivenBy = (index: number, ai: boolean): InputEdit => all(participants, allInUse, car(index, { aiControlled: ai }));

/** Car 0 driven by the AI, by a human. */
export const byAi = drivenBy(0, true);
export const byHuman = drivenBy(0, false);

const rows: TransitionRow<MachineInput>[] = [
  { name: 'the first frame with Participants data, the AI driving: ai (join)', from: 'none', to: 'ai', input: inputs().frames(2).frame(byAi), join: true },
  { name: 'the first frame with Participants data, a human driving: human (join)', from: 'none', to: 'human', input: inputs().frames(2).frame(byHuman), join: true },
  { name: 'a human takes the car over from the AI (synthetic, not yet seen): ai -> human', from: 'ai', to: 'human', input: inputs().frames(3, byAi).frame(byHuman) },
  { name: 'the AI takes the car over from a human (synthetic, not yet seen): human -> ai', from: 'human', to: 'ai', input: inputs().frames(3, byHuman).frame(byAi) },
];

export default defineTransitionTable(machine, rows);
