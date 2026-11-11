// `race-forecast` (SP4.3a spec 6.3): a simulator (C50): the field to the flag under one scenario and one policy per
// car, from a starting point `forecast-field` built; draws only from the injected generator (C2). No reads, no
// cadence, no topic.
import type { ForecastResult, Policy, Scenario, StartingPoint } from '@pitwall/domain';
import { defineSimulator, type Rng } from '@pitwall/engine/readers';

export const SIMULATOR = defineSimulator('race-forecast');

/** The field at the flag (or at `opts.toLap`) under `scenario`, each car following its policy (by car slot). */
export function raceForecast(
  _start: StartingPoint,
  _policies: readonly Policy[],
  _scenario: Scenario,
  _rng: Rng,
  _opts?: { trace?: boolean; toLap?: number },
): ForecastResult {
  throw new Error('not implemented');
}
