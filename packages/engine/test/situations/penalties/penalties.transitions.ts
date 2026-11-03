// The penalties sub-machine's transition table (contract C15, C17, C18, C85): per car, race only, what the car owes race
// control now, one span per car at a time, a new span on every change of what it owes. The declared transitions are
//   none -> clear | timePenalty | driveThroughPending | stopGoPending   the session's first frame (join)
//   clear -> timePenalty | driveThroughPending | stopGoPending          a penalty arrives
//   timePenalty -> clear | timePenalty | driveThroughPending | stopGoPending
//                                                                       the time penalties fall to 0, change, or a
//                                                                       drive-through or stop-go arrives
//   driveThroughPending -> clear | timePenalty | driveThroughPending | stopGoPending
//   stopGoPending -> clear | timePenalty | driveThroughPending | stopGoPending
//                                                                       a served penalty (the unserved count falls)
//                                                                       leaves what is still owed; a pending to a
//                                                                       pending of the same kind: the counts, the
//                                                                       infringement or the time penalties changed
// (every kind to every kind, but `clear -> clear`.) The kind names the oldest unserved penalty (drive-through or
// stop-go); the detail is `{ driveThroughs, stopGos, infringement, totalMs }` (`timePenalty`: `{ totalMs }`, `clear`:
// `{}`); `infringement` is `known(infringement, PENA time)` of the PENA (type 0 drive-through, 1 stop-go) that gave the
// penalty, else `unknown('notReceived')` (C3).
// Signal orders (inventory §2.7, Review Focus 5): the PENA arrives one frame before `numUnservedDriveThroughPens` rises
// (it waits in the open state, C18); DTSV comes 7 s or more after the pit exit, with or just before or after the count
// falls; a pending span closes only when the count falls, DTSV and SGSV never open, close or rewrite a span. A stop-go
// is not yet seen in any recording (C19): its rows are synthetic, from the game's spec.
import { carId } from '@pitwall/domain';
import type { MachineInput } from '../../../src/situations/machine.ts';
import machine from '../../../src/situations/penalties/machine.ts';
import { car, events, pena } from '../../support/car-edits.ts';
import { defineTransitionTable, inputs, type InputEdit, type TransitionRow } from '../../support/transition-table.ts';

/** Car 0 has `n` unserved drive-throughs from this frame on. */
export const dt = (n: number): InputEdit => car(0, { unservedDriveThroughs: n });
/** Car 0 has `n` unserved stop-gos from this frame on. */
export const sg = (n: number): InputEdit => car(0, { unservedStopGos: n });
/** Car 0 holds `ms` of time penalties from this frame on. */
export const time = (ms: number): InputEdit => car(0, { timePenaltyMs: ms });
/** The PENA drive-through (type 0) of car 0. */
export const dtPena = (infringement: number): InputEdit => events(pena(0, 0, infringement));
/** The PENA stop-go (type 1) of car 0. */
export const sgPena = (infringement: number): InputEdit => events(pena(0, 1, infringement));
/** The PENA time penalty (type 4) of car 0. */
export const timePena = (infringement = 21): InputEdit => events(pena(0, 4, infringement));
/** DTSV and SGSV of car 0. */
export const dtsv = (index = 0): InputEdit => events({ code: 'DTSV', carId: carId(index) });
export const sgsv = (index = 0): InputEdit => events({ code: 'SGSV', carId: carId(index), stopTimeMs: 10000 });

