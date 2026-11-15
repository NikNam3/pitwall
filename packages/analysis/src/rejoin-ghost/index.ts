// `rejoin-ghost` (SP4.3c spec §5.7, O18): publishes `rejoinGhost.car`: per our car and condition, where the car was
// `rejoin`'s stop cost ago, on every frame.
import type { CarId, RejoinGhost } from '@pitwall/domain';

export type { RejoinGhost } from '@pitwall/domain';

/** The analysis id. */
export const REJOIN_GHOST = 'rejoin-ghost';

/** The output: per our car with a `rejoin` entry its `rejoinGhost.car` value. */
export type RejoinGhostOutput = { cars: Record<CarId, RejoinGhost> };
