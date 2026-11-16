// `strategy-overview`: the field's strategies in one table (SP4.3d spec §6.4): per our car the competing cars within one
// green pit loss ahead or behind it, plus its teammate, in race order, each with its predicted next stop.
export type { OverviewRow, StrategyOverview } from '@pitwall/domain';
export { STRATEGY_OVERVIEW_BEHAVIOUR, type StrategyOverviewEffect } from './behaviour.ts';
export { strategyOverviewCalculator } from './calculator.ts';
export { STRATEGY_OVERVIEW } from './id.ts';
export type { StrategyOverviewOutput } from './output.ts';
