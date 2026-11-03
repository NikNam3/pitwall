// The practice race-control sub-machine's transition table (contract C14, C15, C17, C85): one session-scoped `drsFree` span
// for the whole session (DRS is free to use in practice; the game sends neither DRSE nor DRSD there). It opens on the first
// frame the weekend phase is decided and no signal tells whether the session was joined, so the span is joined (`joinedAt`,
// as the car-flags spans are): `none -> drsFree` is its one transition, a join row.
import type { MachineInput } from '../../../src/situations/machine.ts';
import machine from '../../../src/situations/race-control-practice/machine.ts';
import { inPhase, PRACTICE } from '../session-phase/inputs.ts';
import { defineTransitionTable, inputs, type TransitionRow } from '../../support/transition-table.ts';

export const phase = inPhase(PRACTICE);

const rows: TransitionRow<MachineInput>[] = [
  { name: 'the first frame of the practice session: drsFree (join)', from: 'none', to: 'drsFree', input: inputs().frame(phase), join: true },
];

export default defineTransitionTable(machine, rows);
