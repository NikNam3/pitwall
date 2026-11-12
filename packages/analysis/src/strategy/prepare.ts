// `strategy`'s job input (SP4.3b spec §8.1): `prepare` takes the starting point (`forecast-field`), `race-hazard`'s
// tables, the newest plan decision per our car and the config from the view; structured-cloneable (C51).
import type { CarId, Known, Policy, RaceHazard, StartingPoint } from '@pitwall/domain';
import type { EngineView } from '@pitwall/engine/readers';

/** The job's input: per our car its committed plan (or `null`); the starting point and hazard as of the trigger. */
export type StrategyInput = {
  start: Known<StartingPoint>;
  hazard: RaceHazard;
  ourCars: CarId[];
  committed: Record<CarId, Policy | null>;
  config: EngineView['config'];
};

/** The job's input from the view (≤ 20 ms, spec §8.1). */
export function prepareStrategy(_view: EngineView): StrategyInput {
  throw new Error('not implemented');
}
