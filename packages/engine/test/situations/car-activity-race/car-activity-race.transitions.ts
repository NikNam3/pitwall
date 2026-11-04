// The race's car-activity transition table (contract C9, C12, C14, C15, C17, C18, C19, C26, C85): per car, race only,
// what a car is doing by the race's rules. Its upstream: car-location (where the car is), car-status (whether it
// competes), session-phase-race (the lights out) and penalties (what it owes); its signals: pitStatus,
// pitLaneTimerActive, resultStatus and the events DTSV and SGSV; its values: the timing area (lap, lap distance, lap
// timer, pit timers). It reads no driverStatus. The facts: docs/research/09-situations-inventory.md §2.1-2.5, §2.7, §2.10.
// The rules (test agent's reading of the Task 11 brief, binding on the implementer):
// - The scope begins at the lights out: a car has no span while the race session phase is grid, formation or startLights
//   (or before it has one). Every car with a car-status span opens one on the first frame past them. A car in the pit
//   lane then opens outLap (a pit-lane start), every other car racingLap, a car whose status is not competing
//   notCompeting. Those spans have no `joinedAt` when the machine saw the phase before the lights out; when its first
//   frame already lies past it (a race joined in progress), each car opens its current activity with `joinedAt`, and so
//   does a car whose car-status span first appears after the lights out (C3).
// - The current activity (a join, and a return from notCompeting): status not competing notCompeting; result status
//   finished coolDown; in the pit lane with a drive-through or stop-go pending (penalties) servingPenalty, else in the box
//   (pit status in the pit area) boxStop, else past the box (pit stop timer above 0) outLap, else inLap; otherwise
//   racingLap.
// - A pit visit: the pit entry (car-location track -> pitLane) opens inLap, or servingPenalty when the car's penalties
//   span is driveThroughPending or stopGoPending then; the box (pit status in the pit area) turns inLap into boxStop;
//   leaving the box turns boxStop into outLap; a pit exit from inLap (no stop) opens outLap. The line crossed in the pit
//   lane changes nothing. outLap ends at the first lap rise on track (racingLap); a pit entry on an out lap opens inLap or
//   servingPenalty again.
// - servingPenalty (detail `{ penalty, given }`: driveThrough for driveThroughPending, stopGo for stopGoPending; `given`
//   the penalties span open at the pit entry, `{ machine: 'penalties', carId, spanId }`) opens unconfirmed and holds the
//   whole visit, the box included: the box time of a penalty visit is servingPenalty, a drive-through served on a visit
//   that changes tyres included (§2.7). It is confirmed by the car's DTSV (driveThrough) or SGSV (stopGo) while open,
//   which may come up to `SERVED_WITHIN_MS` (10 s) after the pit exit (MiR: 7.1 s); it closes on the later of the pit
//   exit and its confirmation, and the car is then on its outLap; with no confirmation by the first frame more than
//   10 s after the pit exit it closes `confirmed: false` (C18), outLap following. Nothing is rewritten.
// - finished opens on the first frame whose result status is finished on which, or on the frame before which, the car
//   crossed the line (its lap distance fell): the game sets the result status one frame after the crossing (MiR, MxR, the
//   winner included, whose RCWN comes a frame later still, so the session phase is not read for it). A result status
//   set finished mid-lap (the session's last frame, Review Focus 3) finishes nothing until a crossing. finished covers
//   that one frame; coolDown follows on the next frame and holds to the session's end.
// - notCompeting from the frame the car's status turns retired, disqualified or absent, from any kind; back to the
//   current activity when it competes again (not yet seen, C19). Stop-gos and every not-yet-seen row are from the spec.
import type { MachineInput } from '../../../src/situations/machine.ts';
import machine, { SERVED_WITHIN_MS } from '../../../src/situations/car-activity-race/machine.ts';
import { defineTransitionTable, FRAME_MS, inputs, type InputEdit, type TransitionRow } from '../../support/transition-table.ts';
import { all, atMs, crosses, dtsv, events, inBox, inPitLane, lap, lateInLap, onTrack, owes, pastLine, race, result, sgsv, status, stopTimer } from './inputs.ts';

