import { known, unknown } from '@pitwall/domain';
import { pick } from './pick.ts';
import { ZONE_FLAG } from './session.ts';
import type { SubStep } from './types.ts';

// Code tables from the struct comments of LapData; a code the spec does not list reads as the first entry.
const PIT_STATUS = ['none', 'pitting', 'inPitArea'] as const;
const DRIVER_STATUS = ['inGarage', 'flyingLap', 'inLap', 'outLap', 'onTrack'] as const;
const RESULT_STATUS = [
  'invalid',
  'inactive',
  'active',
  'finished',
  'didNotFinish',
  'disqualified',
  'notClassified',
  'retired',
] as const;
/** The game counts sectors from 0. */
const SECTOR = [1, 2, 3] as const;
/** The game counts grid positions from 0 (pole is 0) but race positions from 1; ours both count from 1. */
const GRID_FROM_ONE = 1;
/** `speedTrapFastestLap` while the car has no speed trap time. */
const NO_SPEED_TRAP_LAP = 255;

/** Timing from LapData; the FIA flag comes from Car Status. Gaps are kept as sent: a car just ahead can show a small negative delta. */
export const applyTiming: SubStep = (state, frame, out) => {
  const { lapData, status } = frame;
  if (lapData) {
    const at = frame.sessionTime;
    for (const car of state.cars) {
      const l = lapData.lapData[car.id];
      if (!l) continue;
      car.updatedAt.lapData = at;
      Object.assign(car.timing, {
        position: l.carPosition,
        lap: l.currentLapNum,
        lapDistanceM: l.lapDistance,
        totalDistanceM: l.totalDistance,
        currentLapTimeMs: l.currentLapTimeInMs,
        lastLapTimeMs: l.lastLapTimeInMs,
        sector: pick(SECTOR, l.sector),
        sector1TimeMs: l.sector1TimeMs,
        sector2TimeMs: l.sector2TimeMs,
        currentLapInvalid: l.currentLapInvalid === 1,
        gapToLeaderMs: l.deltaToRaceLeaderMs,
        gapToCarAheadMs: l.deltaToCarInFrontMs,
        safetyCarDeltaMs: Math.round(l.safetyCarDelta * 1000),
        pitStatus: pick(PIT_STATUS, l.pitStatus),
        numPitStops: l.numPitStops,
        pitLaneTimerActive: l.pitLaneTimerActive === 1,
        pitLaneTimeMs: l.pitLaneTimeInLaneInMs,
        pitStopTimerMs: l.pitStopTimerInMs,
        shouldServePenalty: l.pitStopShouldServePen === 1,
        driverStatus: pick(DRIVER_STATUS, l.driverStatus),
        resultStatus: pick(RESULT_STATUS, l.resultStatus),
        timePenaltyMs: l.penalties * 1000,
        totalWarnings: l.totalWarnings,
        cornerCuttingWarnings: l.cornerCuttingWarnings,
        unservedDriveThroughs: l.numUnservedDriveThroughPens,
        unservedStopGos: l.numUnservedStopGoPens,
        gridPosition: l.gridPosition + GRID_FROM_ONE,
        speedTrapFastestKmh: l.speedTrapFastestLap === NO_SPEED_TRAP_LAP ? unknown('notReceived') : known(l.speedTrapFastestSpeed, at),
      });
    }
    out.changed.add('timing');
  }
  if (status) {
    for (const car of state.cars) {
      const s = status.carStatusData[car.id];
      // The game sends -1 for an unknown flag, then 0 none, 1 green, 2 blue, 3 yellow.
      if (s) car.timing.fiaFlag = pick(ZONE_FLAG, s.vehicleFiaFlags + 1);
    }
    out.changed.add('timing');
  }
};
