// A garage visit on the same lap number (practice, qualifying): the game does not advance the lap number through the
// garage, so the lap restarts at the line where the car's activity ends its out lap (the timed activity's push span
// opens there, car-activity-timed), and the stint boundary follows the restarted lap. The restart holds in practice,
// qualifying and a sprint shootout (brought in from branch w2/laps, migration Task 12). In a race the lap number always
// rolls over at the line, so no lap restarts there (review RE-B3, branch w2/laps c3e4f5e): the final lap, which the game
// never rolls over at the chequered flag, keeps its own cursor even when it is an out lap. Ported from
// test/history/laps-garage-restart.test.ts onto the activity spans (contract C10, C13, C26; migration Task 17).
import { describe, expect, it } from 'vitest';
import type { LapRecord } from '@pitwall/domain';
import { ScenarioBuilder, type FrameDraft } from '../builders/index.ts';
import { run, script, STEP } from '../situations/script.ts';
import { runScenario } from '../support/run.ts';

const car0 = (d: FrameDraft) => d.lapData.lapData[0]!;
const val = <T>(v: T) => expect.objectContaining({ known: true, value: v });
const OLD = { actualTyreCompound: 18, visualTyreCompound: 17, tyresAgeLaps: 3 }, NEW = { actualTyreCompound: 19, visualTyreCompound: 18, tyresAgeLaps: 0 };

type Row = [lap: number, distanceM: number, lapTimeMs: number, pitStatus: number, driverStatus: number];
/**
 * Practice on a 5000 m track, one frame per second. Pit status 0 none, 1 pitting; driver status 0 garage, 1 flying,
 * 2 in lap, 3 out lap. The pit lane passes the line, so the distance wraps in it (frame 4) without the lap number going up;
 * the out lap reaches the line as a wrap with the lap timer reset (frame 11), and the game times lap 3 from there.
 */
const GARAGE: readonly Row[] = [
  [2, 4_900, 88_000, 0, 1],  // 0  the engine joins at the end of lap 2
  [3, 5, 100, 0, 1],         // 1  line: lap 2 done, lap 3 begins
  [3, 2_500, 45_000, 0, 2],  // 2  in lap
  [3, 4_950, 85_000, 1, 2],  // 3  pit entry
  [3, 40, 87_000, 1, 2],     // 4  the pit lane passes the line: the distance wraps, the lap number stays
  [3, 60, 88_000, 1, 0],     // 5  in the garage
  [3, 60, 89_000, 1, 0],     // 6  in the garage (the new set, where the case fits one)
  [3, 60, 90_000, 1, 3],     // 7  leaves the garage
  [3, 69, 97_000, 0, 3],     // 8  pit exit
  [3, 2_500, 130_000, 0, 3], // 9  out lap
  [3, 4_950, 175_000, 0, 3], // 10 out lap, just before the line
  [3, 3, 50, 0, 3],          // 11 the line: the timed lap 3 starts (the driver status still says out lap)
  [3, 2_500, 45_000, 0, 1],  // 12 timed lap
  [3, 4_900, 89_000, 0, 1],  // 13 timed lap
  [4, 5, 100, 0, 1],         // 14 line: lap 3 done in 90.5 s
  [4, 2_500, 45_000, 0, 1],  // 15
];
const RESTART = 11;

/**
 * `rows` as frames of a session of `sessionType` (1 practice, 5 qualifying, 10 a sprint shootout, 15 a race); frame `i`
 * has fuel `60 - i` kg, wear RL/RR/FL/FR `i`..`i + 3` % and an ERS store of `1 MJ + i * 0.1 MJ`.
 */
const scenario = (sessionType: number, rows: readonly Row[], o: { newSetAt?: number } = {}) =>
  new ScenarioBuilder({ cars: 1, stepMs: 1000 }).session({ sessionType }).frames(rows.length, (d) => {
    const [lap, lapDistance, currentLapTimeInMs, pitStatus, driverStatus] = rows[d.index]!;
    Object.assign(car0(d), { currentLapNum: lap, lapDistance, currentLapTimeInMs, pitStatus, driverStatus, lastLapTimeInMs: lap === 4 ? 90_500 : 90_000 });
    const i = d.index;
    const set = o.newSetAt !== undefined && i >= o.newSetAt ? NEW : OLD;
    Object.assign(d.status.carStatusData[0]!, { ...set, fuelInTank: 60 - i, ersStoreEnergy: 1_000_000 + i * 100_000 });
    d.add('carDamage', { carDamageData: { 0: { tyresWear: [i, i + 1, i + 2, i + 3] } } });
  });
