// `forecast-field` (SP4.3a spec 6.1, C50): the only builder of the simulators' starting point, from an `AsOfView` and
// the estimation units' outputs. Not a unit: shared by `forecast-score` and the 4.3b analyses.
import type { Known, StartingPoint } from '@pitwall/domain';
import type { AsOfView, CalculatorId } from '@pitwall/engine/readers';

export * from './config.ts';

/**
 * The starting point at `view`'s frame from the units' `outputs`; `progress` is the live frame's lap progress, else
 * each car is placed by its newest crossing and the time since at its current pace. `notApplicable` before lap 1 is
 * complete or outside the race.
 */
export function buildStartingPoint(
  _view: AsOfView,
  _outputs: ReadonlyMap<CalculatorId, unknown>,
  _progress?: { lapFraction: number[]; gapMs: number[] },
): Known<StartingPoint> {
  throw new Error('not implemented');
}