/** The first frame, joined: car 0 racing on track. */
const joined = () => inputs().frame(race());
/** Car 0 on track, then into the pit lane: inLap open from the last frame. */
const onInLap = () => joined().frames(2).frame(inPitLane(0));
/** Car 0 in its box: boxStop open from the last frame. */
const inTheBox = () => onInLap().frames(2).frame(inBox(0)).frames(2, inBox(0));
/** Car 0 out of its box: outLap open from the last frame, still in the pit lane. */
const leftTheBox = () => inTheBox().frame(inPitLane(0));
/** Car 0 past its pit exit on the out lap. */
const outOnTrack = () => leftTheBox().frames(2).frame(onTrack(0)).frames(2);
/** Car 0 enters the pit lane owing a drive-through: servingPenalty open from the last frame. */
const servingDriveThrough = () => joined().frame(owes(0, 'driveThroughPending', 1)).frame().frame(inPitLane(0));
/** Car 0 at the finish: late in the last lap, then across the line, the result status finished a frame later (finished open from the last frame). */
const finishes = (phase: 'finished' | 'racing' = 'finished') => inputs().frame(all(race(phase), lateInLap(0))).frame().frame(crosses(0)).frame(all(pastLine(0), result(0, 'finished')));
/** The frames before the lights out, then the lights out on the last frame. */
const lightsOut = (before: InputEdit = () => {}) => inputs().frame(all(race('grid'), before)).frame(race('startLights')).frames(2).frame(race('racing'));

