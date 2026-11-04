// Stints and pit stops from the car's activity spans (contract C10, C13, C18, C26; migration Task 17, supervisor rulings
// 1-3, 7, 8). A pit stop is a visit that stopped in the box: one record per `boxStop` span, and per `servingPenalty` span
// during which the car stopped in its box (the pit-stop timer); it describes its pit exit (car-location's pitLane ->
// track) even when recorded later, its flag comes from the spans open then (`membershipOf`), and it is `penaltyServed`
// when its `servingPenalty` span closed confirmed. A stint closes when a `boxStop` or `garage` span (or a stop-in-box
// `servingPenalty`) ends on a different set: a compound change, or a lower age than the old set's; a stint closed by a
// stop-in-box `servingPenalty` describes that visit's pit exit (car-location's pitLane -> track, C26), recorded when
// known and at the latest on the frame the span closes (round 2 ruling 5); the session's end (its `postSession` span)
// closes the open stints. Ported from test/history/stints-pit-stops.test.ts; the rows of the
// served-penalty marks by DTSV/SGSV events (`RecorderInput.tracked`) are replaced by the servingPenalty rows below.
import { describe, expect, it } from 'vitest';
import type { EventDetails, SessionPacket } from '@pitwall/protocol';
import { membershipOf } from '../../src/readers.ts';
import { situationOf } from '../../src/situations/run.ts';
import { ScenarioBuilder, type FrameDraft } from '../builders/index.ts';
import type { DeepPartial } from '../builders/packet.ts';
import { gridStart, lap, LIGHTS_OUT, raceAt, run, script, type Beat } from '../situations/script.ts';
import { runScenario } from '../support/run.ts';
import { after } from '../support/runner.ts';

const car0 = (d: FrameDraft) => d.lapData.lapData[0]!;
const OLD = { actualTyreCompound: 18, visualTyreCompound: 17, tyresAgeLaps: 3 }, NEW = { actualTyreCompound: 19, visualTyreCompound: 18, tyresAgeLaps: 0 };