const practice = (rows: readonly Row[], o: { newSetAt?: number } = {}) => scenario(1, rows, o);
/** `rows` (the garage visit by default) with the distance or lap time of some frames changed. */
const withRows = (changes: Record<number, Partial<Record<'distanceM' | 'lapTimeMs', number>>>, rows: readonly Row[] = GARAGE): Row[] =>
  rows.map((row, i) => {
    const c = changes[i];
    return c ? [row[0], c.distanceM ?? row[1], c.lapTimeMs ?? row[2], row[3], row[4]] : row;
  });
const provisional = <L extends Pick<LapRecord, 'status'>>(laps: readonly L[]) => laps.filter((l) => l.status === 'provisional');

describe('a lap restarts at the line after a garage visit on the same lap number', () => {
  it.each([['practice', 1], ['qualifying', 5], ['a sprint shootout', 10]])('in %s the timed lap from the line is its own lap record, neither in lap nor out lap; the in lap, garage and out lap before it are none', (_, sessionType) => {
    const { st, frames } = runScenario(scenario(sessionType, GARAGE));
    const laps = provisional(st.history.laps);
    expect(laps.map((l) => l.lapNumber)).toEqual([2, 3]);
    expect(laps[1]).toMatchObject({ lapNumber: 3, lapTimeMs: 90_500, inLap: false, outLap: false, fuelAtStartKg: val(60 - RESTART),
      completedAt: frames[14]!.sessionTime });
  });

  it('the restarted lap samples wear and the ERS store at the line where it restarts', () => {
    const { st } = runScenario(practice(GARAGE));
    const lap = provisional(st.history.laps).find((l) => l.lapNumber === 3)!;
    const i = RESTART;
    expect([lap.wearAtStartPct, lap.ersStoreAtStartJ]).toEqual([{ rl: val(i), rr: val(i + 1), fl: val(i + 2), fr: val(i + 3) }, val(1_000_000 + i * 100_000)]);
  });

  // the timer keeps running at the line: the wrap alone tells the crossing (the activity's line, car-activity-timed)
  it('the restart is found when the lap distance wraps by more than half the track, the lap timer running on', () => {
    const { st } = runScenario(practice(withRows({ [RESTART]: { lapTimeMs: 176_000 } })));
    const lap = provisional(st.history.laps).find((l) => l.lapNumber === 3)!;
    expect([lap.inLap, lap.fuelAtStartKg]).toEqual([false, val(60 - RESTART)]);
  });

  it('a wrap on the same lap number without a pit visit is no restart (the last lap the game never rolls over)', () => {
    const rows: Row[] = [[1, 0, 0, 0, 4], [1, 2_500, 45_000, 0, 4], [2, 5, 100, 0, 4], [2, 2_500, 45_000, 0, 4], [2, 4_950, 89_000, 0, 4],
      [2, 3, 50, 0, 4], [2, 500, 8_000, 0, 4]];
    const entry = { lapTimeInMs: 90_000, sector1TimeMs: 30_000, sector2TimeMs: 30_000, sector3TimeMs: 30_000, lapValidBitFlags: 0b1111 };
    const { st } = runScenario(practice(rows).frames(1, (d) => {
      d.add('sessionHistory', { carIdx: 0, numLaps: 2, lapHistoryData: [entry, { ...entry, lapTimeInMs: 89_900 }] });
    }));
    const lastLap = st.history.laps.find((l) => l.lapNumber === 2 && l.status === 'confirmed')!;
    expect([lastLap.lapTimeMs, lastLap.fuelAtStartKg]).toEqual([89_900, val(60 - 2)]);
  });
});

