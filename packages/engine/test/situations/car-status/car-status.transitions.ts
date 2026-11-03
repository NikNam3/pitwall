// The car-status transition table (contract C15, C17, C18, C19, C43, C85): per car slot, whether a car still competes in
// the session. car-status is the one decider of which cars are in the session (C43): a slot is `absent` while no car of
// the session holds it (`isActiveCar` over `slotsInUse`, from the signals `resultStatus` and `numActiveCars`); a car is in
// the session while its status is not `absent`. Otherwise the status follows `resultStatus` when it changes: active or
// finished `competing` (a finish is car activity's, not a status), retired or did-not-finish `retired`, disqualified
// `disqualified`. An RTMT retires the car at once, on its frame, a frame before its `resultStatus` follows (inventory
// §2.9; C18: the span opens on its earliest reliable signal). A car has a span from the session's first frame on
// (lane-common), so `none -> <kind>` is the first frame (a join row: the span has `joinedAt`, Review Focus 2). No kind
// goes to `none`. The declared transitions, every pair of kinds:
//   none -> competing             the first frame, a car in the session (join)
//   none -> retired               the first frame, a car already retired (join; ZvR2 car 2 in race-zandvoort-retire)
//   none -> disqualified          the first frame, a car disqualified (join)
//   none -> absent                the first frame, a slot no car holds (join; every slot before the first Participants)
//   competing -> retired          an RTMT (§2.9: AI mechanical, terminal damage, the player's retirement), or the
//                                 result status retired without one
//   competing -> disqualified     the result status disqualified (§2.11, ZvR formation lap)
//   competing -> absent           the game marks the slot inactive or invalid (not yet seen, C19)
//   retired -> competing          the result status active again (not yet seen, C19)
//   retired -> disqualified       an RTMT, then the result status disqualified a frame later (ZvR 125.339 / 125.371)
//   retired -> absent             the result status invalid (not yet seen, C19)
//   disqualified -> competing     the result status active again: the ZvR formation reset (rs 5 -> 2 at st 1.968)
//   disqualified -> retired       the result status retired (not yet seen, C19)
//   disqualified -> absent        the result status invalid (not yet seen, C19)
//   absent -> competing           the first Participants names the cars (MiP: 3.5 s after the first LapData; ZvR
//                                 numActiveCars 19 -> 20 at the formation reset)
//   absent -> retired             a slot marked invalid whose car then shows retired (not yet seen, C19)
//   absent -> disqualified        a slot marked invalid whose car then shows disqualified (not yet seen, C19)
// Signal orders (Review Focus 5, inventory §2.9, §2.11, a scan of every recording 2026-11-03): RTMT comes a frame before
// `resultStatus` 7; PENA 16/42 (terminal damage) up to 4 s before the RTMT or on its frame; PENA 16/41 (mechanical
// failure) about 1 s after it; `numActiveCars` falls 1.2-6 s after it (a slot out of the race still counts, `slotsInUse`).
// The cause waits in the open state (C18); a disqualification opens unconfirmed and is confirmed by a PENA of type 6 or
// by 2 s of the result status unchanged (plan Global Constraints, carried over). Those orders: car-status.test.ts.
import { carId, type ResultStatus } from '@pitwall/domain';
import type { SituationEvent } from '../../../src/signals/types.ts';
import type { MachineInput } from '../../../src/situations/machine.ts';
import machine from '../../../src/situations/car-status/machine.ts';
import { all, car, events, pena } from '../../support/car-edits.ts';
import { defineTransitionTable, inputs, type InputEdit, type TransitionRow } from '../../support/transition-table.ts';

/** `n` cars in the session from this frame on (Participants `numActiveCars`). */
export const inSession = (n: number): InputEdit => (input) => {
  input.signals.session.numActiveCars = n;
};
/** Car `index` shows result status `status` from this frame on. */
export const result = (index: number, status: ResultStatus): InputEdit => car(index, { resultStatus: status });
/** The RTMT of car `index` (the recordings always send reason 0, `invalid`). */
export const rtmt = (index: number, reason: Extract<SituationEvent, { code: 'RTMT' }>['reason'] = 'invalid'): SituationEvent => ({
  code: 'RTMT',
  carId: carId(index),
  reason,
});
/** The frame carries an RTMT of car `index`. */
export const retires = (index: number): InputEdit => events(rtmt(index));

