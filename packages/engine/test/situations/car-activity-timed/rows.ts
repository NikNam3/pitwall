// The transition rows shared by the qualifying and the practice car-activity sub-machines (contract C9, C14, C15, C17,
// C18, C19, C85): the two declare the same transitions, the push kind named `pushLap` in qualifying and `flyingLap` in
// practice. Per car: what the car is doing by its phase's rules, from the upstream car-location, car-status and the
// phase's session-phase, the signals `driverStatus`, `pitStatus`, `resultStatus` and the values lap distance and track
// length (inventory §2.1-2.4, §1.9, §2.10; supervisor rulings, Task 12 brief):
// - A car's scope begins with its first car-location span (the frame its Participants data is in the live state); its
//   first span is a join (`joinedAt`): `notCompeting` while its car status is retired, disqualified or absent; `garage`
//   while car-location is `garage`; `finished` with the result status finished; `inLap` once the session has ended (the
//   session phase finished or post-session); else in the pit lane `outLap` with the out-lap driver status, `inLap`
//   otherwise; on track `outLap` with the out-lap driver status, `inLap` with the in-lap one, the push kind otherwise.
// - `notCompeting` while car-status is retired, disqualified or absent (the no-gaps rule); a status competing again
//   reopens the car's activity as a join would choose it (no `joinedAt`).
// - `garage` while car-location is `garage`: into the garage box, and every teleport into it (inventory §2.4: the
//   player's return to the garage, AI in-laps under time acceleration). A teleport is no lap and no transition except
//   into `garage`.
// - `outLap` from leaving the garage (car-location leaves `garage`: into the pit lane, or straight onto the track under
//   time acceleration, §2.2) or the pit lane without the garage, to the line.
// - The push kind from the line on track: the lap distance from below 0 to 0 or more (an out lap from a garage before
//   the line), or a wrap (a drop of more than half the track's length). Not the lap number (the out lap after a garage
//   visit crosses the line without it rising, §2.2; the time-out raises it mid-lap, §2.10), not the lap timer (it stands
//   at 0 on an out lap and goes back mid-lap, SgQ), not the driver status (it turns flying lap a frame late or on time).
//   A line in the pit lane (garage boxes before the line, §2.3) is no line.
// - `inLap` once the car heads for the pit lane (the in-lap driver status on a push lap, which AI cars show from the line
//   after their push lap, SgQ; the pit entry, car-location `track -> pitLane`) or the session's end ends its push (the
//   result status turning finished mid-lap, the session phase turning finished or post-session, §2.10).
// - `finished` at the line once the session has ended for the car (its result status finished, or the session phase
//   finished or post-session): the chequered flag's last lap. A car set to finished mid-lap (the last frame of SgQ and
//   MiP) is not finished by that alone (Review Focus 3): its push ends, `inLap`.
// Every `finished` row and every return from `notCompeting` is not yet seen in a practice or qualifying recording (C19).
import { inputs, type TransitionRow } from '../../support/transition-table.ts';
import { car0, carStatus, inGarage, inLapOnTrack, inPitLane, leavingGarage, onOutLap, pushing, type Timed } from './inputs.ts';

