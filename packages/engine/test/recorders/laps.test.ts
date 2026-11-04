// The laps recorder (contract C10, C13, C25, C26, C29; migration Task 17): laps by crossings of the line (the lap number
// going up), confirmed from Session History; in lap and out lap from the car's activity spans during the lap, the SC and
// VSC shares from the session's `neutralised` span; no lap while the car cools down or competes no more or the session is
// over. A session with no activity span (a time trial, a pending weekend phase, a race before its start) records laps by
// crossings, with neither in lap nor out lap. Ported from test/history/laps.test.ts.
import { describe, expect, it } from 'vitest';
import { known, unknown } from '@pitwall/domain';
import { ScenarioBuilder, type FrameDraft } from '../builders/index.ts';
import { membershipOf } from '../../src/readers.ts';
import { situationOf } from '../../src/situations/run.ts';
import { gridStart, lap as lapOf, raceAt, run, script } from '../situations/script.ts';
import { runFrames, runScenario } from '../support/run.ts';

// The lap-start and lap-end samples are pinned in lap-start-samples.test.ts and lap-end-samples.test.ts; here they only have to be there.
const lapEnd = { wearAtStartPct: expect.anything(), ersStoreAtStartJ: expect.anything(), wearAtEndPct: expect.anything(),
  ersStoreAtEndJ: expect.anything(), ersDeployedJ: expect.anything(), ersHarvestedJ: expect.anything(), damageAtEnd: expect.anything(),
  channelRange: expect.anything() };
const car0 = (d: FrameDraft) => d.lapData.lapData[0]!;
// frames 0–2 = lap 1 (sector 1 at frame 1, sector 2 + fuel 48.5 at frame 2); frame 3 = lap 2 begins; frame 4 = lap 2
const lapOne = () => new ScenarioBuilder({ cars: 1 }).frames(5, (d) => {
  const s = d.status.carStatusData[0]!;
  if (d.index === 0) Object.assign(s, { actualTyreCompound: 18, visualTyreCompound: 17, fuelInTank: 50, tyresAgeLaps: 3 });
  if (d.index === 1) car0(d).sector1TimeMs = 30_000;
  if (d.index === 2) { car0(d).sector2TimeMs = 31_000; s.fuelInTank = 48.5; }
  if (d.index === 3) Object.assign(car0(d), { currentLapNum: 2, lastLapTimeInMs: 90_500, sector1TimeMs: 0, sector2TimeMs: 0 });
});