describe('stints', () => {
  // [lap, pitStatus, fresh set]: the race goes racing at the lap rise on frame 1 (the activity opens racingLap there);
  // the pit entry on lap 5 (inLap), the box (boxStop) and the pit exit; the old stint closes on the frame the box stop
  // ends (frame number `closedAt`), the new one at the post-session.
  it.each([
    ['line in the pit lane before the box', [[1, 0, 0], [2, 0, 0], [3, 0, 0], [4, 0, 0], [5, 0, 0], [5, 1, 0], [6, 1, 0], [6, 2, 1], [6, 0, 1], [7, 0, 1]], 9],
    ['box before the line', [[1, 0, 0], [2, 0, 0], [3, 0, 0], [4, 0, 0], [5, 0, 0], [5, 1, 0], [5, 2, 1], [6, 1, 1], [6, 0, 1], [7, 0, 1]], 8],
  ] as const)('closes when the box stop ends on a new set (%s); the post-session (SEND) closes the open stint on the frame it opens', (_, seq, closedAt) => {
    const { st, results } = runScenario(new ScenarioBuilder({ cars: 1 }).frames(seq.length, (d) => {
      const [lap, pitStatus, fresh] = seq[d.index]!;
      Object.assign(car0(d), { currentLapNum: lap, pitStatus, lastLapTimeInMs: 80_000 });
      Object.assign(d.status.carStatusData[0]!, fresh ? NEW : OLD);
    }).event({ code: 'SEND' }));                                                  // attaches to the last frame (Task 11)
    expect(st.history.spans['car-activity-race']?.find((s) => s.kind === 'boxStop')).toMatchObject({ endFrame: closedAt });
    expect(st.history.stints).toEqual([
      { carId: 0, firstLap: 1, lastLap: 5, actualCompound: 'C3', visualCompound: 'medium', tyreAgeAtFitting: 3, frame: closedAt },
      { carId: 0, firstLap: 6, lastLap: 6, actualCompound: 'C2', visualCompound: 'hard', tyreAgeAtFitting: 0, frame: 10 }]);
    expect(results.filter((r) => r.changed.has('stints'))).toHaveLength(2);
  });
  it('a fresh set of the same compound (age drops) fitted in the box also starts a new stint', () => {
    // [lap, pitStatus, tyre age]: the race joined on lap 4, the entry, the box (the fresh set) and the pit exit on lap 4
    const seq = [[4, 0, 7], [4, 1, 7], [4, 2, 0], [4, 0, 0], [5, 0, 0]] as const;
    const { st } = runScenario(new ScenarioBuilder({ cars: 1 }).frames(seq.length, (d) => {
      Object.assign(car0(d), { currentLapNum: seq[d.index]![0], pitStatus: seq[d.index]![1], lastLapTimeInMs: 80_000 });
      Object.assign(d.status.carStatusData[0]!, { ...OLD, tyresAgeLaps: seq[d.index]![2] });
    }));
    expect(st.history.stints).toMatchObject([{ firstLap: 4, lastLap: 4, tyreAgeAtFitting: 7, frame: 4 }]);
  });
  it('a set change seen on track, with no box stop and no garage span, closes no stint (ruling 3)', () => {
    const { st } = runScenario(new ScenarioBuilder({ cars: 1 }).frames(3, (d) => {
      Object.assign(car0(d), { currentLapNum: 4 + d.index, lastLapTimeInMs: 80_000 });
      Object.assign(d.status.carStatusData[0]!, { ...OLD, tyresAgeLaps: d.index === 0 ? 7 : 0 });
    }));
    expect(st.history.stints).toEqual([]);
  });
  it('a box stop that fits no new set closes no stint', () => {
    const seq = [[4, 0], [4, 1], [4, 2], [4, 0], [5, 0]] as const;
    const { st } = runScenario(new ScenarioBuilder({ cars: 1 }).frames(seq.length, (d) => {
      Object.assign(car0(d), { currentLapNum: seq[d.index]![0], pitStatus: seq[d.index]![1], lastLapTimeInMs: 80_000 });
      Object.assign(d.status.carStatusData[0]!, OLD);
    }));
    expect(st.history.pitStops).toHaveLength(1);
    expect(st.history.stints).toEqual([]);
  });

  // Review RE-B5 (branch w2/laps): the change is seen in the box; by the time the in lap is done the fresh set's age may
  // have counted up to the old set's, so the stint changes where the box stop ends, at the age the set was fitted at.
  /** Box before the line, same compound: the old set has age `fitted + 1`, the fresh one `fitted`, counting up on frame `countsUpAt`. */
  const sameCompoundStop = (fitted: number, countsUpAt: number) => {
    // [lap, pitStatus, fresh set]
    const seq = [[4, 0, 0], [5, 0, 0], [5, 1, 0], [5, 2, 1], [5, 1, 1], [5, 0, 1], [6, 0, 1], [7, 0, 1]] as const;
    return runScenario(new ScenarioBuilder({ cars: 1 }).frames(seq.length, (d) => {
      const [lap, pitStatus, fresh] = seq[d.index]!;
      Object.assign(car0(d), { currentLapNum: lap, pitStatus, lastLapTimeInMs: 80_000 });
      const age = !fresh ? fitted + 1 : d.index < countsUpAt ? fitted : d.index < 7 ? fitted + 1 : fitted + 2;
      Object.assign(d.status.carStatusData[0]!, { ...OLD, tyresAgeLaps: age });
    }).event({ code: 'SEND' }));
  };
  it.each([
    ['fitted at age 0, its age counts up at the line', 0, 6],
    ['fitted at age 1, its age counts up at the line', 1, 6],
    ['fitted at age 0, its age counts up at the pit exit', 0, 5],
  ])('a same-compound set fitted at age 0 or 1 opens a stint at the box exit (%s)', (_, fitted, countsUpAt) => {
    const { st } = sameCompoundStop(fitted, countsUpAt);
    expect(st.history.stints.map(({ firstLap, lastLap, frame }) => [firstLap, lastLap, frame])).toEqual([[4, 5, 5], [6, 6, 8]]);
  });
  it('the stint of a same-compound set whose age caught up before the in lap ended starts at the age it was fitted at', () => {
    const { st } = sameCompoundStop(0, 6);
    expect(st.history.stints[1]).toEqual({ carId: 0, firstLap: 6, lastLap: 6, actualCompound: 'C3', visualCompound: 'medium', tyreAgeAtFitting: 0, frame: 8 });
  });

  it('a car that competes no more (notCompeting) keeps its stint until the session’s end closes it (ruling 3)', () => {
    // the race under way (lap timer 30 s); car 0 retires (result status 7) on frame 2; SEND on the last frame
    const { st, results } = runScenario(new ScenarioBuilder({ cars: 2 }).frames(4, (d) => {
      Object.assign(car0(d), { currentLapNum: d.index === 0 ? 3 : 4, currentLapTimeInMs: 30_000, lastLapTimeInMs: 80_000, resultStatus: d.index >= 2 ? 7 : 2 });
      Object.assign(d.status.carStatusData[0]!, OLD);
    }).event({ code: 'SEND' }));
    expect(situationOf(st).byMachine['car-activity-race']?.find((s) => s.carId === 0)?.kind).toBe('notCompeting');
    expect(st.history.stints.filter((s) => s.carId === 0)).toEqual([
      { carId: 0, firstLap: 3, lastLap: 3, actualCompound: 'C3', visualCompound: 'medium', tyreAgeAtFitting: 3, frame: 4 }]);
    expect(results.map((r) => r.changed.has('stints'))).toEqual([false, false, false, true]);
  });
  it('the simulated end (the online shape, no SEND) closes the open stint on the frame the post-session opens (C10, C36)', () => {
    // Car 0 completes lap 1 at race frame 30 and lap 2 at race frame 60; the clock jumps 6000 s ahead at race frame 100.
    const { runner } = run(script(gridStart(150, (k) => ({
      ...(k >= 100 && { at: raceAt(k) + 6_000_000 }),
      cars: (d) => {
        lap(d, 0, { currentLapNum: k < 30 ? 1 : k < 60 ? 2 : 3, lastLapTimeInMs: 80_000 });
        Object.assign(d.status.carStatusData[0]!, OLD);
      },
    }))));
    expect(runner.state.history.stints.filter((s) => s.carId === 0)).toMatchObject([{ firstLap: 1, frame: LIGHTS_OUT + 1 + 100 + 1 }]);
  });
});