describe('the stint boundary follows the restarted lap', () => {
  // The old stint closes on the frame the garage span ends on the new set (frame 7, number 8: the car leaves the garage).
  it('a set fitted in the garage on lap N whose timed lap is also lap N: the old stint ends at N - 1, lap N is on the new set', () => {
    const { st } = runScenario(practice(GARAGE, { newSetAt: 6 }).event({ code: 'SEND' }));
    expect(st.history.spans['car-activity-practice']?.find((s) => s.kind === 'garage')).toMatchObject({ endFrame: 8 });
    expect(st.history.stints).toEqual([
      { carId: 0, firstLap: 2, lastLap: 2, actualCompound: 'C3', visualCompound: 'medium', tyreAgeAtFitting: 3, frame: 8 },
      { carId: 0, firstLap: 3, lastLap: 3, actualCompound: 'C2', visualCompound: 'hard', tyreAgeAtFitting: 0, frame: 16 }]);
    expect(provisional(st.history.laps).find((l) => l.lapNumber === 3)).toMatchObject({ actualCompound: 'C2', visualCompound: 'hard', tyreAgeAtStart: 0 });
  });
  it('a garage tyre fitting opens a stint without a pit stop', () => {
    const { st } = runScenario(practice(GARAGE, { newSetAt: 6 }).event({ code: 'SEND' }));
    expect(st.history.stints.map((s) => [s.firstLap, s.visualCompound])).toEqual([[2, 'medium'], [3, 'hard']]);
    expect(st.history.pitStops).toEqual([]);
  });
  it('a garage visit that fits no new set closes no stint and is no pit stop', () => {
    const { st } = runScenario(practice(GARAGE));
    expect([st.history.stints, st.history.pitStops]).toEqual([[], []]);
  });
});

/**
 * The final lap of a race as an out lap, at the track where the box lies after the line: lap 6 ends in the pit lane
 * (the lap number rolls over there, as in every race), the car leaves the pits on lap 7 and takes the chequered flag at
 * the end of it, where the game does not roll the lap number over. Driver status 4 = on track. The race's activity:
 * racingLap (joined), inLap from the pit entry, outLap from the pit exit (no box stop: the pit status never shows the box).
 */
const FINAL_OUT_LAP: readonly Row[] = [
  [5, 4_900, 88_000, 0, 4],  // 0  the engine joins at the end of lap 5
  [6, 5, 100, 0, 4],         // 1  line: lap 6 begins
  [6, 2_500, 45_000, 0, 4],  // 2
  [6, 4_950, 85_000, 1, 2],  // 3  pit entry
  [7, 40, 200, 1, 2],        // 4  the line in the pit lane: lap 6 done, lap 7 begins
  [7, 60, 1_200, 1, 2],      // 5  in the box
  [7, 69, 8_000, 0, 3],      // 6  pit exit: lap 7 is the out lap
  [7, 2_500, 50_000, 0, 4],  // 7
  [7, 4_950, 95_000, 0, 4],  // 8  just before the line
  [7, 3, 50, 0, 4],          // 9  the chequered flag: the distance wraps, the timer resets, the lap number stays 7
  [7, 500, 8_000, 0, 4],     // 10 cool-down lap
];
const FINAL_LAP_START = 4;
const FINISH = 9;

/** `rows` as a race, then a Session History frame that confirms laps 1 to `lastLap`. */
const raceConfirmed = (rows: readonly Row[], lastLap: number) => {
  const entry = { lapTimeInMs: 90_000, sector1TimeMs: 30_000, sector2TimeMs: 30_000, sector3TimeMs: 30_000, lapValidBitFlags: 0b1111 };
  return runScenario(scenario(15, rows).frames(1, (d) => {
    d.add('sessionHistory', { carIdx: 0, numLaps: lastLap, lapHistoryData: Array.from({ length: lastLap }, (_, i) => ({ ...entry, lapTimeInMs: 90_000 + i })) });
  }));
};
const confirmedLap = (laps: readonly LapRecord[], lapNumber: number) => laps.find((l) => l.lapNumber === lapNumber && l.status === 'confirmed');

