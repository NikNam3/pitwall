import { describe, expect, it } from 'vitest';
import { ScenarioBuilder } from '../builders/index.ts';
import { runScenario } from '../support/run.ts';

describe('timing from LapData', () => {
  it('maps every LapData field with units and named codes', () => {
    const { st } = runScenario(new ScenarioBuilder({ cars: 2 }).frames(1, (d) => {
      Object.assign(d.lapData.lapData[1]!, { carPosition: 3, currentLapNum: 5, lapDistance: 1234.5, totalDistance: 20_000.25, currentLapTimeInMs: 45_678,
        lastLapTimeInMs: 91_234, sector: 2, sector1TimeMs: 30_123, sector2TimeMs: 31_456, currentLapInvalid: 1, deltaToRaceLeaderMs: 65_432,
        deltaToCarInFrontMs: 1_250, safetyCarDelta: -1.5, pitStatus: 1, numPitStops: 1, pitLaneTimerActive: 1, pitLaneTimeInLaneInMs: 4_200,
        pitStopTimerInMs: 0, pitStopShouldServePen: 1, driverStatus: 3, resultStatus: 4, penalties: 5, totalWarnings: 2, cornerCuttingWarnings: 1,
        numUnservedDriveThroughPens: 1, numUnservedStopGoPens: 0, gridPosition: 7, speedTrapFastestSpeed: 312.5, speedTrapFastestLap: 3 });
      d.status.carStatusData[1]!.vehicleFiaFlags = 3;
    }));
    expect(st.cars[1]!.timing).toEqual({ position: 3, lap: 5, lapDistanceM: 1234.5, totalDistanceM: 20_000.25, currentLapTimeMs: 45_678,
      lastLapTimeMs: 91_234, sector: 3, sector1TimeMs: 30_123, sector2TimeMs: 31_456, currentLapInvalid: true, gapToLeaderMs: 65_432,
      gapToCarAheadMs: 1_250, safetyCarDeltaMs: -1_500, pitStatus: 'pitting', numPitStops: 1, pitLaneTimerActive: true, pitLaneTimeMs: 4_200,
      pitStopTimerMs: 0, shouldServePenalty: true, driverStatus: 'outLap', resultStatus: 'didNotFinish', timePenaltyMs: 5_000, totalWarnings: 2,
      cornerCuttingWarnings: 1, unservedDriveThroughs: 1, unservedStopGos: 0, gridPosition: 7, speedTrapFastestKmh: 312.5, fiaFlag: 'yellow' });
  });
  it('passes negative gaps through (the game reports a car slightly ahead as a small negative delta)', () => {
    const { st } = runScenario(new ScenarioBuilder({ cars: 2 }).frames(1, (d) => {
      Object.assign(d.lapData.lapData[1]!, { deltaToCarInFrontMs: -17, deltaToRaceLeaderMs: -50 });
    }));
    expect([st.cars[1]!.timing.gapToCarAheadMs, st.cars[1]!.timing.gapToLeaderMs]).toEqual([-17, -50]);
  });
  it('speed trap is undefined while its lap is 255', () => {
    const { st } = runScenario(new ScenarioBuilder({ cars: 1 }).frames(1, (d) => { d.lapData.lapData[0]!.speedTrapFastestLap = 255; }));
    expect(st.cars[0]!.timing.speedTrapFastestKmh).toBeUndefined();
  });
  it('keeps the last values and does not tag timing when a frame has no LapData and no Car Status', () => {
    const { st, results } = runScenario(new ScenarioBuilder({ cars: 1 }).frames(2, (d) => {
      if (d.index === 0) d.lapData.lapData[0]!.currentLapNum = 4; else { d.drop('lapData'); d.drop('status'); }
    }));
    expect([st.cars[0]!.timing.lap, results[1]!.changed.has('timing')]).toEqual([4, false]);
  });
  it('LapData resultStatus drives car.active (invalid/inactive are not active)', () => {
    const { st } = runScenario(new ScenarioBuilder({ cars: 3 }).frames(1, (d) => {
      d.lapData.lapData[1]!.resultStatus = 1; d.lapData.lapData[2]!.resultStatus = 7;
    }));
    expect(st.cars.slice(0, 4).map((c) => c.active)).toEqual([true, false, true, false]);
  });
});