describe('pit stops', () => {
  const steps = [{ currentLapNum: 5 }, { pitStatus: 1, pitLaneTimerActive: 1, pitLaneTimeInLaneInMs: 0 },
    { pitStatus: 2, pitLaneTimeInLaneInMs: 9_000, pitStopTimerInMs: 1_200 }, { pitStopTimerInMs: 2_400, pitLaneTimeInLaneInMs: 10_000 },
    { pitStatus: 1, pitLaneTimeInLaneInMs: 21_800 }, { pitStatus: 0, pitLaneTimerActive: 0, pitLaneTimeInLaneInMs: 0 }];
  const visit = (d: FrameDraft) => { Object.assign(car0(d), steps[d.index]); };
  /**
   * t = 0, 6000 (entry), 12000 (box), …, 30000 (exit): the race joined on lap 5, racingLap; inLap, boxStop, outLap. `sc`:
   * a safety car status from frame `sc` on (the race's neutralised span opens there).
   */
  const stop = (o: { sc?: number } = {}) => {
    const b = new ScenarioBuilder({ cars: 1, stepMs: 6000 });
    for (let i = 0; i < steps.length; i++) {
      if (o.sc === i) b.session({ safetyCarStatus: 1 });
      b.frame(visit);
    }
    return runScenario(b);
  };
  it('records the box stop: entry, exit, the game’s pit-lane time and the stationary time, describing the pit exit', () => {
    const { st, results } = stop();
    expect(st.history.spans['car-activity-race']?.map((s) => s.kind)).toEqual(['racingLap', 'inLap', 'boxStop']);
    expect(st.history.pitStops).toEqual([{ carId: 0, lap: 5, pitLaneEntry: 6_000, pitLaneExit: 30_000, pitLaneTimeMs: 21_800,
      stationaryTimeMs: 2_400, flag: 'green', penaltyServed: false, frame: 6 }]);
    expect(results[5]!.changed.has('pitStops')).toBe(true);
  });
  it.each([
    ['out from the pit entry', 1],
    ['out after the box, before the pit exit', 4],
  ])('takes its flag from the spans open at the pit exit (C26): a safety car %s flags it sc', (_, sc) => {
    expect(stop({ sc }).st.history.pitStops[0]).toMatchObject({ flag: 'sc', penaltyServed: false });
  });
  it('leaving the garage is not a pit stop', () => {
    // the race under way; car 0 in its garage (driver status 0), out of it into the pit lane, then onto the track
    const seq = [[0, 1], [3, 1], [3, 0], [4, 0]] as const;
    const { st } = runScenario(new ScenarioBuilder({ cars: 1 }).frames(seq.length, (d) => {
      Object.assign(car0(d), { currentLapNum: 2, driverStatus: seq[d.index]![0], pitStatus: seq[d.index]![1] });
    }));
    expect(st.history.pitStops).toEqual([]);
  });
});

