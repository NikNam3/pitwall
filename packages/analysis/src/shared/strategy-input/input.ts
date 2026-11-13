// The strategy input (SP4.3b spec §8.1; moved from `strategy/prepare.ts`, SP4.3b2 Task 6): the starting point
// (`forecast-field`), `race-hazard`'s tables, the newest plan decision per our car, our cars' race positions and the
// config from the view; structured-cloneable (C51). `strategy` and the calls read the same input (C43).
import { latestPlan, unknown, type CarId, type DecisionRecord, type Known, type Policy, type RaceHazard, type StartingPoint } from '@pitwall/domain';
import { asOfNow, runAsOf, type Dependency, type EngineView } from '@pitwall/engine/readers';
import { RACE_HAZARD } from '../../race-hazard/id.ts';
import { STRATEGY_BEHAVIOUR } from '../../strategy/behaviour.ts';
import { behaviourFor } from '../behaviour.ts';
import { CAR_STATUS_READS } from '../car-status.ts';
import { buildStartingPoint, FORECAST_UNITS } from '../forecast-field/index.ts';
import { ourCars } from '../our-cars.ts';

/**
 * The input: the starting point and hazard as of the trigger; our cars, those of them planned (`planned`, by
 * `strategy`'s behaviour table), per our car its committed plan (or `null`) and its race position at the trigger
 * (`positions`); the run's config.
 */
export type StrategyInput = {
  start: Known<StartingPoint>;
  hazard: RaceHazard;
  ourCars: CarId[];
  planned: CarId[];
  committed: Record<CarId, Policy | null>;
  positions: Record<CarId, number>;
  config: EngineView['config'];
  /** The one car of ours a part plans (SP4.3b Q4 D, Task 25); absent: every car planned, one after another. */
  planCar?: CarId;
};

const OWN_READS: Dependency[] = [
  'laps', 'stints', 'pitStops', 'miniSectors', 'events', 'decisions', 'drivers', 'session', 'identity', 'tyres', 'timing',
  'spans:session-phase-race', 'spans:car-activity-race', 'spans:car-driver', 'spans:compound-rule', 'spans:weekend-phase', CAR_STATUS_READS,
  { calculator: 'race-hazard' },
];

/** What `strategyInputFrom` reads (C41): its own reads and those of `forecast-field`'s estimation units, which run inside it. */
export const STRATEGY_INPUT_READS: Dependency[] = [...OWN_READS];
for (const unit of FORECAST_UNITS) {
  for (const read of unit.reads) {
    // an estimation unit's upstream unit runs inside too: no output of it is read from the view
    if (typeof read === 'object' || STRATEGY_INPUT_READS.includes(read)) continue;
    STRATEGY_INPUT_READS.push(read);
  }
}

/** The starting point now, `notApplicable` without a track file's braking zones (the forecast's lap points). */
function startOf(view: EngineView): Known<StartingPoint> {
  const track = view.track;
  if (!track.known || !track.value.brakingZones.known) return unknown('notApplicable');
  const asOf = asOfNow(view);
  return buildStartingPoint(asOf, runAsOf(FORECAST_UNITS, asOf));
}

/** The strategy input from the view (≤ 20 ms, spec §8.1). */
export function strategyInputFrom(view: EngineView): StrategyInput {
  const live = view.live;
  const cars = ourCars({ playerCar: live.playerCar, teammateCar: live.teammateCar });
  const committed: Record<CarId, Policy | null> = {};
  const positions: Record<CarId, number> = {};
  // the decisions are facts, never changed (C24): read as the plain records they are
  const history = view.history as { readonly decisions: readonly DecisionRecord[] };
  for (const car of cars) {
    committed[car] = latestPlan(history, car);
    const position = live.cars.find((c) => c.id === car)?.timing.position;
    if (position !== undefined) positions[car] = position;
  }
  const hazard = (view.outputs.get(RACE_HAZARD) as RaceHazard | undefined) ?? unknown('insufficientData');
  const planned = cars.filter((car) => behaviourFor(STRATEGY_BEHAVIOUR, view, car).every((row) => row === 'plan'));
  return { start: startOf(view), hazard, ourCars: cars, planned, committed, positions, config: view.config };
}
