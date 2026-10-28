import { describe, expect, it } from 'vitest';
import { unknown } from '@pitwall/domain';
import { ScenarioBuilder, type FrameDraft } from '../builders/index.ts';
import { runScenario } from '../support/run.ts';

const car0 = (d: FrameDraft) => d.lapData.lapData[0]!;
const entry = (lapTimeInMs: number, s1: number, s2: number, s3: number) => ({
  lapTimeInMs, sector1TimeMs: s1, sector2TimeMs: s2, sector3TimeMs: s3, lapValidBitFlags: 0b1111,
});

describe('laps that LapData did not record', () => {
  // Lap 2 is the last lap: the game keeps currentLapNum at 2 after the flag, so lap 2 never rolls over.
  const finalLap = () => new ScenarioBuilder({ cars: 1 }).frames(4, (d) => {
    Object.assign(car0(d), { currentLapNum: d.index === 0 ? 1 : 2, lastLapTimeInMs: d.index === 0 ? 0 : 90_000 });
    if (d.index >= 2) Object.assign(car0(d), { sector1TimeMs: 30_100, sector2TimeMs: 31_200 });
    if (d.index === 3) d.add('sessionHistory', { carIdx: 0, numLaps: 2, lapHistoryData: [entry(90_000, 30_000, 31_000, 29_000), entry(91_000, 30_100, 31_200, 29_700)] });
  }).event({ code: 'SEND' });

  it('confirms a final lap the game never rolled over, from the history entry', () => {
    const { st } = runScenario(finalLap());
    expect(st.history.laps.map((l) => [l.lapNumber, l.status, l.lapTimeMs])).toEqual([[1, 'provisional', 90_000], [1, 'confirmed', 90_000], [2, 'confirmed', 91_000]]);
    expect(st.history.laps[2]).toMatchObject({ sectorTimesMs: [30_100, 31_200, 29_700], valid: { lap: true, sectors: [true, true, true] } });
  });
  it('ends the last stint on the final lap', () => {
    expect(runScenario(finalLap()).st.history.stints).toMatchObject([{ firstLap: 1, lastLap: 2 }]);
  });
  it('a lap swallowed by a lap-number jump is confirmed from history, with LapData values unknown', () => {
    const { st } = runScenario(new ScenarioBuilder({ cars: 1 }).frames(3, (d) => {
      Object.assign(car0(d), { currentLapNum: d.index === 0 ? 1 : 3, lastLapTimeInMs: 80_000 });
      if (d.index === 2) d.add('sessionHistory', { carIdx: 0, numLaps: 3, lapHistoryData: [entry(81_000, 27_000, 27_000, 27_000), entry(80_000, 26_000, 27_000, 27_000)] });
    }));
    const confirmed = st.history.laps.filter((l) => l.status === 'confirmed');
    expect(confirmed.map((l) => [l.lapNumber, l.lapTimeMs])).toEqual([[1, 81_000], [2, 80_000]]);
    expect(confirmed[0]).toMatchObject({ fuelAtStartKg: unknown('notReceived'), actualCompound: 'unknown', positionAtEnd: 0 });
  });
  it('reports no sector corrections when the provisional sectors were missing', () => {
    const { results } = runScenario(new ScenarioBuilder({ cars: 1 }).frames(3, (d) => {
      Object.assign(car0(d), { currentLapNum: d.index === 0 ? 1 : 2, lastLapTimeInMs: 80_000 });
      if (d.index === 2) d.add('sessionHistory', { carIdx: 0, numLaps: 1, lapHistoryData: [entry(80_000, 26_000, 27_000, 27_000)] });
    }));
    expect(results[2]!.corrections).toEqual([]);
  });
});
