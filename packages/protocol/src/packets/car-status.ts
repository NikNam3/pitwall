import { MAX_CARS, type PacketHeader, type PacketId } from '../header.ts';
import { array, f32, i8, struct, u8, u16, type Infer } from '../schema/dsl.ts';

export const carStatusDataSchema = struct({
  tractionControl: u8,
  antiLockBrakes: u8,
  fuelMix: u8,
  frontBrakeBias: u8,
  pitLimiterStatus: u8,
  fuelInTank: f32,
  fuelCapacity: f32,
  fuelRemainingLaps: f32,
  maxRpm: u16,
  idleRpm: u16,
  maxGears: u8,
  drsAllowed: u8,
  drsActivationDistance: u16,
  actualTyreCompound: u8,
  visualTyreCompound: u8,
  tyresAgeLaps: u8,
  vehicleFiaFlags: i8,
  enginePowerIce: f32,
  enginePowerMguk: f32,
  ersStoreEnergy: f32,
  ersDeployMode: u8,
  ersHarvestedThisLapMguk: f32,
  ersHarvestedThisLapMguh: f32,
  ersDeployedThisLap: f32,
  networkPaused: u8,
});

export const carStatusBodySchema = struct({
  carStatusData: array(carStatusDataSchema, MAX_CARS),
});

export type CarStatusPacket = { packetId: typeof PacketId.carStatus; header: PacketHeader } & Infer<
  typeof carStatusBodySchema
>;
