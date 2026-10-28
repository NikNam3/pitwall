import { HEADER_SIZE } from './header.ts';
import { PACKET_SIZES } from './sizes.ts';
import { f32, struct, u8, u32, type Infer, type StructSpec } from './schema/dsl.ts';

/** Event string codes of the F1 25 spec, in spec order. */
export const EVENT_CODES = [
  'SSTA', 'SEND', 'FTLP', 'RTMT', 'DRSE', 'DRSD', 'TMPT', 'CHQF', 'RCWN', 'PENA', 'SPTP',
  'STLG', 'LGOT', 'DTSV', 'SGSV', 'FLBK', 'BUTN', 'RDFL', 'OVTK', 'SCAR', 'COLL',
] as const;
export type EventCode = (typeof EVENT_CODES)[number];

/** Bytes of the event string code (`m_eventStringCode`). */
export const EVENT_CODE_LENGTH = 4;
/** Size of the `EventDataDetails` union: the largest variant (SPTP) sets it. */
export const EVENT_DETAILS_LENGTH = PACKET_SIZES.event - HEADER_SIZE - EVENT_CODE_LENGTH;

const noDetails = struct({});

/** Layout of each variant of the `EventDataDetails` union (field names as in the C union, without `m_`). */
export const EVENT_DETAILS_SCHEMAS = {
  SSTA: noDetails,
  SEND: noDetails,
  FTLP: struct({ vehicleIdx: u8, lapTime: f32 }),
  RTMT: struct({ vehicleIdx: u8, reason: u8 }),
  DRSE: noDetails,
  DRSD: struct({ reason: u8 }),
  TMPT: struct({ vehicleIdx: u8 }),
  CHQF: noDetails,
  RCWN: struct({ vehicleIdx: u8 }),
  PENA: struct({
    penaltyType: u8,
    infringementType: u8,
    vehicleIdx: u8,
    otherVehicleIdx: u8,
    time: u8,
    lapNum: u8,
    placesGained: u8,
  }),
  SPTP: struct({
    vehicleIdx: u8,
    speed: f32,
    isOverallFastestInSession: u8,
    isDriverFastestInSession: u8,
    fastestVehicleIdxInSession: u8,
    fastestSpeedInSession: f32,
  }),
  STLG: struct({ numLights: u8 }),
  LGOT: noDetails,
  DTSV: struct({ vehicleIdx: u8 }),
  SGSV: struct({ vehicleIdx: u8, stopTime: f32 }),
  FLBK: struct({ flashbackFrameIdentifier: u32, flashbackSessionTime: f32 }),
  BUTN: struct({ buttonStatus: u32 }),
  RDFL: noDetails,
  OVTK: struct({ overtakingVehicleIdx: u8, beingOvertakenVehicleIdx: u8 }),
  SCAR: struct({ safetyCarType: u8, eventType: u8 }),
  COLL: struct({ vehicle1Idx: u8, vehicle2Idx: u8 }),
} as const satisfies { readonly [C in EventCode]: StructSpec };

/** A decoded event: the code plus the fields of its variant, so `code` narrows the rest. */
export type EventDetails = {
  [C in EventCode]: { code: C } & Infer<(typeof EVENT_DETAILS_SCHEMAS)[C]>;
}[EventCode];
export type EventDetailsOf<C extends EventCode> = Extract<EventDetails, { code: C }>;

export function isEventCode(code: string): code is EventCode {
  return Object.hasOwn(EVENT_DETAILS_SCHEMAS, code);
}
