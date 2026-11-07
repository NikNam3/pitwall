// `sc-call` (SP4.2 spec 3.3): publishes `scCall.car`: what a stop under an SC or VSC would gain against a green stop.
import type { CarId, ScCall } from '@pitwall/domain';

export type { ScCall, ScCallRow } from '@pitwall/domain';

/** The analysis id. */
export const SC_CALL = 'sc-call';

/** The output: per our car its `scCall.car` value; a rival or a car without a rejoin answer is absent. */
export type ScCallOutput = Record<CarId, ScCall>;
