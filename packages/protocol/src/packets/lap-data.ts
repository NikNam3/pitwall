import { MAX_CARS, type PacketHeader, type PacketId } from '../header.ts';
import { array, f32, splitTime, struct, u8, u16, u32, type Infer } from '../schema/dsl.ts';

export const lapDataSchema = struct({
  lastLapTimeInMs: u32,
  currentLapTimeInMs: u32,
  sector1TimeMs: splitTime(),
  sector2TimeMs: splitTime(),
  deltaToCarInFrontMs: splitTime(),
  deltaToRaceLeaderMs: splitTime(),
  lapDistance: f32,
  totalDistance: f32,
  safetyCarDelta: f32,
  carPosition: u8,
  currentLapNum: u8,
  pitStatus: u8,
  numPitStops: u8,
  sector: u8,
  currentLapInvalid: u8,
  penalties: u8,
  totalWarnings: u8,
  cornerCuttingWarnings: u8,
  numUnservedDriveThroughPens: u8,
  numUnservedStopGoPens: u8,
  gridPosition: u8,
  driverStatus: u8,
  resultStatus: u8,
  pitLaneTimerActive: u8,
  pitLaneTimeInLaneInMs: u16,
  pitStopTimerInMs: u16,
  pitStopShouldServePen: u8,
  speedTrapFastestSpeed: f32,
  speedTrapFastestLap: u8,
});

export const lapDataBodySchema = struct({
  lapData: array(lapDataSchema, MAX_CARS),
  timeTrialPbCarIdx: u8,
  timeTrialRivalCarIdx: u8,
});

export type LapDataPacket = { packetId: typeof PacketId.lapData; header: PacketHeader } & Infer<typeof lapDataBodySchema>;
