import { describe, expect, it } from 'vitest';
import { known, unknown } from '@pitwall/domain';
import { ScenarioBuilder, type FrameDraft } from '../builders/index.ts';
import { runFrames, runScenario } from '../support/run.ts';

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
      positionAtEnd: 1, status: 'provisional', completedAt: end }]);
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
  it('a confirmed lap keeps the time it was completed, not the time Session History confirmed it', () => {
    const history = { carIdx: 0, numLaps: 2, lapHistoryData: [
      { lapTimeInMs: 90_500, sector1TimeMs: 30_000, sector2TimeMs: 31_000, sector3TimeMs: 29_500, lapValidBitFlags: 0b1111 }, { lapValidBitFlags: 0b1111 }] };
    const { st, frames } = runScenario(lapOne().frames(3, () => {}).frames(1, (d) => { d.add('sessionHistory', history); }));
    const completed = frames[3]!.sessionTime, confirmedAt = frames[8]!.sessionTime;
    expect(confirmedAt).toBeGreaterThan(completed);
    expect(st.history.laps.map((l) => [l.status, l.completedAt])).toEqual([['provisional', completed], ['confirmed', completed]]);
  });
  it('SC/VSC share = share of the lap’s session time under each status', () => {
    const { st } = runScenario(new ScenarioBuilder({ cars: 1, stepMs: 1000 }).frames(1, () => {})
      .session({ safetyCarStatus: 1 }).frames(1, () => {})          // (0, 1000]     SC
      .session({ safetyCarStatus: 2 }).frames(1, () => {})          // (1000, 2000]  VSC
      .session({ safetyCarStatus: 0 }).frames(1, () => {})          // (2000, 3000]  green
      .frames(1, (d) => Object.assign(car0(d), { currentLapNum: 2, lastLapTimeInMs: 4_000 })));
    expect(st.history.laps[0]).toMatchObject({ scShare: 0.25, vscShare: 0.25 });
  });
  it('in-lap = a pit entry during the lap; out-lap = the lap starts in the pit lane', () => {
    const seq = [[2, 0], [3, 0], [3, 1], [4, 1], [4, 2], [4, 0], [5, 0]] as const;
    const { st } = runScenario(new ScenarioBuilder({ cars: 1 }).frames(seq.length, (d) =>
      Object.assign(car0(d), { currentLapNum: seq[d.index]![0], pitStatus: seq[d.index]![1], lastLapTimeInMs: 80_000 })));
    expect(st.history.laps.map((l) => [l.lapNumber, l.inLap, l.outLap])).toEqual([[2, false, false], [3, true, false], [4, false, true]]);
  });
  it('fuel at lap start/end of a restricted car is unknown("restricted")', () => {
    const { st } = runScenario(new ScenarioBuilder({ cars: 2 }).participants({ participants: { 1: { aiControlled: 0, networkId: 5, yourTelemetry: 0 } } })
      .frames(2, (d) => { if (d.index === 1) Object.assign(d.lapData.lapData[1]!, { currentLapNum: 2, lastLapTimeInMs: 80_000 }); }));
    expect(st.history.laps[0]).toMatchObject({ carId: 1, fuelAtStartKg: unknown('restricted'), fuelAtEndKg: unknown('restricted') });
  });
});
