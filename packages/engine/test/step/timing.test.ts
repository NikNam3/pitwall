import { describe, expect, it } from 'vitest';
import { known, unknown } from '@pitwall/domain';
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
      lastLapTimeMs: 91_234, sector: 3, sector1TimeMs: 30_123, sector2TimeMs: 31_456, currentLapInvalid: true, gapToLeaderMs: known(65_432, 0),
      gapToCarAheadMs: known(1_250, 0), safetyCarDeltaMs: -1_500, pitStatus: 'pitting', numPitStops: 1, pitLaneTimerActive: true, pitLaneTimeMs: 4_200,
      pitStopTimerMs: 0, shouldServePenalty: true, driverStatus: 'outLap', resultStatus: 'didNotFinish', timePenaltyMs: 5_000, totalWarnings: 2,
      cornerCuttingWarnings: 1, unservedDriveThroughs: 1, unservedStopGos: 0, gridPosition: 8, speedTrapFastestKmh: known(312.5, 0), fiaFlag: 'yellow' });
  });
  it('counts the grid position from 1 like the race position: the game sends it from 0, pole is 0', () => {
    const { st } = runScenario(new ScenarioBuilder({ cars: 2 }).frames(1, (d) => {
      Object.assign(d.lapData.lapData[0]!, { carPosition: 1, gridPosition: 0 });
      Object.assign(d.lapData.lapData[1]!, { carPosition: 2, gridPosition: 1 });
    }));
    expect(st.cars.slice(0, 2).map((c) => [c.timing.position, c.timing.gridPosition])).toEqual([[1, 1], [2, 2]]);
  });
  it('passes negative gaps through (the game reports a car slightly ahead as a small negative delta)', () => {
    const { st } = runScenario(new ScenarioBuilder({ cars: 2 }).frames(1, (d) => {
      Object.assign(d.lapData.lapData[1]!, { deltaToCarInFrontMs: -17, deltaToRaceLeaderMs: -50 });
    }));
    expect([st.cars[1]!.timing.gapToCarAheadMs, st.cars[1]!.timing.gapToLeaderMs]).toEqual([known(-17, 0), known(-50, 0)]);
  });
  // User ruling 2026-10-30: gaps beyond 5 minutes either way are unknown. The game sends such values from the garage
  // in qualifying (a minutes byte of 253-255), and a gap that large tells the engineer nothing.
  it.each([
    [300_000, known(300_000, 0)],
    [-300_000, known(-300_000, 0)],
    [300_001, unknown('notApplicable')],
    [-300_001, unknown('notApplicable')],
    [-15_362_703, unknown('notApplicable')], // what the garage bytes (255 min + 62 703 ms) decode to
  ])('a gap of %i ms reads as %o', (raw, expected) => {
    const { st } = runScenario(new ScenarioBuilder({ cars: 2 }).frames(1, (d) => {
      Object.assign(d.lapData.lapData[1]!, { deltaToCarInFrontMs: raw, deltaToRaceLeaderMs: raw });
    }));
    expect([st.cars[1]!.timing.gapToCarAheadMs, st.cars[1]!.timing.gapToLeaderMs]).toEqual([expected, expected]);
  });
  it('speed trap is unknown (notReceived) while its lap is 255', () => {
    const { st } = runScenario(new ScenarioBuilder({ cars: 1 }).frames(1, (d) => { d.lapData.lapData[0]!.speedTrapFastestLap = 255; }));
    expect(st.cars[0]!.timing.speedTrapFastestKmh).toEqual(unknown('notReceived'));
  });
  it('speed trap is known (with its session time) once the car has a value', () => {
    const { st } = runScenario(new ScenarioBuilder({ cars: 1 }).frames(1, (d) => {
      Object.assign(d.lapData.lapData[0]!, { speedTrapFastestSpeed: 301.25, speedTrapFastestLap: 2 });
    }));
    expect(st.cars[0]!.timing.speedTrapFastestKmh).toEqual(known(301.25, 0));
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