const rows: TransitionRow<MachineInput>[] = [
  // The lights out (no join): the machine saw the phase before it.
  { name: 'the lights out, a car on the grid: none -> racingLap', from: 'none', to: 'racingLap', input: lightsOut() },
  { name: 'the lights out, a car in the pit lane: none -> outLap (a pit-lane start)', from: 'none', to: 'outLap', input: lightsOut(inPitLane(0)) },
  { name: 'the lights out, a car not competing: none -> notCompeting', from: 'none', to: 'notCompeting', input: lightsOut(status(0, 'retired')) },
  // Joins (Review Focus 2): the machine's first frame lies past the lights out; each car's current activity.
  { name: 'a join, a car on track: racingLap (join)', from: 'none', to: 'racingLap', input: joined(), join: true },
  { name: 'a join, a car in the pit lane before its box (pit stop timer 0): inLap (join)', from: 'none', to: 'inLap', input: inputs().frame(all(race(), inPitLane(0))), join: true },
  { name: 'a join, a car in its box: boxStop (join)', from: 'none', to: 'boxStop', input: inputs().frame(all(race(), inBox(0))), join: true },
  {
    name: 'a join, a car in the pit lane owing a drive-through: servingPenalty (join)',
    from: 'none',
    to: 'servingPenalty',
    input: inputs().frame(all(race(), inPitLane(0), stopTimer(0, 8542), owes(0, 'driveThroughPending'))),
    join: true,
  },
  {
    name: 'a join, a car in the pit lane past its box (pit stop timer above 0; ZvR2 car 1 in race-zandvoort-pit-exit): outLap (join)',
    from: 'none',
    to: 'outLap',
    input: inputs().frame(all(race(), inPitLane(0), stopTimer(0, 8566))),
    join: true,
  },
  { name: 'a join, a car that has finished: coolDown (join)', from: 'none', to: 'coolDown', input: inputs().frame(all(race('finished'), result(0, 'finished'))), join: true },
  { name: 'a join, a car retired: notCompeting (join)', from: 'none', to: 'notCompeting', input: inputs().frame(all(race(), status(0, 'retired'))), join: true },
  // A pit visit (§2.5).
  { name: 'the pit entry (car-location track -> pitLane), nothing to serve: racingLap -> inLap', from: 'racingLap', to: 'inLap', input: onInLap() },
  { name: 'the pit entry owing a drive-through (MiR car 19, 1603.226): racingLap -> servingPenalty', from: 'racingLap', to: 'servingPenalty', input: servingDriveThrough() },
  {
    name: 'the pit entry owing a stop-go (not yet seen, C19): racingLap -> servingPenalty',
    from: 'racingLap',
    to: 'servingPenalty',
    input: joined().frame(owes(0, 'stopGoPending', 1)).frame().frame(inPitLane(0)),
  },
  { name: 'the box (pit status pitting -> in the pit area): inLap -> boxStop', from: 'inLap', to: 'boxStop', input: onInLap().frames(2).frame(inBox(0)) },
  { name: 'leaving the box (pit status in the pit area -> pitting): boxStop -> outLap', from: 'boxStop', to: 'outLap', input: leftTheBox() },
  { name: 'the pit exit without a stop (seen 9 times in the scan): inLap -> outLap', from: 'inLap', to: 'outLap', input: onInLap().frames(3).frame(onTrack(0)) },
  { name: 'the first lap rise on track after the pit exit: outLap -> racingLap', from: 'outLap', to: 'racingLap', input: outOnTrack().frame(lap(0, 2)) },
  { name: 'a pit entry on the out lap (not yet seen, C19): outLap -> inLap', from: 'outLap', to: 'inLap', input: outOnTrack().frame(inPitLane(0)) },
  {
    name: 'a pit entry on the out lap owing a drive-through (not yet seen, C19): outLap -> servingPenalty',
    from: 'outLap',
    to: 'servingPenalty',
    input: outOnTrack().frame(owes(0, 'driveThroughPending', 1)).frame(inPitLane(0)),
  },
  // Serving a penalty (§2.7, Review Focus 5): confirmed by DTSV or SGSV, up to 10 s after the pit exit.
  {
    name: 'the DTSV 7.1 s after the pit exit (MiR car 19, 1631.735 / 1638.850): servingPenalty -> outLap on the DTSV frame',
    from: 'servingPenalty',
    to: 'outLap',
    input: servingDriveThrough().frames(2).frame(inBox(0)).frames(3, inBox(0)).frame(inPitLane(0)).frames(2).frame(onTrack(0)).frames(3).frame(events(dtsv(0))),
  },
  {
    name: 'the DTSV in the pit lane, then the pit exit: servingPenalty -> outLap at the pit exit',
    from: 'servingPenalty',
    to: 'outLap',
    input: servingDriveThrough().frames(2).frame(events(dtsv(0))).frames(2).frame(onTrack(0)),
  },
  {
    name: 'the SGSV after the pit exit (not yet seen, C19): servingPenalty -> outLap on the SGSV frame',
    from: 'servingPenalty',
    to: 'outLap',
    input: joined().frame(owes(0, 'stopGoPending', 1)).frame(inPitLane(0)).frame(inBox(0)).frames(3, inBox(0)).frame(inPitLane(0)).frame(onTrack(0)).frames(2).frame(events(sgsv(0))),
  },
  {
    name: 'no DTSV by the first frame more than 10 s after the pit exit: servingPenalty -> outLap, closed confirmed false (C18)',
    from: 'servingPenalty',
    to: 'outLap',
    // Frames 0-3 as servingDriveThrough, the pit exit on frame 5 (at 5 × FRAME_MS), the next frame just past 10 s later.
    input: servingDriveThrough().frame().frame(onTrack(0)).frame(atMs(5 * FRAME_MS + SERVED_WITHIN_MS + 1)),
  },
  // The finish (§2.10, Review Focus 3).
  { name: 'the result status finished a frame after the line crossing (MiR, MxR): racingLap -> finished', from: 'racingLap', to: 'finished', input: finishes() },
  {
    name: 'the result status finished on the frame of the crossing: racingLap -> finished',
    from: 'racingLap',
    to: 'finished',
    input: inputs().frame(all(race('finished'), lateInLap(0))).frame().frame(all(crosses(0), result(0, 'finished'))),
  },
  {
    name: 'the winner: its result status finished a frame after its crossing, the session phase still racing (its RCWN comes a frame later; MiR 2217.837 / 2217.865): racingLap -> finished',
    from: 'racingLap',
    to: 'finished',
    input: finishes('racing'),
  },
  {
    name: 'a car on its out lap takes the flag: outLap -> finished',
    from: 'outLap',
    to: 'finished',
    input: outOnTrack().frame(all(race('finished'), lateInLap(0))).frame(crosses(0)).frame(all(pastLine(0), result(0, 'finished'))),
  },
  {
    name: 'a car in the pit lane before its box crosses the line at the flag (not yet seen, C19): inLap -> finished',
    from: 'inLap',
    to: 'finished',
    input: inputs().frame(all(race('finished'), lateInLap(0))).frame(inPitLane(0)).frame(crosses(0)).frame(all(pastLine(0), result(0, 'finished'))),
  },
  { name: 'the frame after the finish: finished -> coolDown', from: 'finished', to: 'coolDown', input: finishes().frame(pastLine(0, 8)) },
  // Not competing (car-status, C43).
  { name: 'the car retires on its racing lap: racingLap -> notCompeting', from: 'racingLap', to: 'notCompeting', input: joined().frames(2).frame(status(0, 'retired')) },
  { name: 'the car retires in the pit lane: inLap -> notCompeting', from: 'inLap', to: 'notCompeting', input: onInLap().frame(status(0, 'retired')) },
  { name: 'the car retires in its box: boxStop -> notCompeting', from: 'boxStop', to: 'notCompeting', input: inTheBox().frame(status(0, 'retired')) },
  { name: 'the car is disqualified serving a penalty: servingPenalty -> notCompeting', from: 'servingPenalty', to: 'notCompeting', input: servingDriveThrough().frame(status(0, 'disqualified')) },
  { name: 'the car retires on its out lap: outLap -> notCompeting', from: 'outLap', to: 'notCompeting', input: outOnTrack().frame(status(0, 'retired')) },
  { name: 'the car is disqualified on the frame after its finish (not yet seen, C19): finished -> notCompeting', from: 'finished', to: 'notCompeting', input: finishes().frame(status(0, 'disqualified')) },
  { name: 'the car is disqualified after its finish (not yet seen, C19): coolDown -> notCompeting', from: 'coolDown', to: 'notCompeting', input: finishes().frames(2).frame(status(0, 'disqualified')) },
  {
    name: 'the car competes again on track (not yet seen, C19): notCompeting -> racingLap',
    from: 'notCompeting',
    to: 'racingLap',
    input: joined().frame(status(0, 'disqualified')).frames(2).frame(status(0, 'competing')),
  },
  {
    name: 'the car competes again in the pit lane before its box (not yet seen, C19): notCompeting -> inLap',
    from: 'notCompeting',
    to: 'inLap',
    input: joined().frame(status(0, 'disqualified')).frame(inPitLane(0)).frame().frame(status(0, 'competing')),
  },
  {
    name: 'the car competes again in its box (not yet seen, C19): notCompeting -> boxStop',
    from: 'notCompeting',
    to: 'boxStop',
    input: joined().frame(status(0, 'disqualified')).frame(inBox(0)).frame().frame(status(0, 'competing')),
  },
  {
    name: 'the car competes again in the pit lane owing a drive-through (not yet seen, C19): notCompeting -> servingPenalty',
    from: 'notCompeting',
    to: 'servingPenalty',
    input: joined().frame(status(0, 'disqualified')).frame(all(inPitLane(0), owes(0, 'driveThroughPending'))).frame().frame(status(0, 'competing')),
  },
  {
    name: 'the car competes again in the pit lane past its box (not yet seen, C19): notCompeting -> outLap',
    from: 'notCompeting',
    to: 'outLap',
    input: joined().frame(status(0, 'disqualified')).frame(all(inPitLane(0), stopTimer(0, 2500))).frame().frame(status(0, 'competing')),
  },
  {
    name: 'the car competes again having finished (not yet seen, C19): notCompeting -> coolDown',
    from: 'notCompeting',
    to: 'coolDown',
    input: joined().frame(status(0, 'disqualified')).frame(result(0, 'finished')).frame().frame(status(0, 'competing')),
  },
];

export default defineTransitionTable(machine, rows);
