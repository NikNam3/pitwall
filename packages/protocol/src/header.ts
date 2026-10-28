import { struct, u8, u16, u32, u64, f32, type Infer } from './schema/dsl.ts';

/** The only packet format this project decodes (F1 25). */
export const PACKET_FORMAT = 2025;
export const HEADER_SIZE = 29;
export const MAX_CARS = 22;

/** Packet ids in the order of the F1 25 spec (`ePacketId…`). */
export const PacketId = {
  motion: 0,
  session: 1,
  lapData: 2,
  event: 3,
  participants: 4,
  carSetups: 5,
  carTelemetry: 6,
  carStatus: 7,
  finalClassification: 8,
  lobbyInfo: 9,
  carDamage: 10,
  sessionHistory: 11,
  tyreSets: 12,
  motionEx: 13,
  timeTrial: 14,
  lapPositions: 15,
} as const;
export type PacketName = keyof typeof PacketId;
export type PacketId = (typeof PacketId)[PacketName];

export const headerSchema = struct({
  packetFormat: u16,
  gameYear: u8,
  gameMajorVersion: u8,
  gameMinorVersion: u8,
  packetVersion: u8,
  packetId: u8,
  sessionUid: u64,
  sessionTime: f32,
  frameIdentifier: u32,
  overallFrameIdentifier: u32,
  playerCarIndex: u8,
  secondaryPlayerCarIndex: u8,
});
export type PacketHeader = Infer<typeof headerSchema>;
