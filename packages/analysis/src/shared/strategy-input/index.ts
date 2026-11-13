// The shared strategy input (SP4.3b2 Task 6; C43): what `strategy`'s job and the calls both build their runs from, one
// copy each: the input from the view, the DP's input per car, the Monte Carlo hazard and settings, a candidate's policy.
import type { DpPlan } from '../../strategy-dp/index.ts';
import type { McInput } from '../../race-monte-carlo/index.ts';
import type { Policy, RaceHazard, StartingPoint, Trigger } from '@pitwall/domain';
import { hazardOf } from './dp-input.ts';

export { committedField, followable } from './committed-field.ts';
export { dpInputOn, hazardOf, notPlannedWhy, plainRoad, plannedCars, plannedField, toDpInput, type PlainRoad } from './dp-input.ts';
export { STRATEGY_INPUT_READS, strategyInputFrom, type StrategyInput } from './input.ts';
export { mcSettingsFrom, pointsOf, strategyConfigOf } from './settings.ts';

/**
 * `race-hazard`'s tables as `race-monte-carlo` reads them: index 0 is the leader's lap of `start`, without `start` the
 * hazard's own first lap (the leader's lap when `race-hazard` last ran), up to its last lap.
 */
export function toMcHazard(hazard: RaceHazard, start?: Pick<StartingPoint, 'lap' | 'lapsTotal'>): McInput['hazard'] {
  if (start !== undefined) return hazardOf(start, hazard);
  const laps = hazard.known ? hazard.value.byLap.map((b) => b.lap) : [];
  const first = laps.length === 0 ? 0 : Math.min(...laps);
  const last = laps.length === 0 ? -1 : Math.max(...laps);
  return hazardOf({ lap: first, lapsTotal: last }, hazard);
}

/** A plan's stops with the triggers that change them inside a scenario: the one builder of a candidate's policy. */
export function policyOf(plan: Pick<DpPlan, 'stops'> & Partial<DpPlan>, thresholds: readonly Trigger[]): Policy {
  return { stops: plan.stops.map((s) => ({ lap: s.lap, compound: s.compound })), triggers: thresholds.map((t) => structuredClone(t)) };
}
