// The car-status transition table (contract C3, C15, C17, C18, C19, C43, C85): per car slot, whether a car still competes
// in the session. car-status is the one decider of which cars are in the session (C43): a slot is `absent` while no car
// of the session holds it (`isActiveCar` over `slotsInUse`, from the signals `resultStatus` and `numActiveCars`); a car
// is in the session while its status is not `absent`. Otherwise the status follows `resultStatus` when it changes: active
// or finished `competing` (a finish is car activity's, not a status), retired, did not finish or not classified
// `retired` (not classified, rs 6: not yet seen, mapped from the spec, C19), disqualified `disqualified`.
// `retired` opens on the earliest reliable signal for the car (C18): a PENA of type 16 (retired), an RTMT, or the result
// status, whichever comes first; its cause is the one known on its opening frame and is never rewritten: from the PENA 16
// infringement (41 mechanical, 42 terminal damage, any other `other`), else from the RTMT reason (the spec's: mechanical
// failure, terminal damage, `invalid` none, any other `other`), else `unknown('notReceived')` (supervisor ruling, Task 10
// round 2). Until a car's Participants data is in the live state (`updatedAt.participants`, the identity area) nobody
// knows whether its slot holds a car (C3): the car's first span opens on the first frame that data is there, with
// `joinedAt` (a join row, Review Focus 2), and no span opens before it. No kind goes to `none`. The declared
// transitions, every pair of kinds:
//   none -> competing             the first frame with Participants data, a car in the session (join)
//   none -> retired               the first frame with Participants data, a car already retired (join; ZvR2 car 2 in
//                                 race-zandvoort-retire)
//   none -> disqualified          the first frame with Participants data, a car disqualified (join)
//   none -> absent                the first frame with Participants data, a slot past numActiveCars (join)
//   competing -> retired          a PENA 16 (ZvR2 car 2: PENA 16/42 4 s before its RTMT), an RTMT (AI mechanical: the
//                                 RTMT, rs 7 a frame later, PENA 16/41 about 1 s later; the player's retirement), or the
//                                 result status retired, did not finish or not classified
//   competing -> disqualified     the result status disqualified (§2.11, ZvR formation lap)
//   competing -> absent           the game marks the slot inactive or invalid (not yet seen, C19)
//   retired -> competing          the result status active again (not yet seen, C19)
//   retired -> disqualified       an RTMT, then the result status disqualified a frame later (ZvR 125.339 / 125.371)
//   retired -> absent             the result status invalid (not yet seen, C19)
//   disqualified -> competing     the result status active again: the ZvR formation reset (rs 5 -> 2 at st 1.968)
//   disqualified -> retired       the result status retired (not yet seen, C19)
//   disqualified -> absent        the result status invalid (not yet seen, C19)
//   absent -> competing           numActiveCars rises, a slot comes into use (not yet seen, C19: the one rise, ZvR's
//                                 formation reset, comes with a DSQ'd car back to active, so no slot changes)
//   absent -> retired             a slot marked invalid whose car then shows retired (not yet seen, C19)
//   absent -> disqualified        a slot marked invalid whose car then shows disqualified (not yet seen, C19)
// Signal orders (Review Focus 5, inventory §2.9, §2.11, a scan of every recording 2026-11-03): RTMT comes a frame before
// `resultStatus` 7; PENA 16/42 (terminal damage) up to 4 s before the RTMT or on its frame; PENA 16/41 (mechanical
// failure) about 1 s after it; `numActiveCars` falls 1.2-6 s after it (a slot out of the race still counts, `slotsInUse`).
// A disqualification opens unconfirmed and is confirmed by a PENA of type 6 or by 2 s of the result status unchanged
// (plan Global Constraints, carried over). Those orders and the causes: car-status.test.ts.
import { carId, type ResultStatus } from '@pitwall/domain';
import type { RetirementReason, SituationEvent } from '../../../src/signals/types.ts';
import type { MachineInput } from '../../../src/situations/machine.ts';
import machine from '../../../src/situations/car-status/machine.ts';
import { all, car, events, participants, pena } from '../../support/car-edits.ts';
import { defineTransitionTable, inputs, type InputEdit, type TransitionRow } from '../../support/transition-table.ts';

