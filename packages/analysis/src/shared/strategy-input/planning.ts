// The planning job's input (SP4.3d2 Task 9; SP4.3d spec §7.1 steps 4–5, §7.2; C43, C50, C51, C62d): the strategy input
// on the ended qualifying session's as-of view. The starting point's units and `race-hazard` run on it as of its end,
// the grid is `gridOf`'s (the one grid, C43), the race's start `buildGridStart`'s (the one builder, C50) for the entered
// laps with our cars' start compounds free (the DP chooses them) and every rival's drawn; per our car its active
// prepared policy committed and its prepared slots; positions the grid places; our cars planned. Pure (C2);
// structured-cloneable (C51).
import { known, ourCars, unknown, type CarId, type Known, type Policy, type RaceAssumptions, type Slot } from '@pitwall/domain';
import { runAsOf, type AsOfView } from '@pitwall/engine/readers';
import { raceHazardAsOf } from '../../race-hazard/asof.ts';
import { buildGridStart, FORECAST_UNITS } from '../forecast-field/index.ts';
import { gridOf } from '../grid.ts';
import type { StrategyInput } from './input.ts';

/** What the planning round hands the job beyond the view: the race's laps as entered, per our car its prepared plans. */
export type PlanningRound = {
  laps: number;
  /**
   * The round's race assumptions (C62d, spec §4.3), forwarded to the one builder (`buildGridStart`, C50); absent:
   * `{ laps, sets: 'carried' }`.
   */
  // SP4.3e: required in Task 7b
  race?: RaceAssumptions;
  prepared: Record<CarId, { saved: Partial<Record<Slot, Policy>>; active: Slot | null }>;
};

/** The highest rain chance of the race's forecast samples (qualifying's `nextForecast`, spec §7.3); unknown without any (C3). */
function rainPctOf(asOf: AsOfView): Known<number> {
  const samples = asOf.fixed.weatherNow?.nextForecast ?? [];
  if (samples.length === 0) return unknown('notReceived');
  return known(Math.max(...samples.map((s) => s.rainPct)), asOf.at);
}

/** The planning job's input on the ended qualifying session's as-of view `asOf` (see the header). */
export function planningInputFrom(asOf: AsOfView, round: PlanningRound): StrategyInput {
  const { playerCar, teammateCar } = asOf.fixed;
  const cars = playerCar.known ? ourCars({ playerCar: playerCar.value, teammateCar: teammateCar.known ? teammateCar.value : undefined }) : [];
  const ours = new Set<CarId>(cars);
  // the units run on the view as of its end, none of their outputs copied from elsewhere (C41)
  const view: AsOfView = { ...asOf, outputs: new Map() };
  const outputs = runAsOf(FORECAST_UNITS, view);
  const grid = gridOf(view);
  const start = grid.known
    ? buildGridStart(view, outputs, { laps: round.laps, grid: grid.value, fittedCompound: (car) => (ours.has(car) ? 'free' : unknown('notReceived')), race: round.race ?? { laps: round.laps, sets: 'carried' } })
    : unknown(grid.reason);

  const committed: Record<CarId, Policy | null> = {};
  const slots: NonNullable<StrategyInput['slots']> = {};
  const positions: Record<CarId, number> = {};
  const gridPlace: Record<CarId, Known<number>> = {};
  for (const car of cars) {
    const prepared = round.prepared[car] ?? { saved: {}, active: null };
    committed[car] = prepared.active === null ? null : (prepared.saved[prepared.active] ?? null);
    slots[car] = { saved: { ...prepared.saved }, active: prepared.active };
    const place = grid.known ? grid.value.indexOf(car) + 1 : 0;
    gridPlace[car] = !grid.known ? grid : place > 0 ? known(place, grid.at) : unknown('notApplicable');
    if (place > 0) positions[car] = place;
  }
  return {
    start,
    hazard: raceHazardAsOf(view),
    ourCars: cars,
    planned: cars,
    committed,
    slots,
    positions,
    config: asOf.config,
    prefill: true,
    planning: { laps: round.laps, gridPlace, rainPct: rainPctOf(asOf) },
  };
}