/** Two cars in the session, car 0 the subject of every row. */
const field = inSession(2);

const rows: TransitionRow<MachineInput>[] = [
  { name: 'the session’s first frame, a car in the session: competing (join)', from: 'none', to: 'competing', input: inputs().frame(field), join: true },
  {
    name: 'the session’s first frame, a car already retired: retired (join; ZvR2 car 2)',
    from: 'none',
    to: 'retired',
    input: inputs().frame(all(inSession(1), result(0, 'retired'))),
    join: true,
  },
  {
    name: 'the session’s first frame, a car disqualified: disqualified (join)',
    from: 'none',
    to: 'disqualified',
    input: inputs().frame(all(inSession(1), result(0, 'disqualified'))),
    join: true,
  },
  {
    name: 'the session’s first frame before the first Participants (numActiveCars 0): absent (join)',
    from: 'none',
    to: 'absent',
    input: inputs().frame(),
    join: true,
  },
  {
    name: 'an RTMT, the result status still active (a frame before it follows): competing -> retired',
    from: 'competing',
    to: 'retired',
    input: inputs().frames(3, field).frame(retires(0)),
  },
  {
    name: 'the RTMT and PENA 16/42 on one frame (the player’s terminal damage, ZvR2 1207.667): competing -> retired',
    from: 'competing',
    to: 'retired',
    input: inputs().frames(3, field).frame(events(pena(0, 16, 42), rtmt(0))),
  },
  {
    name: 'the result status retired with no RTMT: competing -> retired',
    from: 'competing',
    to: 'retired',
    input: inputs().frames(3, field).frame(result(0, 'retired')),
  },
  {
    name: 'the result status disqualified (ZvR formation lap): competing -> disqualified',
    from: 'competing',
    to: 'disqualified',
    input: inputs().frames(3, field).frame(result(0, 'disqualified')),
  },
  {
    name: 'the slot marked inactive: competing -> absent (not yet seen)',
    from: 'competing',
    to: 'absent',
    input: inputs().frames(3, field).frame(result(0, 'inactive')),
  },
  {
    name: 'the result status active again after retired: retired -> competing (not yet seen)',
    from: 'retired',
    to: 'competing',
    input: inputs().frames(3, all(field, result(0, 'retired'))).frame(result(0, 'active')),
  },
  {
    name: 'an RTMT, then the result status disqualified a frame later (ZvR 125.339 / 125.371): retired -> disqualified',
    from: 'retired',
    to: 'disqualified',
    input: inputs().frames(3, field).frame(retires(0)).frame(result(0, 'disqualified')),
  },
  {
    name: 'the result status invalid after retired: retired -> absent (not yet seen)',
    from: 'retired',
    to: 'absent',
    input: inputs().frames(3, all(field, result(0, 'retired'))).frame(result(0, 'invalid')),
  },
  {
    name: 'the result status active again after a disqualification held over 2 s (the ZvR formation reset): disqualified -> competing',
    from: 'disqualified',
    to: 'competing',
    input: inputs().frames(3, field).frames(200, result(0, 'disqualified')).frame(result(0, 'active')),
  },
  {
    name: 'the result status retired after disqualified: disqualified -> retired (not yet seen)',
    from: 'disqualified',
    to: 'retired',
    input: inputs().frames(3, all(field, result(0, 'disqualified'))).frame(result(0, 'retired')),
  },
  {
    name: 'the result status invalid after disqualified: disqualified -> absent (not yet seen)',
    from: 'disqualified',
    to: 'absent',
    input: inputs().frames(3, all(field, result(0, 'disqualified'))).frame(result(0, 'invalid')),
  },
  {
    name: 'the first Participants names the cars (MiP, 3.5 s after the first LapData): absent -> competing',
    from: 'absent',
    to: 'competing',
    input: inputs().frames(3).frame(field),
  },
  {
    name: 'a slot marked invalid whose car then shows retired: absent -> retired (not yet seen)',
    from: 'absent',
    to: 'retired',
    input: inputs().frames(3, all(field, result(0, 'invalid'))).frame(result(0, 'retired')),
  },
  {
    name: 'a slot marked invalid whose car then shows disqualified: absent -> disqualified (not yet seen)',
    from: 'absent',
    to: 'disqualified',
    input: inputs().frames(3, all(field, result(0, 'invalid'))).frame(result(0, 'disqualified')),
  },
];

export default defineTransitionTable(machine, rows);