/** `n` cars in the session from this frame on (Participants `numActiveCars`), the Participants data in the live state. */
export const inSession = (n: number): InputEdit =>
  all(participants, (input) => {
    input.signals.session.numActiveCars = n;
  });
/** Car `index` shows result status `status` from this frame on. */
export const result = (index: number, status: ResultStatus): InputEdit => car(index, { resultStatus: status });
/** The RTMT of car `index` (the recordings always send reason 0, `invalid`). */
export const rtmt = (index: number, reason: RetirementReason = 'invalid'): SituationEvent => ({ code: 'RTMT', carId: carId(index), reason });
/** The frame carries an RTMT of car `index`. */
export const retires = (index: number, reason: RetirementReason = 'invalid'): InputEdit => events(rtmt(index, reason));

/** Two cars in the session, car 0 the subject of every row. */
const field = inSession(2);

const rows: TransitionRow<MachineInput>[] = [
  { name: 'the first frame with Participants data, a car in the session: competing (join)', from: 'none', to: 'competing', input: inputs().frame(field), join: true },
  {
    name: 'the first frame with Participants data, a car already retired: retired (join; ZvR2 car 2)',
    from: 'none',
    to: 'retired',
    input: inputs().frame(all(inSession(1), result(0, 'retired'))),
    join: true,
  },
  {
    name: 'the first frame with Participants data, a car disqualified: disqualified (join)',
    from: 'none',
    to: 'disqualified',
    input: inputs().frame(all(inSession(1), result(0, 'disqualified'))),
    join: true,
  },
  {
    name: 'the first frame with Participants data, a slot past numActiveCars: absent (join)',
    from: 'none',
    to: 'absent',
    input: inputs().frames(2).frame(inSession(1)),
    join: true,
  },
  {
    name: 'PENA 16/42 opens it, 4 s before its RTMT (ZvR2 car 2, 912.011 / 916.028): competing -> retired',
    from: 'competing',
    to: 'retired',
    input: inputs().frames(3, field).frame(events(pena(0, 16, 42))),
  },
  {
    name: 'the RTMT opens it, rs 7 a frame later and PENA 16/41 about 1 s later (AI mechanical failure, MxR, SgW, MiR): competing -> retired',
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
    name: 'an RTMT with reason mechanical failure (not yet seen: every recording sends 0): competing -> retired',
    from: 'competing',
    to: 'retired',
    input: inputs().frames(3, field).frame(retires(0, 'mechanicalFailure')),
  },
  {
    name: 'an RTMT with reason terminal damage (not yet seen): competing -> retired',
    from: 'competing',
    to: 'retired',
    input: inputs().frames(3, field).frame(retires(0, 'terminalDamage')),
  },
  {
    name: 'an RTMT with reason black flagged (not yet seen): competing -> retired',
    from: 'competing',
    to: 'retired',
    input: inputs().frames(3, field).frame(retires(0, 'blackFlagged')),
  },
  {
    name: 'the result status retired with no RTMT: competing -> retired',
    from: 'competing',
    to: 'retired',
    input: inputs().frames(3, field).frame(result(0, 'retired')),
  },
  {
    name: 'the result status not classified (not yet seen, mapped from the spec): competing -> retired',
    from: 'competing',
    to: 'retired',
    input: inputs().frames(3, field).frame(result(0, 'notClassified')),
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
    name: 'numActiveCars rises and slot 1 comes into use: absent -> competing (not yet seen)',
    from: 'absent',
    to: 'competing',
    input: inputs().frames(3, inSession(1)).frame(inSession(2)),
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
