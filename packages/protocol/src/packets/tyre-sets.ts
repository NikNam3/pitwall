import type { PacketHeader, PacketId } from '../header.ts';
import { array, i16, struct, u8, type Infer } from '../schema/dsl.ts';

export const tyreSetDataSchema = struct({
  actualTyreCompound: u8,
  visualTyreCompound: u8,
  wear: u8,
  available: u8,
  recommendedSession: u8,
  lifeSpan: u8,
  usableLife: u8,
  lapDeltaTime: i16,
  fitted: u8,
});

export const tyreSetsBodySchema = struct({
  carIdx: u8,
  /** 13 dry sets followed by 7 wet sets. */
  tyreSetData: array(tyreSetDataSchema, 20),
  fittedIdx: u8,
});

export type TyreSetsPacket = { packetId: typeof PacketId.tyreSets; header: PacketHeader } & Infer<
  typeof tyreSetsBodySchema
>;