describe('laps', () => {
  it('appends a provisional lap when currentLapNum goes up', () => {
    const { st, frames, results } = runScenario(lapOne());
    const end = frames[3]!.sessionTime;
    expect(st.history.laps).toEqual([{ carId: 0, lapNumber: 1, lapTimeMs: 90_500, sectorTimesMs: [30_000, 31_000, 29_500],
      valid: { lap: true, sectors: [true, true, true] }, actualCompound: 'C3', visualCompound: 'medium', tyreAgeAtStart: 3,
      fuelAtStartKg: known(50, 0), fuelAtEndKg: known(48.5, end), scShare: 0, vscShare: 0, inLap: false, outLap: false,
      positionAtEnd: 1, status: 'provisional', completedAt: end, ...lapEnd, frame: 4 }]);
    expect(results.map((r) => r.changed.has('laps'))).toEqual([false, false, false, true, false]);
  });
  it('a lost frame cannot swallow a lap: without the frame where the lap number changes there is still exactly one lap', () => {
    const frames = lapOne().build();
    const { st } = runFrames(frames.filter((_, i) => i !== 3));
    expect(st.history.laps.map((l) => [l.lapNumber, l.lapTimeMs, l.status])).toEqual([[1, 90_500, 'provisional']]);
  });
  it('confirms from SessionHistory: appends a confirmed record, the authoritative value wins, the correction is reported once', () => {
    const history = { carIdx: 0, numLaps: 2, lapHistoryData: [
      { lapTimeInMs: 90_520, sector1TimeMs: 30_000, sector2TimeMs: 31_010, sector3TimeMs: 29_509, lapValidBitFlags: 0b1011 },
      { lapValidBitFlags: 0b1111 }] };                                             // lap 2 = the partial current lap (time 0)
    const { st, results } = runScenario(lapOne().frames(2, (d) => { d.add('sessionHistory', history); }));
    expect(st.history.laps).toHaveLength(2);
    expect(st.history.laps[1]).toMatchObject({ carId: 0, lapNumber: 1, status: 'confirmed', lapTimeMs: 90_520, sectorTimesMs: [30_000, 31_010, 29_509],
      valid: { lap: true, sectors: [true, false, true] }, tyreAgeAtStart: 3, positionAtEnd: 1, fuelAtStartKg: known(50, 0) });
    expect(results[5]!.corrections).toEqual([
      { carId: 0, lapNumber: 1, field: 'lapTimeMs', provisional: 90_500, confirmed: 90_520 },
      { carId: 0, lapNumber: 1, field: 'sector2Ms', provisional: 31_000, confirmed: 31_010 }]);
    expect(results[6]!.corrections).toEqual([]);
  });
  it('a confirmed lap names the provisional it supersedes by its id (C21, C25); both stay in the log and the projection', () => {
    const history = { carIdx: 0, numLaps: 2, lapHistoryData: [
      { lapTimeInMs: 90_520, sector1TimeMs: 30_000, sector2TimeMs: 31_010, sector3TimeMs: 29_509, lapValidBitFlags: 0b1111 }, { lapValidBitFlags: 0b1111 }] };
    const { st } = runScenario(lapOne().frames(2, (d) => { d.add('sessionHistory', history); }));
    expect(st.history.laps.map((l) => [l.status, l.supersedes])).toEqual([['provisional', undefined], ['confirmed', { list: 'laps', index: 0 }]]);
    expect(st.log.laps).toEqual(st.history.laps);
    expect(st.history.laps[0]).not.toHaveProperty('supersedes');
  });
  it('the confirmed lap names its own car’s provisional, wherever the other cars’ laps put it in the list', () => {
    // car 1 completes lap 1 on frame 2, car 0 on frame 3: car 0's provisional is the list's second lap (id 1)
    const b = new ScenarioBuilder({ cars: 2 }).frames(5, (d) => {
      if (d.index >= 2) Object.assign(d.lapData.lapData[1]!, { currentLapNum: 2, lastLapTimeInMs: 88_000 });
      if (d.index >= 3) Object.assign(car0(d), { currentLapNum: 2, lastLapTimeInMs: 90_500 });
      if (d.index === 4) d.add('sessionHistory', { carIdx: 0, numLaps: 2, lapHistoryData: [{ lapTimeInMs: 90_500, lapValidBitFlags: 0b1111 }, { lapValidBitFlags: 0b1111 }] });
    });
    const { st } = runScenario(b);
    expect(st.history.laps.map((l) => [l.carId, l.status, l.supersedes])).toEqual([
      [1, 'provisional', undefined],
      [0, 'provisional', undefined],
      [0, 'confirmed', { list: 'laps', index: 1 }],
    ]);
  });
  it('a confirmed lap keeps the time it was completed, not the time Session History confirmed it', () => {
    const history = { carIdx: 0, numLaps: 2, lapHistoryData: [
      { lapTimeInMs: 90_500, sector1TimeMs: 30_000, sector2TimeMs: 31_000, sector3TimeMs: 29_500, lapValidBitFlags: 0b1111 }, { lapValidBitFlags: 0b1111 }] };
    const { st, frames } = runScenario(lapOne().frames(3, () => {}).frames(1, (d) => { d.add('sessionHistory', history); }));
    const completed = frames[3]!.sessionTime, confirmedAt = frames[8]!.sessionTime;
    expect(confirmedAt).toBeGreaterThan(completed);
    expect(st.history.laps.map((l) => [l.status, l.completedAt])).toEqual([['provisional', completed], ['confirmed', completed]]);
  });
  // The race under way from the first frame (every lap timer 30 s in), so `session-phase-race` joins it racing and a
  // safety car status opens its `neutralised` span (the status alone, no SCAR).
  const underWay = (d: FrameDraft) => { car0(d).currentLapTimeInMs = 30_000; };
  it('SC/VSC share = share of the lap’s session time while the session’s neutralised span was open, by its car', () => {
    const { st } = runScenario(new ScenarioBuilder({ cars: 1, stepMs: 1000 }).frames(1, underWay)
      .session({ safetyCarStatus: 1 }).frames(1, underWay)          // (0, 1000]     neutralised, SC
      .session({ safetyCarStatus: 2 }).frames(1, underWay)          // (1000, 2000]  neutralised, VSC
      .session({ safetyCarStatus: 0 }).frames(1, underWay)          // (2000, 3000]  racing
      .frames(1, (d) => Object.assign(car0(d), { currentLapNum: 2, lastLapTimeInMs: 4_000, currentLapTimeInMs: 30_000 })));
    expect(st.history.spans['session-phase-race']?.map((s) => s.kind)).toEqual(['racing', 'neutralised', 'neutralised']);
    expect(st.history.laps[0]).toMatchObject({ scShare: 0.25, vscShare: 0.25 });
  });
  it('a safety car status with no neutralised span open (on the grid, before the race is under way) adds no share', () => {
    const { st } = runScenario(new ScenarioBuilder({ cars: 1, stepMs: 1000 }).frames(1, () => {})
      .session({ safetyCarStatus: 1 }).frames(2, () => {})
      .session({ safetyCarStatus: 0 }).frames(1, () => {})
      .frames(1, (d) => Object.assign(car0(d), { currentLapNum: 2, lastLapTimeInMs: 4_000 })));
    // the grid until the lap number goes up (the race under way, racing from frame 5): no neutralised span ever opens
    const phases = [...(st.history.spans['session-phase-race'] ?? []), ...(situationOf(st).byMachine['session-phase-race'] ?? [])];
    expect(phases.map((s) => s.kind)).toEqual(['grid', 'racing']);
    expect(st.history.laps[0]).toMatchObject({ scShare: 0, vscShare: 0 });
  });
  it('in-lap = the car’s pit entry (an inLap span opens) during the lap; out-lap = an outLap span during the lap (from the activity spans)', () => {
    // [lap, pitStatus]: the race joined on lap 2 (racingLap); the entry on lap 3 (inLap), the line in the pit lane, the
    // box (boxStop) and the pit exit (outLap) on lap 4, racingLap again from the line into lap 5
    const seq = [[2, 0], [3, 0], [3, 1], [4, 1], [4, 2], [4, 0], [5, 0]] as const;
    const { st } = runScenario(new ScenarioBuilder({ cars: 1 }).frames(seq.length, (d) =>
      Object.assign(car0(d), { currentLapNum: seq[d.index]![0], pitStatus: seq[d.index]![1], lastLapTimeInMs: 80_000 })));
    expect(st.history.spans['car-activity-race']?.map((s) => s.kind)).toEqual(['racingLap', 'inLap', 'boxStop', 'outLap']);
    expect(st.history.laps.map((l) => [l.lapNumber, l.inLap, l.outLap])).toEqual([[2, false, false], [3, true, false], [4, false, true]]);
  });
  it('fuel at lap start/end of a restricted car is unknown("restricted")', () => {
    const { st } = runScenario(new ScenarioBuilder({ cars: 2 }).participants({ participants: { 1: { aiControlled: 0, networkId: 5, yourTelemetry: 0 } } })
      .frames(2, (d) => { if (d.index === 1) Object.assign(d.lapData.lapData[1]!, { currentLapNum: 2, lastLapTimeInMs: 80_000 }); }));
    expect(st.history.laps[0]).toMatchObject({ carId: 1, fuelAtStartKg: unknown('restricted'), fuelAtEndKg: unknown('restricted') });
  });
});

