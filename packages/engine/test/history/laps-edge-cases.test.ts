// Lap records beyond the main cases: sector bookkeeping, validity, out-laps and the per-car lap index.
import { describe, expect, it } from 'vitest';
import { unknown } from '@pitwall/domain';
import { ScenarioBuilder, type FrameDraft } from '../builders/index.ts';
import { runScenario } from '../support/run.ts';

// The lap-end samples are pinned in lap-end-samples.test.ts; here they only have to be there.
const lapEnd = { wearAtEndPct: expect.anything(), ersStoreAtEndJ: expect.anything(), ersDeployedJ: expect.anything(),
  ersHarvestedJ: expect.anything(), damageAtEnd: expect.anything(), channelRange: expect.anything() };
const car = (d: FrameDraft, id = 0) => d.lapData.lapData[id]!;
const entry = (lapTimeInMs: number, s1: number, s2: number, s3: number, lapValidBitFlags = 0b1111) => ({
  lapTimeInMs, sector1TimeMs: s1, sector2TimeMs: s2, sector3TimeMs: s3, lapValidBitFlags,
});
type Lap = readonly [lapNumber: number, status: string, lapTimeMs: number];
const summary = (laps: ReadonlyArray<{ lapNumber: number; status: string; lapTimeMs: number }>): Lap[] =>
  laps.map((l) => [l.lapNumber, l.status, l.lapTimeMs]);

/** Lap 1 over `lapFrames` frames, `script` shapes them; the next frame starts lap 2 with the sectors reset by the game. */
const firstLap = (lapFrames: number, script: (d: FrameDraft) => void) =>
  new ScenarioBuilder({ cars: 1 }).frames(lapFrames + 1, (d) => {
    if (d.index < lapFrames) script(d);
    else Object.assign(car(d), { currentLapNum: 2, lastLapTimeInMs: 90_000, sector1TimeMs: 0, sector2TimeMs: 0 });
  });

describe('provisional sector times', () => {
  it.each([
    ['sector 1 missing', { sector2TimeMs: 31_000 }],
    ['sector 2 missing', { sector1TimeMs: 30_000 }],
    ['both missing', {}],
  ])('%s: the lap has no sector times at all, sector 3 is not derived', (_, sectors) => {
    const { st } = runScenario(firstLap(2, (d) => { if (d.index === 1) Object.assign(car(d), sectors); }));
    expect(st.history.laps[0]!.sectorTimesMs).toEqual([0, 0, 0]);
  });
  it('sectors of an earlier lap are not the sectors of a lap the cursor skipped', () => {
    const { st } = runScenario(new ScenarioBuilder({ cars: 1 }).frames(3, (d) => {
      if (d.index === 1) Object.assign(car(d), { sector1TimeMs: 30_000, sector2TimeMs: 31_000 });
      if (d.index === 2) Object.assign(car(d), { currentLapNum: 3, lastLapTimeInMs: 80_000, sector1TimeMs: 0, sector2TimeMs: 0 });
    }));
    expect(st.history.laps.map((l) => [l.lapNumber, l.sectorTimesMs])).toEqual([[2, [0, 0, 0]]]);
  });
  it('a sector that reads 0 again within the lap does not erase the one captured', () => {
    const { st } = runScenario(firstLap(4, (d) => {
      if (d.index === 1) Object.assign(car(d), { sector1TimeMs: 30_000 });
      if (d.index === 2) Object.assign(car(d), { sector2TimeMs: 31_000 });
      if (d.index === 3) Object.assign(car(d), { sector1TimeMs: 0, sector2TimeMs: 0 });
    }));
    expect(st.history.laps[0]!.sectorTimesMs).toEqual([30_000, 31_000, 29_000]);
  });
  it('the sectors a lap starts with count when the cursor opens mid-lap', () => {
    const { st } = runScenario(new ScenarioBuilder({ cars: 1 }).frames(2, (d) => {
      if (d.index === 0) Object.assign(car(d), { sector1TimeMs: 30_000, sector2TimeMs: 31_000 });
      if (d.index === 1) Object.assign(car(d), { currentLapNum: 2, lastLapTimeInMs: 90_000, sector1TimeMs: 0, sector2TimeMs: 0 });
    }));
    expect(st.history.laps[0]!.sectorTimesMs).toEqual([30_000, 31_000, 29_000]);
  });
});