describe('in a race no lap restarts at the line (RE-B3, branch w2/laps)', () => {
  it.each([
    ['the distance wraps and the lap timer resets', FINAL_OUT_LAP],
    ['only the lap distance wraps', withRows({ [FINISH]: { lapTimeMs: 96_000 } }, FINAL_OUT_LAP)],
    // the frames between 2400 m and the line are lost: a drop of 2397 m is no wrap on a 5000 m track
    ['only the lap timer resets', withRows({ [FINISH - 1]: { distanceM: 2_400 } }, FINAL_OUT_LAP)],
  ])('the final lap as an out lap stays an out lap with the samples of its own start when at the flag %s', (_, rows) => {
    const { st, frames } = raceConfirmed(rows, 7);
    const i = FINAL_LAP_START;
    expect(confirmedLap(st.history.laps, 7)).toMatchObject({
      lapTimeMs: 90_006, inLap: false, outLap: true, fuelAtStartKg: val(60 - i),
      wearAtStartPct: { rl: val(i), rr: val(i + 1), fl: val(i + 2), fr: val(i + 3) }, ersStoreAtStartJ: val(1_000_000 + i * 100_000),
      completedAt: frames.at(-1)!.sessionTime,
    });
  });

  it('a pit visit on the final lap: the lap stays one lap, in lap and out lap, from its own start', () => {
    // a drive-through whose pit lane ends before the line, on lap 6, the final lap
    const rows: Row[] = [[5, 4_900, 88_000, 0, 4], [6, 5, 100, 0, 4], [6, 1_000, 18_000, 1, 2], [6, 1_300, 30_000, 1, 2],
      [6, 1_600, 40_000, 0, 4], [6, 4_950, 95_000, 0, 4], [6, 3, 50, 0, 4], [6, 500, 8_000, 0, 4]];
    const { st } = raceConfirmed(rows, 6);
    expect(confirmedLap(st.history.laps, 6)).toMatchObject({ lapTimeMs: 90_005, inLap: true, outLap: true, fuelAtStartKg: val(60 - 1) });
  });
});

// Review Focus 4: the game runs the session time up to 31.6x wall time while a car waits in its garage, and teleports it
// there (the distances and timers of SgQ, as car-activity-timed's behaviour test). Each frame is 16 ms of wall time and
// 506 ms of session time on a 5000 m track.
describe('garage time acceleration (Review Focus 4)', () => {
  const GARAGE_M = [33, 4_929, 41, -4_875, 60, 4_929, 33, 60];
  const TIMERS_MS = [14_099, 0, 29_416, 0, 6_506, 0, 37_432, 0];
  const accelerated = (sessionType: number) => run(script(GARAGE_M.map((d, k) => ({
    at: 200_000 + k * 506,
    wall: k * STEP,
    cars: (f: FrameDraft) => {
      // car 0 in its garage (driver status 0), pit status 1 after the first frame; car 1 on track at the same rate, 40 m a frame, across the line once
      Object.assign(f.lapData.lapData[0]!, { driverStatus: 0, pitStatus: k === 0 ? 0 : 1, lapDistance: d, currentLapNum: 4, currentLapTimeInMs: TIMERS_MS[k]! });
      const m = 4_850 + 40 * k;
      Object.assign(f.lapData.lapData[1]!, { driverStatus: 1, pitStatus: 0, lapDistance: m % 5_000, currentLapNum: m >= 5_000 ? 3 : 2, currentLapTimeInMs: 80_000 + 506 * k, lastLapTimeInMs: 90_000 });
    },
  })), { session: { sessionType, trackLength: 5_000 } })).runner.state;

  it.each([['practice', 1], ['qualifying', 5]])('in %s a car accelerated through the garage records no lap, no stint and no pit stop; the car on track records its lap', (_, sessionType) => {
    const st = accelerated(sessionType);
    expect(st.log.laps.filter((l) => l.carId === 0)).toEqual([]);
    expect(st.log.stints.filter((s) => s.carId === 0)).toEqual([]);
    expect(st.log.pitStops).toEqual([]);
    expect(st.history.laps.map((l) => [l.carId, l.lapNumber, l.status])).toEqual([[1, 2, 'provisional']]);
  });
});