// C29: a lap's provisional describes its crossing; one crossed while the race's formation span is open is hidden.
describe('a lap crossed in the formation lap', () => {
  it('a lap crossed while the formation span is open is hidden: the log keeps it as recorded, the projection skips it', () => {
    const { st } = runScenario(new ScenarioBuilder({ cars: 1, stepMs: 1000 }).frames(1, () => {})
      .session({ safetyCarStatus: 3 }).frames(1, () => {})                                          // frame 2: formation
      .frames(2, (d) => Object.assign(car0(d), { currentLapNum: 2, lastLapTimeInMs: 90_000 })));    // frame 3: the crossing
    expect(st.history.spans['session-phase-race']).toMatchObject([{ kind: 'grid', endFrame: 2 }]);
    expect(st.log.laps.map((l) => [l.lapNumber, l.status, l.frame])).toEqual([[1, 'provisional', 3]]);
    expect(st.history.laps).toEqual([]);
  });
});

// Ruling 4 of Task 17: no lap is recorded for a crossing while the car's activity is coolDown or notCompeting, or the
// session phase is postSession. Session History still confirms a lap driven before (the final lap of a finisher).
describe('no lap while the car cools down, competes no more or the session is over', () => {
  /** [lap, lap distance, result status] per frame, one a second, the race under way (lap timer 30 s); 3 = finished, 7 = retired. */
  type Row = readonly [lap: number, distanceM: number, resultStatus: number];
  const race = (rows: readonly Row[], cars = 1) => new ScenarioBuilder({ cars, stepMs: 1000 }).frames(rows.length, (d) => {
    const [currentLapNum, lapDistance, resultStatus] = rows[d.index]!;
    Object.assign(car0(d), { currentLapNum, lapDistance, resultStatus, currentLapTimeInMs: 30_000, lastLapTimeInMs: 90_000 });
  });
  // the car crosses the line into its finish on lap 5 (the lap number stays, as the game's does), then cools down
  const FINISH: readonly Row[] = [[5, 4_900, 2], [5, 5, 3], [5, 300, 3], [5, 2_500, 3]];
  const activity = (st: ReturnType<typeof runScenario>['st']) => st.history.spans['car-activity-race']?.filter((s) => s.carId === 0).map((s) => s.kind);

  it('a lap number that goes up during the cool-down records no lap (only the final lap, at its crossing on frame 1)', () => {
    const { st } = runScenario(race([...FINISH, [6, 10, 3], [6, 400, 3]]));
    expect(activity(st)).toEqual(['racingLap', 'finished']);
    expect(st.history.laps.map((l) => [l.lapNumber, l.status, l.frame])).toEqual([[5, 'provisional', 2]]);
  });
  it('Session History confirms the final lap during the cool-down', () => {
    const entry = { lapTimeInMs: 90_100, sector1TimeMs: 30_000, sector2TimeMs: 30_000, sector3TimeMs: 30_100, lapValidBitFlags: 0b1111 };
    const { st } = runScenario(race(FINISH).frames(1, (d) => {
      Object.assign(car0(d), { lapDistance: 2_600 });
      d.add('sessionHistory', { carIdx: 0, numLaps: 5, lapHistoryData: Array.from({ length: 5 }, () => entry) });
    }));
    expect(activity(st)).toEqual(['racingLap', 'finished']);
    // the final lap's provisional at its crossing (frame 1, number 2), its confirmed version from the cool-down frame
    expect(st.history.laps.map((l) => [l.lapNumber, l.status, l.lapTimeMs, l.frame])).toEqual([[5, 'provisional', 90_000, 2], [5, 'confirmed', 90_100, 2]]);
  });
  it('a retired car (notCompeting) whose lap number goes up records no lap', () => {
    const { st } = runScenario(race([[3, 1_000, 2], [3, 1_200, 7], [4, 10, 7], [4, 300, 7]], 2));
    expect(activity(st)).toEqual(['racingLap']);
    expect(st.history.laps.filter((l) => l.carId === 0)).toEqual([]);
  });
  it('a crossing after the session’s end (the postSession span, here the clock’s simulated end) records no lap', () => {
    // car 0 completes lap 1 at race frame 30; the clock jumps 6000 s ahead at race frame 100 (postSession); lap 2 ends at race frame 120
    const { runner } = run(script(gridStart(140, (k) => ({
      ...(k >= 100 && { at: raceAt(k) + 6_000_000 }),
      cars: (d) => lapOf(d, 0, { currentLapNum: k < 30 ? 1 : k < 120 ? 2 : 3, lastLapTimeInMs: 80_000 }),
    }))));
    expect(situationOf(runner.state).byMachine['session-phase-race']?.map((s) => s.kind)).toEqual(['postSession']);
    expect(runner.state.history.laps.filter((l) => l.carId === 0).map((l) => [l.lapNumber, l.status])).toEqual([[1, 'provisional']]);
  });
});

