import type { PacketHeader, PacketId } from '../header.ts';
import { struct, u8, u32, type Infer } from '../schema/dsl.ts';

export const timeTrialDataSetSchema = struct({
  carIdx: u8,
  teamId: u8,
  lapTimeInMs: u32,
  sector1TimeInMs: u32,
  sector2TimeInMs: u32,
  sector3TimeInMs: u32,
  tractionControl: u8,
  gearboxAssist: u8,
  antiLockBrakes: u8,
  equalCarPerformance: u8,
  customSetup: u8,
  valid: u8,
});

export const timeTrialBodySchema = struct({
  playerSessionBestDataSet: timeTrialDataSetSchema,
  personalBestDataSet: timeTrialDataSetSchema,
  rivalDataSet: timeTrialDataSetSchema,
});

export type TimeTrialPacket = { packetId: typeof PacketId.timeTrial; header: PacketHeader } & Infer<
  typeof timeTrialBodySchema
>;
