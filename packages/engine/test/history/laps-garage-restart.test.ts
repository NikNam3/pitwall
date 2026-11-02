// A garage visit on the same lap number (practice, qualifying): the game does not advance the lap number through the
// garage, so the lap restarts at the line after the pit exit, and the stint boundary follows the restarted lap.
import { describe, expect, it } from 'vitest';
import type { LapRecord } from '@pitwall/domain';
import { ScenarioBuilder, type FrameDraft } from '../builders/index.ts';
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

/** `rows` as frames; frame `i` has fuel `60 - i` kg, wear RL/RR/FL/FR `i`..`i + 3` % and an ERS store of `1 MJ + i * 0.1 MJ`. */
const practice = (rows: readonly Row[], o: { newSetAt?: number } = {}) =>
  new ScenarioBuilder({ cars: 1, stepMs: 1000 }).session({ sessionType: 1 }).frames(rows.length, (d) => {
    const [lap, lapDistance, currentLapTimeInMs, pitStatus, driverStatus] = rows[d.index]!;
    Object.assign(car0(d), { currentLapNum: lap, lapDistance, currentLapTimeInMs, pitStatus, driverStatus, lastLapTimeInMs: lap === 4 ? 90_500 : 90_000 });
    const i = d.index;
    const set = o.newSetAt !== undefined && i >= o.newSetAt ? NEW : OLD;
    Object.assign(d.status.carStatusData[0]!, { ...set, fuelInTank: 60 - i, ersStoreEnergy: 1_000_000 + i * 100_000 });
    d.add('carDamage', { carDamageData: { 0: { tyresWear: [i, i + 1, i + 2, i + 3] } } });
  });
const withRows = (changes: Record<number, Partial<Record<'distanceM' | 'lapTimeMs', number>>>): Row[] =>
  GARAGE.map((row, i) => {
    const c = changes[i];
    return c ? [row[0], c.distanceM ?? row[1], c.lapTimeMs ?? row[2], row[3], row[4]] : row;
  });
const provisional = (laps: readonly LapRecord[]) => laps.filter((l) => l.status === 'provisional');

describe('a lap restarts at the line after a garage visit on the same lap number', () => {
  it('the timed lap from the line is its own lap record, neither in lap nor out lap; the in lap, garage and out lap before it are none', () => {
    const { st, frames } = runScenario(practice(GARAGE));
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

  it.each([
    // the timer keeps running at the line: the wrap alone tells the crossing
    ['the lap distance wraps by more than half the track', withRows({ [RESTART]: { lapTimeMs: 176_000 } })],
    // the frames between 2400 m and the line are lost: a drop of 2397 m is no wrap on a 5000 m track
    ['the lap timer resets', withRows({ 10: { distanceM: 2_400 } })],
  ])('the restart is found when %s', (_, rows) => {
    const { st } = runScenario(practice(rows));
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
  it('a set fitted in the garage on lap N whose timed lap is also lap N: the old stint ends at N - 1, lap N is on the new set', () => {
    const { st } = runScenario(practice(GARAGE, { newSetAt: 6 }).event({ code: 'SEND' }));
    expect(st.history.stints).toEqual([
      { carId: 0, firstLap: 2, lastLap: 2, actualCompound: 'C3', visualCompound: 'medium', tyreAgeAtFitting: 3, in: {} },
      { carId: 0, firstLap: 3, lastLap: 3, actualCompound: 'C2', visualCompound: 'hard', tyreAgeAtFitting: 0, in: {} }]);
    expect(provisional(st.history.laps).find((l) => l.lapNumber === 3)).toMatchObject({ actualCompound: 'C2', visualCompound: 'hard', tyreAgeAtStart: 0 });
  });
});
