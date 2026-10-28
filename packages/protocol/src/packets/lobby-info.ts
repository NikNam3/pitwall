import { MAX_CARS, type PacketHeader, type PacketId } from '../header.ts';
import { array, chars, struct, u8, u16, type Infer } from '../schema/dsl.ts';

export const lobbyInfoDataSchema = struct({
  aiControlled: u8,
  teamId: u8,
  nationality: u8,
  platform: u8,
  name: chars(32),
  carNumber: u8,
  yourTelemetry: u8,
  showOnlineNames: u8,
  techLevel: u16,
  readyStatus: u8,
});

export const lobbyInfoBodySchema = struct({
  numPlayers: u8,
  lobbyPlayers: array(lobbyInfoDataSchema, MAX_CARS),
});

export type LobbyInfoPacket = { packetId: typeof PacketId.lobbyInfo; header: PacketHeader } & Infer<
  typeof lobbyInfoBodySchema
>;
