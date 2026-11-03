// The lap-validity sub-machine's transition table (contract C15, C17, C18, C85). A car's lap is `valid` or `invalid`
// (detail `{ reason, scope }`) as `currentLapInvalid` says; the declared transitions are
//   none -> valid      the session's first frame, a valid lap (join)
//   none -> invalid    the session's first frame, a lap already invalid (join)
//   valid -> invalid   the flag rises
//   invalid -> valid   the flag clears (at a line, the lap number rising or not)
// Signal orders the recordings show (inventory §2.8): the lap-invalidating PENA (types 10-15) arrives on the frame
// `currentLapInvalid` rises (MiP 12/7, TT 13/26); a flag with no such PENA also occurs (MiR: with a warning 5/28 and a
// time penalty 4/21), and the flag stays set over the next lap after a "this and next" penalty (TT 13/26). The PENA
// waits in the machine's open state (C18), so one that comes a frame before the flag is matched too.
import type { MachineInput } from '../../../src/situations/machine.ts';
import machine from '../../../src/situations/lap-validity/machine.ts';
import { all, car, events, pena } from '../../support/car-edits.ts';
import { defineTransitionTable, inputs, type TransitionRow } from '../../support/transition-table.ts';

/** Car 0's `currentLapInvalid` from this frame on. */
export const flag = (on: boolean) => car(0, { currentLapInvalid: on });
/** The lap-invalidation PENA of car 0. */
export const invalidation = (penaltyType: number, infringement: number) => events(pena(0, penaltyType, infringement));

const rows: TransitionRow<MachineInput>[] = [
  { name: 'the session’s first frame, a valid lap: valid (join)', from: 'none', to: 'valid', input: inputs().frame(), join: true },
  { name: 'the session’s first frame, a lap already invalid: invalid (join)', from: 'none', to: 'invalid', input: inputs().frame(flag(true)), join: true },
  {
    name: 'the PENA 12/7 and the flag on one frame (MiP): valid -> invalid',
    from: 'valid',
    to: 'invalid',
    input: inputs().frames(3).frame(all(invalidation(12, 7), flag(true))),
  },
  { name: 'the PENA a frame before the flag: valid -> invalid', from: 'valid', to: 'invalid', input: inputs().frames(3).frame(invalidation(10, 26)).frame(flag(true)) },
  { name: 'the flag with no invalidating PENA (MiR): valid -> invalid', from: 'valid', to: 'invalid', input: inputs().frames(3).frame(all(events(pena(0, 5, 28)), flag(true))) },
  { name: 'the flag clears: invalid -> valid', from: 'invalid', to: 'valid', input: inputs().frames(2).frame(flag(true)).frames(5).frame(flag(false)) },
  { name: 'the flag clears, joined invalid: invalid -> valid', from: 'invalid', to: 'valid', input: inputs().frame(flag(true)).frames(3).frame(flag(false)) },
];

export default defineTransitionTable(machine, rows);
