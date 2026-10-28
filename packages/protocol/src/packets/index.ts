import type { PacketName } from '../header.ts';
import type { StructSpec } from '../schema/dsl.ts';
import { carDamageBodySchema } from './car-damage.ts';
import { carSetupsBodySchema } from './car-setups.ts';
import { carStatusBodySchema } from './car-status.ts';
import { carTelemetryBodySchema } from './car-telemetry.ts';
import { finalClassificationBodySchema } from './final-classification.ts';
import { lapDataBodySchema } from './lap-data.ts';
import { lapPositionsBodySchema } from './lap-positions.ts';
import { lobbyInfoBodySchema } from './lobby-info.ts';
import { motionBodySchema } from './motion.ts';
import { motionExBodySchema } from './motion-ex.ts';
import { participantsBodySchema } from './participants.ts';
import { sessionBodySchema } from './session.ts';
import { sessionHistoryBodySchema } from './session-history.ts';
import { timeTrialBodySchema } from './time-trial.ts';
import { tyreSetsBodySchema } from './tyre-sets.ts';

export * from './car-damage.ts';
export * from './car-setups.ts';
export * from './car-status.ts';
export * from './car-telemetry.ts';
export * from './final-classification.ts';
export * from './lap-data.ts';
export * from './lap-positions.ts';
export * from './lobby-info.ts';
export * from './motion.ts';
export * from './motion-ex.ts';
export * from './participants.ts';
export * from './session.ts';
export * from './session-history.ts';
export * from './time-trial.ts';
export * from './tyre-sets.ts';

/** Body schema (everything after the header) of every fixed-size packet; the event packet is variant-shaped. */
export const PACKET_BODIES: { readonly [N in Exclude<PacketName, 'event'>]: StructSpec } = {
  motion: motionBodySchema,
  session: sessionBodySchema,
  lapData: lapDataBodySchema,
  participants: participantsBodySchema,
  carSetups: carSetupsBodySchema,
  carTelemetry: carTelemetryBodySchema,
  carStatus: carStatusBodySchema,
  finalClassification: finalClassificationBodySchema,
  lobbyInfo: lobbyInfoBodySchema,
  carDamage: carDamageBodySchema,
  sessionHistory: sessionHistoryBodySchema,
  tyreSets: tyreSetsBodySchema,
  motionEx: motionExBodySchema,
  timeTrial: timeTrialBodySchema,
  lapPositions: lapPositionsBodySchema,
};
