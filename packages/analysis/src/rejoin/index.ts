// `rejoin` (SP4.2 spec 3.2): publishes `rejoin.car` and `rejoin.ghostLines`: our car as if it were in the pit lane now.
import type { CarId, Known, Ms, PitCondition, Rejoin } from '@pitwall/domain';
import type { GapsOutput } from '../gaps/index.ts';

export type { CrossingRow, GhostLines, Rejoin, RejoinAt } from '@pitwall/domain';
export * from './config.ts';

/** The analysis id. */
export const REJOIN = 'rejoin';

/** What `ghostLinesOf` needs to build `rejoin.ghostLines` for a reference: the gaps, our losses, our cars. */
export type GhostLinesInput = { gaps: GapsOutput; losses: Record<PitCondition, Known<Ms>>; ourCars: CarId[]; ghostLaps: number };

/** The output: per our car its `rejoin.car` value (a rival or a car in the pit lane is absent), and the ghost lines' input. */
export type RejoinOutput = { cars: Record<CarId, Rejoin>; ghost: GhostLinesInput };