describe('lap validity', () => {
  it('a lap that turned invalid stays invalid for the rest of the lap, one that started invalid too', () => {
    const { st } = runScenario(new ScenarioBuilder({ cars: 2 }).frames(4, (d) => {
      car(d, 0).currentLapInvalid = [0, 1, 0, 0][d.index]!;
      car(d, 1).currentLapInvalid = [1, 0, 0, 0][d.index]!;
      if (d.index === 3) for (const id of [0, 1]) Object.assign(car(d, id), { currentLapNum: 2, lastLapTimeInMs: 90_000, currentLapInvalid: 0 });
    }));
    expect(st.history.laps.map((l) => [l.carId, l.valid])).toEqual([
      [0, { lap: false, sectors: [false, false, false] }],
      [1, { lap: false, sectors: [false, false, false] }],
    ]);
  });
  it('a lap that stayed clean is valid', () => {
    const { st } = runScenario(firstLap(3, () => {}));
    expect(st.history.laps[0]!.valid).toEqual({ lap: true, sectors: [true, true, true] });
  });
  it.each([
    [0b0000, { lap: false, sectors: [false, false, false] }],
    [0b0001, { lap: true, sectors: [false, false, false] }],
    [0b0010, { lap: false, sectors: [true, false, false] }],
    [0b0100, { lap: false, sectors: [false, true, false] }],
    [0b1000, { lap: false, sectors: [false, false, true] }],
    [0b1111, { lap: true, sectors: [true, true, true] }],
  ])('Session History flags %i give the confirmed lap its valid bits', (flags, valid) => {
    const { st } = runScenario(firstLap(2, () => {}).frames(1, (d) => {
      d.add('sessionHistory', { carIdx: 0, numLaps: 1, lapHistoryData: [entry(90_000, 30_000, 31_000, 29_000, flags)] });
    }));
    expect(st.history.laps.filter((l) => l.status === 'confirmed').map((l) => l.valid)).toEqual([valid]);
  });
});

describe('in-laps and out-laps', () => {
  it('a lap that starts with the driver status "out lap" is an out-lap, also outside the pit lane', () => {
    const { st } = runScenario(new ScenarioBuilder({ cars: 1 }).frames(3, (d) => {
      Object.assign(car(d), { driverStatus: d.index === 0 ? 3 : 4, pitStatus: 0 });
      if (d.index === 2) Object.assign(car(d), { currentLapNum: 2, lastLapTimeInMs: 90_000 });
    }));
    expect(st.history.laps.map((l) => [l.inLap, l.outLap])).toEqual([[false, true]]);
  });
  it('a lap that starts on track is neither', () => {
    const { st } = runScenario(firstLap(2, () => {}));
    expect(st.history.laps.map((l) => [l.inLap, l.outLap])).toEqual([[false, false]]);
  });
});

describe('time shares', () => {
  it('a lap that spans no session time has a share of 0, not NaN', () => {
    const { st } = runScenario(new ScenarioBuilder({ cars: 1, stepMs: 0 }).frames(2, (d) => {
      if (d.index === 1) Object.assign(car(d), { currentLapNum: 2, lastLapTimeInMs: 90_000 });
    }));
    expect(st.history.laps[0]).toMatchObject({ scShare: 0, vscShare: 0 });
  });
});

describe('a lap number that goes down', () => {
  it('starts over without a lap, and counts the laps from there', () => {
    const lapNumbers = [3, 2, 2, 3];
    const { st } = runScenario(new ScenarioBuilder({ cars: 1 }).frames(lapNumbers.length, (d) => {
      Object.assign(car(d), { currentLapNum: lapNumbers[d.index]!, lastLapTimeInMs: 80_000 });
    }));
    expect(st.history.laps.map((l) => l.lapNumber)).toEqual([2]);
  });
  it('a first frame in a late lap records nothing for the laps before it', () => {
    const { st } = runScenario(new ScenarioBuilder({ cars: 1 }).frames(2, (d) => {
      Object.assign(car(d), { currentLapNum: 5, lastLapTimeInMs: 80_000 });
      if (d.index === 1) d.add('sessionHistory', { carIdx: 0, numLaps: 5, lapHistoryData: [
        entry(81_000, 27_000, 27_000, 27_000), entry(80_000, 26_000, 27_000, 27_000), entry(80_500, 26_000, 27_000, 27_500), entry(79_000, 26_000, 26_000, 27_000)] });
    }));
    expect(st.history.laps).toEqual([]);
  });
});

