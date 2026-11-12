// The lap model's parameters (SP4.3a spec 6.2, plan review P9, C50): built here, by `forecast-field`, from the as-of
// view and the units' outputs; `lap-model` takes them as plain inputs.
import type { LapModelParams } from '@pitwall/domain';
import type { AsOfView, CalculatorId } from '@pitwall/engine/readers';

/**
 * The compound offsets fitted from `degradation`'s α per compound with the track file's offsets as a weak prior (a
 * compound without a stint takes the track file's); fuel 30 ms/kg; the cold-tyre terms of lap 1 and 2 and their wet
 * factor; the neutralised factors; the wetness terms.
 */
export function lapModelParams(_view: AsOfView, _outputs: ReadonlyMap<CalculatorId, unknown>): LapModelParams {
  throw new Error('not implemented');
}
