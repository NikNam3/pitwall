import { MAX_CARS, type PacketHeader, type PacketId } from '../header.ts';
import { array, f64, struct, u8, u32, type Infer } from '../schema/dsl.ts';

export const finalClassificationDataSchema = struct({
  position: u8,
  numLaps: u8,
  gridPosition: u8,
  points: u8,
  numPitStops: u8,
  resultStatus: u8,
  resultReason: u8,
  bestLapTimeInMs: u32,
  totalRaceTime: f64,
  penaltiesTime: u8,
  numPenalties: u8,
  numTyreStints: u8,
  tyreStintsActual: array(u8, 8),
  tyreStintsVisual: array(u8, 8),
  tyreStintsEndLaps: array(u8, 8),
});

export const finalClassificationBodySchema = struct({
  numCars: u8,
  classificationData: array(finalClassificationDataSchema, MAX_CARS),
});

export type FinalClassificationPacket = { packetId: typeof PacketId.finalClassification; header: PacketHeader } & Infer<
  typeof finalClassificationBodySchema
>;
