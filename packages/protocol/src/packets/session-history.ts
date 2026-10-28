import type { PacketHeader, PacketId } from '../header.ts';
import { array, splitTime, struct, u8, u32, type Infer } from '../schema/dsl.ts';

export const lapHistoryDataSchema = struct({
  lapTimeInMs: u32,
  sector1TimeMs: splitTime(),
  sector2TimeMs: splitTime(),
  sector3TimeMs: splitTime(),
  lapValidBitFlags: u8,
});

export const tyreStintHistoryDataSchema = struct({
  endLap: u8,
  tyreActualCompound: u8,
  tyreVisualCompound: u8,
});

export const sessionHistoryBodySchema = struct({
  carIdx: u8,
  numLaps: u8,
  numTyreStints: u8,
  bestLapTimeLapNum: u8,
  bestSector1LapNum: u8,
  bestSector2LapNum: u8,
  bestSector3LapNum: u8,
  lapHistoryData: array(lapHistoryDataSchema, 100),
  tyreStintsHistoryData: array(tyreStintHistoryDataSchema, 8),
});

export type SessionHistoryPacket = { packetId: typeof PacketId.sessionHistory; header: PacketHeader } & Infer<
  typeof sessionHistoryBodySchema
>;
