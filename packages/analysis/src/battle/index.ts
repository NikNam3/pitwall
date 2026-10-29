// `battle` (spec 6.3): publishes the per-car topic `battle.cards`.
import type { CarId, BattleCard } from '@pitwall/domain';

export type { BattleCard, BattleSide } from '@pitwall/domain';
export * from './config.ts';

/** The calculator id. */
export const BATTLE = 'battle';

/** The output: the topic's value per car; the binding's `select` picks `params.carId`. */
export type BattleOutput = Record<CarId, BattleCard>;
