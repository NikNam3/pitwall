import type { PacketHeader, PacketId } from '../header.ts';
import { array, f32, struct, type Infer } from '../schema/dsl.ts';

const wheels = array(f32, 4);

/** Player car only. Wheel arrays are in game order: RL, RR, FL, FR. */
export const motionExBodySchema = struct({
  suspensionPosition: wheels,
  suspensionVelocity: wheels,
  suspensionAcceleration: wheels,
  wheelSpeed: wheels,
  wheelSlipRatio: wheels,
  wheelSlipAngle: wheels,
  wheelLatForce: wheels,
  wheelLongForce: wheels,
  heightOfCogAboveGround: f32,
  localVelocityX: f32,
  localVelocityY: f32,
  localVelocityZ: f32,
  angularVelocityX: f32,
  angularVelocityY: f32,
  angularVelocityZ: f32,
  angularAccelerationX: f32,
  angularAccelerationY: f32,
  angularAccelerationZ: f32,
  frontWheelsAngle: f32,
  wheelVertForce: wheels,
  frontAeroHeight: f32,
  rearAeroHeight: f32,
  frontRollAngle: f32,
  rearRollAngle: f32,
  chassisYaw: f32,
  chassisPitch: f32,
  wheelCamber: wheels,
  wheelCamberGain: wheels,
});

export type MotionExPacket = { packetId: typeof PacketId.motionEx; header: PacketHeader } & Infer<
  typeof motionExBodySchema
>;
