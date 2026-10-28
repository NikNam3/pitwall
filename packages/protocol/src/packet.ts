import type { PacketId, PacketName } from './header.ts';
import type { EventPacket } from './packets/event.ts';
import type { CarDamagePacket, CarSetupsPacket, CarStatusPacket, CarTelemetryPacket, FinalClassificationPacket,
  LapDataPacket, LapPositionsPacket, LobbyInfoPacket, MotionExPacket, MotionPacket, ParticipantsPacket, SessionHistoryPacket,
  SessionPacket, TimeTrialPacket, TyreSetsPacket } from './packets/index.ts';

/** Every decoded F1 25 packet; `packetId` is the discriminant. */
export type Packet =
  | MotionPacket
  | SessionPacket
  | LapDataPacket
  | EventPacket
  | ParticipantsPacket
  | CarSetupsPacket
  | CarTelemetryPacket
  | CarStatusPacket
  | FinalClassificationPacket
  | LobbyInfoPacket
  | CarDamagePacket
  | SessionHistoryPacket
  | TyreSetsPacket
  | MotionExPacket
  | TimeTrialPacket
  | LapPositionsPacket;

/** The packet type named by a `PacketName`, e.g. `PacketOf<'lapData'>`. */
export type PacketOf<N extends PacketName> = Extract<Packet, { packetId: (typeof PacketId)[N] }>;
