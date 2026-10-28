import { MAX_CARS, type PacketHeader, type PacketId } from '../header.ts';
import { array, f32, struct, u8, type Infer } from '../schema/dsl.ts';

export const carSetupDataSchema = struct({
  frontWing: u8,
  rearWing: u8,
  onThrottle: u8,
  offThrottle: u8,
  frontCamber: f32,
  rearCamber: f32,
  frontToe: f32,
  rearToe: f32,
  frontSuspension: u8,
  rearSuspension: u8,
  frontAntiRollBar: u8,
  rearAntiRollBar: u8,
  frontSuspensionHeight: u8,
  rearSuspensionHeight: u8,
  brakePressure: u8,
  brakeBias: u8,
  engineBraking: u8,
  rearLeftTyrePressure: f32,
  rearRightTyrePressure: f32,
  frontLeftTyrePressure: f32,
  frontRightTyrePressure: f32,
  ballast: u8,
  fuelLoad: f32,
});

export const carSetupsBodySchema = struct({
  carSetupData: array(carSetupDataSchema, MAX_CARS),
  nextFrontWingValue: f32,
});

export type CarSetupsPacket = { packetId: typeof PacketId.carSetups; header: PacketHeader } & Infer<
  typeof carSetupsBodySchema
>;