// Ruling 10 of Task 17: with no activity span (no activity sub-machine runs) laps are recorded by crossings as always,
// and no lap is an in lap or an out lap: those come from activity spans only.
describe('laps without activity spans', () => {
  // [lap, pitStatus]: a pit entry on lap 3, the line in the pit lane, the box and the pit exit on lap 4
  const seq = [[2, 0], [3, 0], [3, 1], [4, 1], [4, 2], [4, 0], [5, 0]] as const;
  const visit = (session: Parameters<ScenarioBuilder['session']>[0]) =>
    runScenario(new ScenarioBuilder({ cars: 1 }).session(session).frames(seq.length, (d) =>
      Object.assign(car0(d), { currentLapNum: seq[d.index]![0], pitStatus: seq[d.index]![1], lastLapTimeInMs: 80_000 }))).st;

  it.each([
    ['a time trial (weekend phase none)', { sessionType: 18, weekendStructure: [18] }],
    ['a race whose weekend phase is still pending (no weekend structure)', { numSessionsInWeekend: 0 }],
  ])('%s records a lap at each crossing, through a pit visit, neither in lap nor out lap', (_, session) => {
    const st = visit(session);
    const activity = [...Object.entries(st.history.spans), ...Object.entries(situationOf(st).byMachine)].filter(([m, spans]) => m.startsWith('car-activity') && spans.length > 0);
    expect(activity).toEqual([]);
    expect(st.history.laps.map((l) => [l.lapNumber, l.inLap, l.outLap])).toEqual([[2, false, false], [3, false, false], [4, false, false]]);
  });
});

