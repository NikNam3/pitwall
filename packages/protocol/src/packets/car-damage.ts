import { MAX_CARS, type PacketHeader, type PacketId } from '../header.ts';
import { array, f32, struct, u8, type Infer } from '../schema/dsl.ts';

/** Wheel arrays are in game order: RL, RR, FL, FR. */
export const carDamageDataSchema = struct({
  tyresWear: array(f32, 4),
  tyresDamage: array(u8, 4),
  brakesDamage: array(u8, 4),
  tyreBlisters: array(u8, 4),
  frontLeftWingDamage: u8,
  frontRightWingDamage: u8,
  rearWingDamage: u8,
  floorDamage: u8,
  diffuserDamage: u8,
  sidepodDamage: u8,
  drsFault: u8,
  ersFault: u8,
  gearBoxDamage: u8,
  engineDamage: u8,
  engineMguhWear: u8,
  engineEsWear: u8,
  engineCeWear: u8,
  engineIceWear: u8,
  engineMgukWear: u8,
  engineTcWear: u8,
  engineBlown: u8,
  engineSeized: u8,
});

export const carDamageBodySchema = struct({
  carDamageData: array(carDamageDataSchema, MAX_CARS),
});

export type CarDamagePacket = { packetId: typeof PacketId.carDamage; header: PacketHeader } & Infer<
  typeof carDamageBodySchema
>;