/**
 * A race under way (lap timer 30 s), one frame a second, car 0 per frame `[lap, pitStatus, pitStopTimerMs, fresh set,
 * unserved drive-throughs]`, with `events` and Session fields `session` sent before frame i. The game's pit lane timer
 * never runs, so a pit stop's pit-lane time is the time seen from the entry to the exit.
 */
type VisitRow = readonly [lap: number, pitStatus: number, stopTimerMs: number, fresh: 0 | 1, owed: number];
const racing = (rows: readonly VisitRow[], o: { events?: Record<number, EventDetails[]>; session?: Record<number, DeepPartial<SessionPacket>> } = {}) => {
  const b = new ScenarioBuilder({ cars: 1, stepMs: 1000 });
  rows.forEach(([lap, pitStatus, pitStopTimerInMs, fresh, numUnservedDriveThroughPens], i) => {
    for (const e of o.events?.[i] ?? []) b.event(e);
    const session = o.session?.[i];
    if (session) b.session(session);
    b.frame((d) => {
      Object.assign(car0(d), { currentLapNum: lap, pitStatus, pitStopTimerInMs, numUnservedDriveThroughPens, currentLapTimeInMs: 30_000, lastLapTimeInMs: 80_000 });
      Object.assign(d.status.carStatusData[0]!, fresh ? NEW : OLD);
    });
  });
  return b;
};
const PENA_DRIVE_THROUGH: EventDetails = { code: 'PENA', penaltyType: 0, infringementType: 38, vehicleIdx: 0, otherVehicleIdx: 255, time: 255, lapNum: 5, placesGained: 0 };
const DTSV: EventDetails = { code: 'DTSV', vehicleIdx: 0 };
/**
 * The drive-through of inventory §2.7 served on a visit that changed tyres: given on frame 1; the pit entry on frame 3
 * (servingPenalty), the box and the new set on frames 4-5 (stationary 2.4 s), the pit exit on frame 7 (number 8) under
 * a VSC (from frame 6), the DTSV on frame 8 after the VSC ended (the span closes confirmed there); the line into lap 6 on
 * frame 9, into lap 7 on frame 10, which carries SEND.
 */
const SERVED_ON_A_STOP: readonly VisitRow[] = [
  [5, 0, 0, 0, 0], [5, 0, 0, 0, 1], [5, 0, 0, 0, 1], [5, 1, 0, 0, 1], [5, 2, 1_200, 0, 1], [5, 2, 2_400, 1, 1],
  [5, 1, 2_400, 1, 1], [5, 0, 0, 1, 1], [5, 0, 0, 1, 0], [6, 0, 0, 1, 0], [7, 0, 0, 1, 0],
];
const servedOnAStop = () => runScenario(racing(SERVED_ON_A_STOP, {
  events: { 1: [PENA_DRIVE_THROUGH], 8: [DTSV] },
  session: { 6: { safetyCarStatus: 2 }, 8: { safetyCarStatus: 0 } },
}).event({ code: 'SEND' }));

