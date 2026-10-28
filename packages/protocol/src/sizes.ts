import type { PacketName } from './header.ts';

/** Total packet size in bytes, header included (F1 25 spec). Key order is packet id order. */
export const PACKET_SIZES = {
  motion: 1349,
  session: 753,
  lapData: 1285,
  event: 45,
  participants: 1284,
  carSetups: 1133,
  carTelemetry: 1352,
  carStatus: 1239,
  finalClassification: 1042,
  lobbyInfo: 954,
  carDamage: 1041,
  sessionHistory: 1460,
  tyreSets: 231,
  motionEx: 273,
  timeTrial: 101,
  lapPositions: 1131,
} as const satisfies Record<PacketName, number>;
