import { known, unknown, type ConfirmedLap, type Known, type Ms, type SessionTime } from '@pitwall/domain';
import type { SessionHistoryPacket } from '@pitwall/protocol';
import { pick } from '../pick.ts';
import type { StateUpdate } from './types.ts';

// Code tables from the struct comments of LapData; a code the spec does not list reads as the first entry.
export const PIT_STATUS = ['none', 'pitting', 'inPitArea'] as const;
export const DRIVER_STATUS = ['inGarage', 'flyingLap', 'inLap', 'outLap', 'onTrack'] as const;
export const RESULT_STATUS = [
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
/** A gap beyond 5 minutes either way tells the engineer nothing; the qualifying garage sends hours (user ruling 2026-10-30). */
const MAX_GAP_MS = 300_000;

const gap = (ms: Ms, at: SessionTime): Known<Ms> => (Math.abs(ms) > MAX_GAP_MS ? unknown('notApplicable') : known(ms, at));

// Bits of `lapValidBitFlags`.
const LAP_VALID = 0x01;
const SECTOR_VALID = [0x02, 0x04, 0x08] as const;

/** The laps Session History completes (an entry with a lap time), oldest first, numbered from 1. */
const confirmedLapsOf = (p: SessionHistoryPacket): ConfirmedLap[] =>
  p.lapHistoryData.slice(0, p.numLaps).flatMap((entry, i): ConfirmedLap[] =>
    entry.lapTimeInMs > 0
      ? [{
          lapNumber: i + 1,
          lapTimeMs: entry.lapTimeInMs,
          sectorTimesMs: [entry.sector1TimeMs, entry.sector2TimeMs, entry.sector3TimeMs],
          valid: {
            lap: (entry.lapValidBitFlags & LAP_VALID) !== 0,
            sectors: [
              (entry.lapValidBitFlags & SECTOR_VALID[0]) !== 0,
              (entry.lapValidBitFlags & SECTOR_VALID[1]) !== 0,
              (entry.lapValidBitFlags & SECTOR_VALID[2]) !== 0,
            ],
          },
        }]
      : [],
  );

/**
 * Timing from LapData (its values; its signals go to `Signals`, C13), the confirmed laps from Session History. Gaps are kept as
 * sent: a car just ahead can show a small negative delta.
 */
export const timingUpdate: StateUpdate = { id: 'timing', apply: (frame, live, _signals, out) => {
  const { lapData, sessionHistory } = frame;
  const at = frame.sessionTime;
  if (lapData) {
    for (const car of live.cars) {
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
        gapToLeaderMs: gap(l.deltaToRaceLeaderMs, at),
        gapToCarAheadMs: gap(l.deltaToCarInFrontMs, at),
        safetyCarDeltaMs: Math.round(l.safetyCarDelta * 1000),
        pitLaneTimeMs: l.pitLaneTimeInLaneInMs,
        pitStopTimerMs: l.pitStopTimerInMs,
        gridPosition: l.gridPosition + GRID_FROM_ONE,
        speedTrapFastestKmh: l.speedTrapFastestLap === NO_SPEED_TRAP_LAP ? unknown('notReceived') : known(l.speedTrapFastestSpeed, at),
      });
    }
    out.changed.add('timing');
  }
  for (const packet of sessionHistory) {
    const car = live.cars[packet.carIdx];
    if (!car) continue;
    car.updatedAt.sessionHistory = at;
    car.timing.confirmedLaps = confirmedLapsOf(packet);
    out.changed.add('timing');
  }
} };
