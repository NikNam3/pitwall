// STUB (SP4.3b2 Task 6, test phase): the shared strategy input, moved here from `strategy` by the implement phase.
// Every function throws until then; the types only name the interfaces of the task's brief.
import type { CarId, Policy, RaceHazard, Trigger } from '@pitwall/domain';
import type { Dependency, EngineView } from '@pitwall/engine/readers';
import type { McInput, RivalRules } from '../../race-monte-carlo/index.ts';
import type { DpInput, DpPlan } from '../../strategy-dp/index.ts';
import type { StrategyInput } from '../../strategy/prepare.ts';

export type { StrategyInput };

const notImplemented = (name: string): never => {
  throw new Error(`${name}: not implemented (SP4.3b2 Task 6)`);
};

export const STRATEGY_INPUT_READS: Dependency[] = [];

export function strategyInputFrom(_view: EngineView): StrategyInput {
  return notImplemented('strategyInputFrom');
}

export function toDpInput(_input: StrategyInput, _car: CarId): DpInput {
  return notImplemented('toDpInput');
}

export function toMcHazard(_hazard: RaceHazard): McInput['hazard'] {
  return notImplemented('toMcHazard');
}

export function policyOf(_plan: Pick<DpPlan, 'stops'> & Partial<DpPlan>, _thresholds: readonly Trigger[]): Policy {
  return notImplemented('policyOf');
}

export function mcSettingsFrom(_config: EngineView['config']): { rivalRules: RivalRules; points: number[]; zTie: number; tieBand: number } {
  return notImplemented('mcSettingsFrom');
}