describe('confirming laps from Session History', () => {
  // Lap 2 is the last lap and the game keeps currentLapNum at 2: its values come from the open lap.
  const finalLap = (history: ReadonlyArray<ReturnType<typeof entry>>, repeat = 1) =>
    new ScenarioBuilder({ cars: 1 }).frames(2 + repeat, (d) => {
      Object.assign(car(d), { currentLapNum: d.index === 0 ? 1 : 2, lastLapTimeInMs: d.index === 0 ? 0 : 90_000 });
      if (d.index >= 1) Object.assign(car(d), { sector1TimeMs: 30_100, sector2TimeMs: 31_200 });
      if (d.index >= 2) d.add('sessionHistory', { carIdx: 0, numLaps: history.length, lapHistoryData: history });
    });

  it('a lap confirmed without a provisional is confirmed once, however often the packet comes', () => {
    const { st } = runScenario(finalLap([entry(90_000, 30_000, 31_000, 29_000), entry(91_000, 30_150, 31_250, 29_600)], 3));
    expect(summary(st.history.laps)).toEqual([[1, 'provisional', 90_000], [1, 'confirmed', 90_000], [2, 'confirmed', 91_000]]);
  });
  it('a lap known only from the open lap reports no corrections, whatever its values were', () => {
    const { results } = runScenario(finalLap([entry(90_000, 30_000, 31_000, 29_000), entry(91_000, 30_150, 31_250, 29_600)], 2));
    expect(results.flatMap((r) => r.corrections)).toEqual([]);
  });
  it('a lap that Session History has confirmed is not appended again when the lap number rolls over', () => {
    const { st } = runScenario(new ScenarioBuilder({ cars: 1 }).frames(3, (d) => {
      if (d.index === 1) d.add('sessionHistory', { carIdx: 0, numLaps: 1, lapHistoryData: [entry(90_000, 30_000, 31_000, 29_000)] });
      if (d.index === 2) Object.assign(car(d), { currentLapNum: 2, lastLapTimeInMs: 90_000 });
    }));
    expect(summary(st.history.laps)).toEqual([[1, 'confirmed', 90_000]]);
  });
  it('the lap in progress is not confirmed, even when its history slot holds a time', () => {
    const { st } = runScenario(new ScenarioBuilder({ cars: 1 }).frames(3, (d) => {
      Object.assign(car(d), { currentLapNum: d.index === 0 ? 1 : 2, lastLapTimeInMs: d.index === 0 ? 0 : 90_000 });
      if (d.index === 2) d.add('sessionHistory', { carIdx: 0, numLaps: 1, lapHistoryData: [entry(90_000, 30_000, 31_000, 29_000), entry(12_345, 1, 2, 3)] });
    }));
    expect(summary(st.history.laps)).toEqual([[1, 'provisional', 90_000], [1, 'confirmed', 90_000]]);
  });
  it('a lap the engine never saw is not made up', () => {
    const { st } = runScenario(new ScenarioBuilder({ cars: 1 }).frames(2, (d) => {
      Object.assign(car(d), { currentLapNum: 3, lastLapTimeInMs: 80_000 });
      if (d.index === 1) d.add('sessionHistory', { carIdx: 0, numLaps: 2, lapHistoryData: [entry(81_000, 27_000, 27_000, 27_000), entry(80_000, 26_000, 27_000, 27_000)] });
    }));
    expect(st.history.laps).toEqual([]);
  });
  it('Session History of a car without LapData, or of a car number beyond the field, adds nothing', () => {
    const { st } = runScenario(new ScenarioBuilder({ cars: 1 }).frames(2, (d) => {
      if (d.index === 1) for (const carIdx of [3, 40]) d.add('sessionHistory', { carIdx, numLaps: 1, lapHistoryData: [entry(81_000, 27_000, 27_000, 27_000)] });
    }));
    expect(st.history.laps).toEqual([]);
  });
  it('a lap swallowed by a lap-number jump is a complete record once Session History has it, with only what LapData gave unknown', () => {
    const { st } = runScenario(new ScenarioBuilder({ cars: 1 }).frames(3, (d) => {
      Object.assign(car(d), { currentLapNum: d.index === 0 ? 1 : 3, lastLapTimeInMs: 80_000 });
      if (d.index === 2) d.add('sessionHistory', { carIdx: 0, numLaps: 2, lapHistoryData: [entry(81_000, 26_000, 27_000, 28_000, 0b1111)] });
    }));
    const [lapOne] = st.history.laps.filter((l) => l.status === 'confirmed');
    expect(lapOne).toEqual({
      carId: 0, lapNumber: 1, lapTimeMs: 81_000, sectorTimesMs: [26_000, 27_000, 28_000], valid: { lap: true, sectors: [true, true, true] },
      actualCompound: 'unknown', visualCompound: 'unknown', tyreAgeAtStart: 0, fuelAtStartKg: unknown('notReceived'), fuelAtEndKg: unknown('notReceived'),
      scShare: 0, vscShare: 0, inLap: false, outLap: false, positionAtEnd: 0, status: 'confirmed', completedAt: st.history.laps.at(-1)!.completedAt,
      ...lapEnd,
    });
  });
  it('a lap swallowed by a jump is confirmed once, however often the packet comes', () => {
    const { st } = runScenario(new ScenarioBuilder({ cars: 1 }).frames(4, (d) => {
      Object.assign(car(d), { currentLapNum: d.index === 0 ? 1 : 3, lastLapTimeInMs: 80_000 });
      if (d.index >= 2) d.add('sessionHistory', { carIdx: 0, numLaps: 2, lapHistoryData: [entry(81_000, 26_000, 27_000, 28_000), entry(80_000, 26_000, 27_000, 27_000)] });
    }));
    expect(st.history.laps.filter((l) => l.status === 'confirmed').map((l) => l.lapNumber)).toEqual([1, 2]);
  });

  describe('corrections', () => {
    const confirmFirstLap = (provisional: { lastLapTimeInMs: number; sector1TimeMs: number; sector2TimeMs: number }) =>
      runScenario(new ScenarioBuilder({ cars: 1 }).frames(4, (d) => {
        if (d.index === 1) Object.assign(car(d), { sector1TimeMs: provisional.sector1TimeMs, sector2TimeMs: provisional.sector2TimeMs });
        if (d.index >= 2) Object.assign(car(d), { currentLapNum: 2, lastLapTimeInMs: provisional.lastLapTimeInMs, sector1TimeMs: 0, sector2TimeMs: 0 });
        if (d.index === 3) d.add('sessionHistory', { carIdx: 0, numLaps: 1, lapHistoryData: [entry(90_000, 30_000, 31_000, 29_000)] });
      })).results[3]!.corrections;

    it('a provisional lap time of 0 is corrected to the confirmed one', () => {
      expect(confirmFirstLap({ lastLapTimeInMs: 0, sector1TimeMs: 30_000, sector2TimeMs: 31_000 })).toEqual([
        { carId: 0, lapNumber: 1, field: 'lapTimeMs', provisional: 0, confirmed: 90_000 }]);
    });
    it('a provisional sector that was 0 is no correction, a sector that was wrong is', () => {
      expect(confirmFirstLap({ lastLapTimeInMs: 90_000, sector1TimeMs: 0, sector2TimeMs: 30_900 })).toEqual([]);
      expect(confirmFirstLap({ lastLapTimeInMs: 90_000, sector1TimeMs: 29_900, sector2TimeMs: 31_000 })).toEqual([
        { carId: 0, lapNumber: 1, field: 'sector1Ms', provisional: 29_900, confirmed: 30_000 }]);
    });
  });
});