describe('a drive-through served on a visit (rulings 1, 2, 8)', () => {
  it('the visit is one servingPenalty span, open past the pit exit and closed confirmed on the DTSV frame', () => {
    const { st } = servedOnAStop();
    const activity = st.history.spans['car-activity-race']?.filter((s) => s.carId === 0);
    expect(activity?.map((s) => [s.kind, s.startFrame, s.endFrame, s.confirmed])).toEqual([['racingLap', 1, 4, true], ['servingPenalty', 4, 9, true], ['outLap', 9, 10, true]]);
    expect(st.history.spans['car-location']?.find((s) => s.carId === 0 && s.kind === 'pitLane')).toMatchObject({ startFrame: 4, endFrame: 8 });
  });
  it('a drive-through served on a visit that changed tyres is one pit stop with penaltyServed, and its stint changes', () => {
    const { st, results } = servedOnAStop();
    expect(st.history.pitStops).toEqual([{ carId: 0, lap: 5, pitLaneEntry: 3_000, pitLaneExit: 7_000, pitLaneTimeMs: 4_000, stationaryTimeMs: 2_400,
      flag: 'vsc', penaltyServed: true, frame: 8 }]);
    // the old stint describes the pit exit (frame 7, number 8), recorded there or at the latest on the DTSV frame (frame 8)
    const tagged = results.flatMap((r, i) => (r.changed.has('stints') ? [i] : []));
    expect(tagged).toHaveLength(2);
    expect([7, 8]).toContain(tagged[0]);
    expect(tagged[1]).toBe(10);
    expect(st.history.stints).toEqual([
      { carId: 0, firstLap: 5, lastLap: 5, actualCompound: 'C3', visualCompound: 'medium', tyreAgeAtFitting: 3, frame: 8 },
      { carId: 0, firstLap: 6, lastLap: 6, actualCompound: 'C2', visualCompound: 'hard', tyreAgeAtFitting: 0, frame: 11 }]);
  });
  it('a pit stop whose drive-through is confirmed after the exit describes the exit frame and belongs to the spans open then', () => {
    const { st, results } = servedOnAStop();
    const [stop] = st.history.pitStops;
    expect(stop!.frame).toBe(8);
    // recorded on the DTSV frame (frame 8, number 9), not at the exit
    expect(results.map((r) => r.changed.has('pitStops'))).toEqual(SERVED_ON_A_STOP.map((_, i) => i === 8));
    const member = membershipOf({ history: st.history, situation: situationOf(st) }, stop!);
    expect(member['car-location']).toMatchObject({ kind: 'track', startFrame: 8 });
    expect(member['car-activity-race']).toMatchObject({ kind: 'servingPenalty', startFrame: 4 });
    expect(member['session-phase-race']).toMatchObject({ kind: 'neutralised', detail: { car: 'VSC' } });
  });
  it('a stop-in-box servingPenalty whose drive-through is never confirmed (10 s past the exit) is one pit stop, not served (C18)', () => {
    // no DTSV: the span closes confirmed: false on the first frame more than 10 s after the exit (frame 18 at 18 s)
    const rows: VisitRow[] = [...SERVED_ON_A_STOP.slice(0, 8), ...Array.from({ length: 12 }, (): VisitRow => [5, 0, 0, 1, 1])];
    const { st, results } = runScenario(racing(rows, { events: { 1: [PENA_DRIVE_THROUGH] } }));
    expect(st.history.spans['car-activity-race']?.find((s) => s.kind === 'servingPenalty')).toMatchObject({ endFrame: 19, confirmed: false });
    expect(st.history.pitStops).toEqual([{ carId: 0, lap: 5, pitLaneEntry: 3_000, pitLaneExit: 7_000, pitLaneTimeMs: 4_000, stationaryTimeMs: 2_400,
      flag: 'green', penaltyServed: false, frame: 8 }]);
    expect(results.findIndex((r) => r.changed.has('pitStops'))).toBe(18);
    // its stint closes on the new set, describing the pit exit, recorded at the latest on the frame the span closes
    expect(st.history.stints).toEqual([{ carId: 0, firstLap: 5, lastLap: 5, actualCompound: 'C3', visualCompound: 'medium', tyreAgeAtFitting: 3, frame: 8 }]);
    const tagged = results.findIndex((r) => r.changed.has('stints'));
    expect(tagged).toBeGreaterThanOrEqual(7);
    expect(tagged).toBeLessThanOrEqual(18);
  });
  it('a drive-through pass gives no pit stop and marks none served', () => {
    // a box stop on lap 3 (no penalty), then the drive-through given on lap 4 and served by a pass: pit status 1 only, the stop timer 0
    const rows: VisitRow[] = [
      [3, 0, 0, 0, 0], [3, 1, 0, 0, 0], [3, 2, 1_500, 0, 0], [3, 0, 0, 0, 0], [4, 0, 0, 0, 0],
      [4, 0, 0, 0, 1], [4, 1, 0, 0, 1], [4, 1, 0, 0, 1], [4, 0, 0, 0, 1], [4, 0, 0, 0, 0], [5, 0, 0, 0, 0],
    ];
    const { st } = runScenario(racing(rows, { events: { 5: [{ ...PENA_DRIVE_THROUGH, lapNum: 4 } as EventDetails], 9: [DTSV] } }));
    expect(st.history.spans['car-activity-race']?.find((s) => s.kind === 'servingPenalty')).toMatchObject({ startFrame: 7, endFrame: 10, confirmed: true });
    expect(st.history.pitStops).toEqual([{ carId: 0, lap: 3, pitLaneEntry: 1_000, pitLaneExit: 3_000, pitLaneTimeMs: 2_000, stationaryTimeMs: 1_500,
      flag: 'green', penaltyServed: false, frame: 4 }]);
  });
});