const rows: TransitionRow<MachineInput>[] = [
  { name: 'the session’s first frame, nothing owed: clear (join)', from: 'none', to: 'clear', input: inputs().frame(), join: true },
  { name: 'the session’s first frame, time penalties standing: timePenalty (join)', from: 'none', to: 'timePenalty', input: inputs().frame(time(3000)), join: true },
  { name: 'the session’s first frame, a drive-through unserved: driveThroughPending (join)', from: 'none', to: 'driveThroughPending', input: inputs().frame(dt(1)), join: true },
  { name: 'the session’s first frame, a stop-go unserved: stopGoPending (join)', from: 'none', to: 'stopGoPending', input: inputs().frame(sg(1)), join: true },

  { name: 'a time penalty (PENA 4, then penalties 0 -> 3 s): clear -> timePenalty', from: 'clear', to: 'timePenalty', input: inputs().frames(2).frame(timePena()).frame(time(3000)) },
  { name: 'a drive-through (PENA 0, one frame before the count rises): clear -> driveThroughPending', from: 'clear', to: 'driveThroughPending', input: inputs().frames(2).frame(dtPena(38)).frame(dt(1)) },
  { name: 'a stop-go (PENA 1, then the count rises; not yet seen): clear -> stopGoPending', from: 'clear', to: 'stopGoPending', input: inputs().frames(2).frame(sgPena(7)).frame(sg(1)) },

  { name: 'the time penalties fall to 0: timePenalty -> clear', from: 'timePenalty', to: 'clear', input: inputs().frames(2).frame(time(3000)).frames(2).frame(time(0)) },
  { name: 'a further time penalty: timePenalty -> timePenalty', from: 'timePenalty', to: 'timePenalty', input: inputs().frames(2).frame(time(3000)).frames(2).frame(time(8000)) },
  { name: 'a drive-through on top of a time penalty: timePenalty -> driveThroughPending', from: 'timePenalty', to: 'driveThroughPending', input: inputs().frames(2).frame(time(3000)).frames(2).frame(dtPena(38)).frame(dt(1)) },
  { name: 'a stop-go on top of a time penalty (not yet seen): timePenalty -> stopGoPending', from: 'timePenalty', to: 'stopGoPending', input: inputs().frames(2).frame(time(3000)).frames(2).frame(sgPena(7)).frame(sg(1)) },

  { name: 'the drive-through is served (count 1 -> 0): driveThroughPending -> clear', from: 'driveThroughPending', to: 'clear', input: inputs().frames(2).frame(dtPena(38)).frame(dt(1)).frames(3).frame(dt(0)) },
  { name: 'the drive-through is served, a time penalty stands: driveThroughPending -> timePenalty', from: 'driveThroughPending', to: 'timePenalty', input: inputs().frames(2).frame(time(3000)).frame(dtPena(38)).frame(dt(1)).frames(3).frame(dt(0)) },
  { name: 'a second drive-through: driveThroughPending -> driveThroughPending', from: 'driveThroughPending', to: 'driveThroughPending', input: inputs().frames(2).frame(dtPena(38)).frame(dt(1)).frames(3).frame(dtPena(40)).frame(dt(2)) },
  { name: 'the drive-through is served, a stop-go is still owed (not yet seen): driveThroughPending -> stopGoPending', from: 'driveThroughPending', to: 'stopGoPending', input: inputs().frames(2).frame(dtPena(38)).frame(dt(1)).frame(sgPena(7)).frame(sg(1)).frames(2).frame(dt(0)) },

  { name: 'the stop-go is served (count 1 -> 0; not yet seen): stopGoPending -> clear', from: 'stopGoPending', to: 'clear', input: inputs().frames(2).frame(sgPena(7)).frame(sg(1)).frames(3).frame(sg(0)) },
  { name: 'the stop-go is served, a time penalty stands (not yet seen): stopGoPending -> timePenalty', from: 'stopGoPending', to: 'timePenalty', input: inputs().frames(2).frame(time(3000)).frame(sgPena(7)).frame(sg(1)).frames(3).frame(sg(0)) },
  { name: 'a second stop-go (not yet seen): stopGoPending -> stopGoPending', from: 'stopGoPending', to: 'stopGoPending', input: inputs().frames(2).frame(sgPena(7)).frame(sg(1)).frames(3).frame(sgPena(8)).frame(sg(2)) },
  { name: 'the stop-go is served, a drive-through is still owed (not yet seen): stopGoPending -> driveThroughPending', from: 'stopGoPending', to: 'driveThroughPending', input: inputs().frames(2).frame(sgPena(7)).frame(sg(1)).frame(dtPena(38)).frame(dt(1)).frames(2).frame(sg(0)) },
];

export default defineTransitionTable(machine, rows);
