import { MAX_CARS, type PacketHeader, type PacketId } from '../header.ts';
import { array, struct, u8, type Infer } from '../schema/dsl.ts';

export const lapPositionsBodySchema = struct({
  numLaps: u8,
  lapStart: u8,
  /** Outer index is the lap (from `lapStart`), inner index the vehicle; 0 when there is no record. */
  positionForVehicleIdx: array(array(u8, MAX_CARS), 50),
});

export type LapPositionsPacket = { packetId: typeof PacketId.lapPositions; header: PacketHeader } & Infer<
  typeof lapPositionsBodySchema
>;
