// `strategy`'s config as the strategy job and the calls read it (SP4.3b spec §7.2, §7.3, §11.1; moved from
// `strategy/job.ts`, SP4.3b2 Task 6; plan Global Constraints: Agreement): one reading, so both agree (C43).
import type { EngineView } from '@pitwall/engine/readers';
import type { RivalRules } from '../../race-monte-carlo/index.ts';
import { STRATEGY_CONFIG, type StrategyConfig } from '../../strategy/config.ts';

/** `strategy`'s config of the run: its section of `config` over the defaults. */
export const strategyConfigOf = (config: EngineView['config']): StrategyConfig => ({ ...STRATEGY_CONFIG.defaults, ...config[STRATEGY_CONFIG.key] }) as StrategyConfig;

/** The points table (position 1 first) from its comma-separated config value. */
export const pointsOf = (config: StrategyConfig): number[] => String(config.points).split(',').map((p) => Number(p.trim()));

/** The `race-monte-carlo` settings from the run's config: the rivals' reaction rules, the points table, the tie test. */
export function mcSettingsFrom(config: EngineView['config']): { rivalRules: RivalRules; points: number[]; zTie: number; tieBand: number } {
  const c = strategyConfigOf(config);
  return {
    rivalRules: { q: c.rivalScBoxChance, aMin: c.rivalScMinTyreAge, reactionLaps: c.rivalReactionLaps, coverRule: false },
    points: pointsOf(c),
    zTie: c.zTie,
    tieBand: c.tieBand,
  };
}