// Fix round 1 of Task 17 (M3 review B1, C25, C26): the game does not raise the lap number at the chequered flag, so a
// finisher's final lap ends at a crossing seen in the values and situations: the lap distance falls while its race
// activity is racingLap (the result status turns finished on that frame or one frame later, inventory §2.10). Both the
// provisional final lap and its confirmed version from Session History (in the cool-down) describe that crossing, and
// the confirmed one supersedes the provisional; its membership is the spans open at the crossing, never coolDown.
describe('a finisher’s final lap describes its crossing (C25, C26)', () => {
  /** [lap distance, result status] per frame, one a second, on lap 5 of a race under way; 3 = finished. */
  type Row = readonly [distanceM: number, resultStatus: number];
  const entry = { lapTimeInMs: 90_100, sector1TimeMs: 30_000, sector2TimeMs: 30_000, sector3TimeMs: 30_100, lapValidBitFlags: 0b1111 };
  /** `rows`, then a frame that confirms laps 1-5 from Session History (lap 5 the final lap, its time 90.1 s). */
  const finisher = (rows: readonly Row[]) => runScenario(new ScenarioBuilder({ cars: 1, stepMs: 1000 }).frames(rows.length + 1, (d) => {
    const [lapDistance, resultStatus] = rows[d.index] ?? [2_600, 3];
    Object.assign(car0(d), { currentLapNum: 5, lapDistance, resultStatus, currentLapTimeInMs: 30_000, lastLapTimeInMs: 90_000 });
    if (d.index === rows.length) d.add('sessionHistory', { carIdx: 0, numLaps: 5, lapHistoryData: Array.from({ length: 5 }, () => entry) });
  }));
  const CROSSING = 1;

  it.each([
    // the crossing (4900 m to 5 m) on frame 1, the result status finished on it; the activity finished from frame 1
    ['on the crossing frame', [[4_900, 2], [5, 3], [300, 3], [2_500, 3]], 'finished'],
    // the crossing on frame 1, the result status finished one frame later (race-miami-finish); finished from frame 2
    ['one frame after the crossing', [[4_900, 2], [5, 2], [300, 3], [2_500, 3]], 'racingLap'],
  ] as const)('the result status finished %s: the provisional and the confirmed final lap describe the crossing; the confirmed one supersedes it', (_, rows, atCrossing) => {
    const { st, frames } = finisher(rows);
    const crossing = { frame: CROSSING + 1, completedAt: frames[CROSSING]!.sessionTime };
    const laps = st.history.laps.filter((l) => l.lapNumber === 5);
    expect(laps.map((l) => [l.status, l.lapTimeMs])).toEqual([['provisional', 90_000], ['confirmed', 90_100]]);
    expect(laps[0]).toMatchObject(crossing);
    expect(laps[0]).not.toHaveProperty('supersedes');
    expect(laps[1]).toMatchObject({ ...crossing, supersedes: { list: 'laps', index: st.history.laps.indexOf(laps[0]!) } });
    // the final lap belongs to the activity span open at its crossing, never to the cool-down (Session History confirmed it in the cool-down)
    expect(situationOf(st).byMachine['car-activity-race']?.find((s) => s.carId === 0)?.kind).toBe('coolDown');
    for (const lap of laps) expect(membershipOf({ history: st.history, situation: situationOf(st) }, lap)['car-activity-race']?.kind).toBe(atCrossing);
  });
});
