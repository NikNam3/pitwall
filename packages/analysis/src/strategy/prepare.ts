// `strategy`'s job input (SP4.3b spec §8.1): `prepare` takes the starting point (`forecast-field`), `race-hazard`'s
// tables, the newest plan decision per our car and the config from the view; structured-cloneable (C51).
import { latestPlan, unknown, type CarId, type DecisionRecord, type Known, type Policy, type RaceHazard, type StartingPoint } from '@pitwall/domain';
import { asOfNow, runAsOf, type EngineView } from '@pitwall/engine/readers';
import { RACE_HAZARD } from '../race-hazard/id.ts';
import { behaviourFor } from '../shared/behaviour.ts';
import { buildStartingPoint, FORECAST_UNITS } from '../shared/forecast-field/index.ts';
import { ourCars } from '../shared/our-cars.ts';
import { STRATEGY_BEHAVIOUR } from './behaviour.ts';

/**
 * The job's input: the starting point and hazard as of the trigger; our cars, those of them the job plans (`planned`,
 * by the behaviour table) and per our car its committed plan (or `null`); the run's config.
 */
export type StrategyInput = {
  start: Known<StartingPoint>;
  hazard: RaceHazard;
  ourCars: CarId[];
  planned: CarId[];
  committed: Record<CarId, Policy | null>;
  config: EngineView['config'];
  /** The one car of ours a part plans (SP4.3b Q4 D, Task 25); absent: every car planned, one after another. */
  planCar?: CarId;
};

/** The starting point now, `notApplicable` without a track file's braking zones (the forecast's lap points). */
function startOf(view: EngineView): Known<StartingPoint> {
  const track = view.track;
  if (!track.known || !track.value.brakingZones.known) return unknown('notApplicable');
  const asOf = asOfNow(view);
  return buildStartingPoint(asOf, runAsOf(FORECAST_UNITS, asOf));
}

/** The job's input from the view (≤ 20 ms, spec §8.1). */
export function prepareStrategy(view: EngineView): StrategyInput {
  const live = view.live;
  const cars = ourCars({ playerCar: live.playerCar, teammateCar: live.teammateCar });
  const committed: Record<CarId, Policy | null> = {};
  // the decisions are facts, never changed (C24): read as the plain records they are
  const history = view.history as { readonly decisions: readonly DecisionRecord[] };
  for (const car of cars) committed[car] = latestPlan(history, car);
  const hazard = (view.outputs.get(RACE_HAZARD) as RaceHazard | undefined) ?? unknown('insufficientData');
  const planned = cars.filter((car) => behaviourFor(STRATEGY_BEHAVIOUR, view, car).every((row) => row === 'plan'));
  return { start: startOf(view), hazard, ourCars: cars, planned, committed, config: view.config };
}