/** The rows of a timed car-activity table: the phase's edits and the name of its push kind. */
export const timedActivityRows = (t: Timed, push: 'pushLap' | 'flyingLap'): TransitionRow[] => {
  const f = t.frame;
  /** Car 0 pushes: three frames of its lap 2. */
  const onPush = () => inputs().frames(3, f(pushing(2_000, 2)));
  /** Car 0 on its out lap on track, three frames. */
  const onOut = () => inputs().frames(3, f(onOutLap(2_500)));
  /** Car 0 on an in lap: the push lap, then the in-lap driver status on track. */
  const onIn = () => onPush().frames(2, f(inLapOnTrack(2_100, 2)));
  /** Car 0 in the garage, three frames. */
  const inBox = () => inputs().frames(3, f(inGarage()));
  /** Car 0 retired: three frames, car-status retired. */
  const retired = () => inputs().frames(3, f(carStatus(0, 'retired'), pushing(2_000, 2)));
  /** Car 0 finished: its push lap reaches the line as its result status turns finished. */
  const finished = () => inputs().frames(2, f(pushing(4_980, 3))).frame(f(car0({ ds: 'flyingLap', ps: 'none', d: 4, lap: 3, rs: 'finished' })));

  return [
    // the first frame (joins, Review Focus 2)
    { name: 'joined in the garage: garage (join)', from: 'none', to: 'garage', input: inputs().frame(f(inGarage())), join: true },
    { name: 'joined on the out lap on track, before the line (ds 3, d -350; practice-garage-exit car 2): outLap (join)', from: 'none', to: 'outLap', input: inputs().frame(f(onOutLap(-350))), join: true },
    { name: 'joined leaving the garage, in the pit lane (ds 3, ps 1): outLap (join)', from: 'none', to: 'outLap', input: inputs().frame(f(leavingGarage())), join: true },
    { name: `joined mid push lap (ds 1, d 2049; qualifying-singapore-full-lap car 8): ${push} (join)`, from: 'none', to: push, input: inputs().frame(f(pushing(2_049))), join: true },
    { name: 'joined on an in lap on track (ds 2, d 626; qualifying-singapore-end car 1): inLap (join)', from: 'none', to: 'inLap', input: inputs().frame(f(inLapOnTrack(626, 3))), join: true },
    { name: 'joined in the pit lane on the in lap (ds 2, ps 1): inLap (join)', from: 'none', to: 'inLap', input: inputs().frame(f(inPitLane(4_960))), join: true },
    { name: 'joined after the session’s end, on track: inLap (join)', from: 'none', to: 'inLap', input: inputs().frame(f(t.sessionPhase('postSession'), pushing(2_000))), join: true },
    { name: 'joined with the result status finished, on track (not yet seen): finished (join)', from: 'none', to: 'finished', input: inputs().frame(f(car0({ ds: 'onTrack', ps: 'none', d: 300, lap: 3, rs: 'finished' }))), join: true },
    { name: 'joined retired: notCompeting (join)', from: 'none', to: 'notCompeting', input: inputs().frame(f(carStatus(0, 'retired'), inGarage())), join: true },
    { name: 'a slot no car of the session holds (absent): notCompeting (join)', from: 'none', to: 'notCompeting', input: inputs().frame(f()), join: true },
    // not competing (car-status retired, disqualified or absent)
    { name: 'retires on its out lap: outLap -> notCompeting', from: 'outLap', to: 'notCompeting', input: onOut().frame(f(carStatus(0, 'retired'), onOutLap(2_600))) },
    { name: `retires mid push lap (terminal damage): ${push} -> notCompeting`, from: push, to: 'notCompeting', input: onPush().frame(f(carStatus(0, 'retired'), pushing(2_100, 2))) },
    { name: 'disqualified on its in lap: inLap -> notCompeting', from: 'inLap', to: 'notCompeting', input: onIn().frame(f(carStatus(0, 'disqualified'), inLapOnTrack(2_200, 2))) },
    { name: 'the player retires from the menu in the garage (rs 2 -> 7, ds 0, ps 1; MiP 1653.061): garage -> notCompeting', from: 'garage', to: 'notCompeting', input: inBox().frame(f(carStatus(0, 'retired'), inGarage())) },
    { name: 'a finished car turns retired (not yet seen): finished -> notCompeting', from: 'finished', to: 'notCompeting', input: finished().frame(f(carStatus(0, 'retired'), car0({ ds: 'onTrack', ps: 'none', d: 40, lap: 3, rs: 'retired' }))) },
    { name: 'competing again, in the garage (not yet seen): notCompeting -> garage', from: 'notCompeting', to: 'garage', input: retired().frame(f(carStatus(0, 'competing'), inGarage())) },
    { name: 'competing again, on the out lap (not yet seen): notCompeting -> outLap', from: 'notCompeting', to: 'outLap', input: retired().frame(f(carStatus(0, 'competing'), onOutLap(2_100))) },
    { name: `competing again, on a push lap (not yet seen): notCompeting -> ${push}`, from: 'notCompeting', to: push, input: retired().frame(f(carStatus(0, 'competing'), pushing(2_100, 2))) },
    { name: 'competing again, on an in lap (not yet seen): notCompeting -> inLap', from: 'notCompeting', to: 'inLap', input: retired().frame(f(carStatus(0, 'competing'), inLapOnTrack(2_100, 2))) },
    { name: 'competing again, with the result status finished (not yet seen): notCompeting -> finished', from: 'notCompeting', to: 'finished', input: retired().frame(f(carStatus(0, 'competing'), car0({ ds: 'onTrack', ps: 'none', d: 2_100, lap: 3, rs: 'finished' }))) },
    // into the garage
    { name: 'back into the garage box from the pit lane on the out lap (not yet seen): outLap -> garage', from: 'outLap', to: 'garage', input: inBox().frames(3, f(leavingGarage())).frame(f(inGarage(70))) },
    { name: `the player’s return to the garage mid-lap, a teleport (ds 1 -> 0, ps 0, d 739 -> 33; SgQ 467.514): ${push} -> garage`, from: push, to: 'garage', input: inputs().frames(3, f(pushing(739, 4))).frame(f(car0({ ds: 'inGarage', ps: 'none', d: 33, lap: 4 }))) },
    { name: 'into the garage box: one frame of ps 2, then ds 2 -> 0 with ps 2 -> 1 (MiP 542.845 / 542.879): inLap -> garage', from: 'inLap', to: 'garage', input: onIn().frames(2, f(inPitLane(30, 2))).frame(f(car0({ ds: 'inLap', ps: 'inPitArea', d: 40, lap: 2 }))).frame(f(inGarage(40, 2))) },
    { name: 'an AI in lap teleported into the garage under time acceleration (ds 2 -> 0, ps 0 -> 1, d 4500 -> 4929; SgQ 501.014): inLap -> garage', from: 'inLap', to: 'garage', input: onPush().frames(2, f(inLapOnTrack(4_500, 2))).frame(f(car0({ ds: 'inGarage', ps: 'pitting', d: 4_929, lap: 2 }))) },
    { name: 'a finished car into the garage (not yet seen): finished -> garage', from: 'finished', to: 'garage', input: finished().frame(f(car0({ ds: 'inGarage', ps: 'pitting', d: 60, lap: 3, rs: 'finished' }))) },
    // out of the garage
    { name: 'leaving the garage, ds 0 -> 3 with ps still 1 (MiP 641.422): garage -> outLap', from: 'garage', to: 'outLap', input: inBox().frame(f(leavingGarage())) },
    { name: 'leaving the garage under time acceleration, ds 0 -> 3, ps 1 -> 0 and d -4896 -> -1539 in one frame (SgQ 138.968): garage -> outLap', from: 'garage', to: 'outLap', input: inputs().frames(3, f(inGarage(-4_896))).frame(f(onOutLap(-1_539))) },
    // the line
    { name: `the line of an out lap from a garage before it: the lap distance from below 0 to 0 or more (SgQ 166.473): outLap -> ${push}`, from: 'outLap', to: push, input: inputs().frames(3, f(onOutLap(-1))).frame(f(car0({ ds: 'flyingLap', ps: 'none', d: 0.2, timerMs: 16 }))) },
    {
      name: `the line after a garage visit on the same lap number: a wrap, the driver status still out lap (w2/laps): outLap -> ${push}`,
      from: 'outLap',
      to: push,
      input: inputs().frames(2, f(onOutLap(2_500, 3))).frame(f(onOutLap(4_950, 3))).frame(f(car0({ ds: 'outLap', ps: 'none', d: 3, lap: 3, timerMs: 50 }))),
    },
    // the in lap
    { name: 'into the pit lane on the out lap (not yet seen): outLap -> inLap', from: 'outLap', to: 'inLap', input: onOut().frame(f(car0({ ds: 'outLap', ps: 'pitting', d: 2_700 }))) },
    { name: 'the session’s end on the out lap: the result status finished mid-lap (not yet seen): outLap -> inLap', from: 'outLap', to: 'inLap', input: onOut().frame(f(car0({ ds: 'outLap', ps: 'none', d: 2_600, rs: 'finished' }))) },
    { name: `the in-lap driver status on track, a frame after the line (SgQ car 8 at 221.986): ${push} -> inLap`, from: push, to: 'inLap', input: inputs().frames(2, f(pushing(4_920, 1))).frame(f(pushing(1, 2, 0))).frame(f(inLapOnTrack(2, 2, 33))) },
    { name: `the pit entry with the driver status still flying (ps 0 -> 1): ${push} -> inLap`, from: push, to: 'inLap', input: onPush().frame(f(car0({ ds: 'flyingLap', ps: 'pitting', d: 4_960, lap: 2 }))) },
    {
      name: `the session’s end: the result status finished mid-lap, the lap number up, the lap distance not at the line (SgQ 900.594 car 0): ${push} -> inLap`,
      from: push,
      to: 'inLap',
      input: inputs().frames(3, f(pushing(4_818, 2))).frame(f(car0({ ds: 'inLap', ps: 'none', d: 4_818, lap: 3, rs: 'finished' }))),
    },
    {
      name: `the session’s end with the driver status still flying (MiP 1653.061 car 4: rs 2 -> 3, lap 4 -> 5 at d 3457): ${push} -> inLap`,
      from: push,
      to: 'inLap',
      input: inputs().frames(3, f(pushing(3_456, 4))).frame(f(car0({ ds: 'flyingLap', ps: 'none', d: 3_457, lap: 5, rs: 'finished' }))),
    },
    { name: `the session’s end by the session phase alone (post-session, an online session’s simulated end): ${push} -> inLap`, from: push, to: 'inLap', input: onPush().frame(f(t.sessionPhase('postSession'), pushing(2_100, 2))) },
    { name: 'through the pit lane without the garage, ps 1 -> 0 after the in lap (not yet seen): inLap -> outLap', from: 'inLap', to: 'outLap', input: onIn().frames(2, f(inPitLane(4_990, 2))).frame(f(inPitLane(100, 3))).frame(f(car0({ ds: 'outLap', ps: 'none', d: 300, lap: 3 }))) },
    // finished
    { name: 'an out lap reaches the line as the result status turns finished (not yet seen): outLap -> finished', from: 'outLap', to: 'finished', input: inputs().frames(3, f(onOutLap(4_980))).frame(f(car0({ ds: 'outLap', ps: 'none', d: 5, rs: 'finished' }))) },
    { name: `the chequered flag at the line: the result status turns finished as the lap distance wraps (§2.10; not yet seen): ${push} -> finished`, from: push, to: 'finished', input: finished() },
    {
      name: 'the line after the session’s end ended the push: the chequered flag’s last lap (not yet seen): inLap -> finished',
      from: 'inLap',
      to: 'finished',
      input: inputs()
        .frames(2, f(pushing(3_000, 2)))
        .frame(f(car0({ ds: 'flyingLap', ps: 'none', d: 3_100, lap: 2, rs: 'finished' })))
        .frames(2, f(car0({ ds: 'flyingLap', ps: 'none', d: 4_990, lap: 2, rs: 'finished' })))
        .frame(f(car0({ ds: 'onTrack', ps: 'none', d: 6, lap: 2, rs: 'finished' }))),
    },
  ];
};
