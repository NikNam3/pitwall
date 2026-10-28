import { MAX_CARS, type PacketHeader, type PacketId } from '../header.ts';
import { array, chars, struct, u8, u16, type Infer } from '../schema/dsl.ts';

export const liveryColourSchema = struct({
  red: u8,
  green: u8,
  blue: u8,
});

export const participantDataSchema = struct({
  aiControlled: u8,
  driverId: u8,
  networkId: u8,
  teamId: u8,
  myTeam: u8,
  raceNumber: u8,
  nationality: u8,
  name: chars(32),
  yourTelemetry: u8,
  showOnlineNames: u8,
  techLevel: u16,
  platform: u8,
  numColours: u8,
  liveryColours: array(liveryColourSchema, 4),
});

export const participantsBodySchema = struct({
  numActiveCars: u8,
  participants: array(participantDataSchema, MAX_CARS),
});

export type ParticipantsPacket = { packetId: typeof PacketId.participants; header: PacketHeader } & Infer<
  typeof participantsBodySchema
>;
