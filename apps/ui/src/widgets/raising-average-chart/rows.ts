// Pure helpers of the raising-average chart: which cars it draws and their lines, mapping only (C65).
import type { CarOverview, CarRef } from '@pitwall/contracts';
import type { CarId, RaisingAverage } from '@pitwall/domain';
import { carCodeById } from '../../kit/car/car-label.ts';
import type { AxisLabel } from '../../kit/chart/labels.ts';
import type { ChartSeries } from '../../kit/chart/data.ts';
import { lineLook, type LineCar } from './emphasis.ts';
import * as text from './text.ts';

/** A team id no team has: a car missing from `cars.overview` is drawn in the unknown team's look. */
const NO_TEAM = -1;

/**
 * The cars to draw, in drawing order: the rivals the options name (option order, each once; an option naming one of our
 * cars, as `player`, `teammate` or its id, adds none), then our cars (player, teammate), so ours are drawn on top.
 */
function drawnIds(ours: ReadonlySet<CarId>, rivals: ReadonlyArray<CarRef | undefined>): CarId[] {
  const out: CarId[] = [];
  for (const r of rivals) {
    if (r === undefined || r === 'player' || r === 'teammate' || ours.has(r) || out.includes(r)) continue;
    out.push(r);
  }
  return [...out, ...ours];
}

/**
 * One line per drawn car with a curve of at least one point: point X at x = X and y = the analysis's mean of the best X
 * laps; the car's code as label; the colour of `lineLook` over the drawn cars. `ours` is ordered: the player, then the
 * teammate; `rivals` are the options `rival1`–`rival3`, unset is no car.
 */
export function raisingSeries(
  analysis: RaisingAverage,
  cars: readonly CarOverview[],
  ours: ReadonlySet<CarId>,
  rivals: ReadonlyArray<CarRef | undefined>,
): ChartSeries[] {
  const curves = new Map(analysis.cars.filter((c) => c.pointsMs.length > 0).map((c) => [c.carId, c.pointsMs]));
  const drawn: LineCar[] = drawnIds(ours, rivals)
    .filter((id) => curves.has(id))
    .map((id) => {
      const identity = cars.find((c) => c.id === id)?.identity;
      return { id, teamId: identity?.teamId ?? NO_TEAM, raceNumber: identity?.raceNumber ?? 0 };
    });
  return drawn.map((car) => ({
    label: carCodeById(cars, car.id).text,
    points: (curves.get(car.id) ?? []).map((ms, i): [number, number] => [i + 1, ms]),
    colour: lineLook(car, drawn, ours),
  }));
}

/** The axis labels: full names both axes, compact none. */
export function axisLabels(mode: 'compact' | 'full'): { x: AxisLabel; y: AxisLabel } {
  return mode === 'full' ? { x: text.xLabel, y: text.yLabel } : { x: text.noAxisLabel, y: text.noAxisLabel };
}
