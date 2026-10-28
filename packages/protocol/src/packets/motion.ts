import { MAX_CARS, type PacketHeader, type PacketId } from '../header.ts';
import { array, f32, i16, struct, type Infer } from '../schema/dsl.ts';

export const carMotionDataSchema = struct({
  worldPositionX: f32,
  worldPositionY: f32,
  worldPositionZ: f32,
  worldVelocityX: f32,
  worldVelocityY: f32,
  worldVelocityZ: f32,
  worldForwardDirX: i16,
  worldForwardDirY: i16,
  worldForwardDirZ: i16,
  worldRightDirX: i16,
  worldRightDirY: i16,
  worldRightDirZ: i16,
  gForceLateral: f32,
  gForceLongitudinal: f32,
  gForceVertical: f32,
  yaw: f32,
  pitch: f32,
  roll: f32,
});

export const motionBodySchema = struct({
  carMotionData: array(carMotionDataSchema, MAX_CARS),
});

export type MotionPacket = { packetId: typeof PacketId.motion; header: PacketHeader } & Infer<typeof motionBodySchema>;
