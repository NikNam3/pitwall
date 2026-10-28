import { MAX_CARS, type PacketHeader, type PacketId } from '../header.ts';
import { array, f32, i8, struct, u8, u16, type Infer } from '../schema/dsl.ts';

/** Wheel arrays are in game order: RL, RR, FL, FR. */
export const carTelemetryDataSchema = struct({
  speed: u16,
  throttle: f32,
  steer: f32,
  brake: f32,
  clutch: u8,
  gear: i8,
  engineRpm: u16,
  drs: u8,
  revLightsPercent: u8,
  revLightsBitValue: u16,
  brakesTemperature: array(u16, 4),
  tyresSurfaceTemperature: array(u8, 4),
  tyresInnerTemperature: array(u8, 4),
  engineTemperature: u16,
  tyresPressure: array(f32, 4),
  surfaceType: array(u8, 4),
});

export const carTelemetryBodySchema = struct({
  carTelemetryData: array(carTelemetryDataSchema, MAX_CARS),
  mfdPanelIndex: u8,
  mfdPanelIndexSecondaryPlayer: u8,
  suggestedGear: i8,
});

export type CarTelemetryPacket = { packetId: typeof PacketId.carTelemetry; header: PacketHeader } & Infer<
  typeof carTelemetryBodySchema
>;