// Ruling 7 (SgW, Task 11): 9 inLap -> outLap pairs with no stop. A lap that holds such a pair is an in lap and an out lap
// by the activity spans; no pit stop.
describe('a pass through the pit lane without a stop', () => {
  it('a lap that holds an inLap -> outLap pair with no box stop is an in lap and an out lap; no pit stop', () => {
    const rows: VisitRow[] = [[5, 0, 0, 0, 0], [6, 0, 0, 0, 0], [6, 1, 0, 0, 0], [6, 1, 0, 0, 0], [6, 0, 0, 0, 0], [7, 0, 0, 0, 0]];
    const { st } = runScenario(racing(rows));
    expect(st.history.spans['car-activity-race']?.map((s) => s.kind)).toEqual(['racingLap', 'inLap', 'outLap']);
    expect(st.history.laps.find((l) => l.lapNumber === 6)).toMatchObject({ inLap: true, outLap: true });
    expect(st.history.pitStops).toEqual([]);
    expect(st.history.stints).toEqual([]);
  });
});

// Review Focus 1: a flashback from after a pit exit to inside the pit lane voids the pit stop recorded at the exit; the
// replay records it again at the exit of the new timeline, and the projection equals a run that never received the
// undone frames (C26, C27, C33).
describe('a flashback across a pit exit (Review Focus 1)', () => {
  /** Index of race frame k of `gridStart` among the frames. */
  const raceFrame = (k: number) => LIGHTS_OUT + 1 + k;
  /**
   * Car 0's race: the pit entry at race frame 20, the line in the pit lane at 25, the box from 30 to 39 (the new set from
   * 35), leaving it at 40, the pit exit at `exitAt`, the line on track at 150.
   */
  const visit = (exitAt: number) => (k: number): Beat => ({
    cars: (d) => {
      lap(d, 0, {
        currentLapNum: k < 25 ? 1 : k < 150 ? 2 : 3,
        lapDistance: k < 25 ? 3000 + 40 * k : 10 + 20 * (k < 150 ? k - 25 : k - 150),
        lastLapTimeInMs: 80_000,
        pitStatus: k < 20 || k >= exitAt ? 0 : k >= 30 && k < 40 ? 2 : 1,
        pitStopTimerInMs: k >= 30 && k < exitAt ? Math.min(k - 30, 9) * 16 + 16 : 0,
      });
      Object.assign(d.status.carStatusData[0]!, k >= 35 ? NEW : OLD);
    },
  });
  const records = (r: ReturnType<typeof run>['runner']) => {
    const { pitStops, stints, laps } = r.state.history;
    return { pitStops, stints, laps };
  };

  it('the pit stop is recorded once, at the exit of the timeline that happened; pit stops, stints and laps equal a straight run', () => {
    const first = script(gridStart(200, visit(60))).slice(0, raceFrame(100) + 1);
    const fork = script(gridStart(200, visit(70)));
    const { runner } = run(first);
    expect(runner.state.history.pitStops.map((p) => p.pitLaneExit)).toEqual([raceAt(60)]);
    for (const f of after(fork, raceFrame(51), raceFrame(101))) runner.apply(f);
    const fresh = run(fork).runner;
    expect(records(runner)).toEqual(records(fresh));
    expect(fresh.state.history.pitStops).toMatchObject([{ carId: 0, lap: 1, pitLaneEntry: raceAt(20), pitLaneExit: raceAt(70), frame: raceFrame(70) + 1 }]);
    expect(fresh.state.history.stints.filter((st) => st.carId === 0)).toMatchObject([{ firstLap: 1, lastLap: 1, visualCompound: 'medium', frame: raceFrame(40) + 1 }]);
  });
});
