// Pure helpers of the gap chart: the reference option, the bands and one line per car.
import type { CarOverview } from '@pitwall/contracts';
import type { CarId, GapperLines, GapperReference } from '@pitwall/domain';
import { carCodeById } from '../../kit/car/car-label.ts';
import type { ChartSeries, PhaseBand } from '../../kit/chart/data.ts';
import { carColour } from '../../theme/index.ts';

/** The gapper's reference kinds, the default first. */
export const REFERENCE_KINDS = ['leaderAverage', 'carAverage', 'fixed'] as const;

/** The gapper's reference from the panel options; a missing or unusable choice falls back to the leader average. */
export function gapperReference(
  options: { reference?: unknown; referenceCar?: unknown; fixedLapS?: unknown },
  primary: CarId,
): GapperReference {
  if (options.reference === 'carAverage') {
    return { kind: 'carAverage', carId: typeof options.referenceCar === 'number' ? (options.referenceCar as CarId) : primary };
  }
  if (options.reference === 'fixed' && typeof options.fixedLapS === 'number' && options.fixedLapS > 0) {
    return { kind: 'fixed', lapMs: Math.round(options.fixedLapS * 1000) };
  }
  return { kind: 'leaderAverage' };
}

const BAND_KIND = { SC: 'sc', VSC: 'vsc', red: 'red' } as const;

/** The narrowest band in laps, so a phase under which the field stood still (a red flag) still shows. */
export const MIN_BAND_LAPS = 0.25;

/** The gapper's phases as chart bands on its x; an open phase runs to the right edge of the plot. */
export function phaseBands(phases: GapperLines['phases']): PhaseBand[] {
  return phases.map((p) => ({
    from: p.fromLap,
    to: Math.max(p.toLap.known ? p.toLap.value : Number.POSITIVE_INFINITY, p.fromLap + MIN_BAND_LAPS),
    kind: BAND_KIND[p.kind],
  }));
}

/**
 * One line per car with laps or a gap now: lap against -gap in seconds, so a car losing time drops; `ours` from kit
 * `ourCars`. A car with a gap now continues to it as a live (dotted) last segment; in lap 1, before any completed lap,
 * its line is just that live point.
 */
export function gapSeries(lines: GapperLines, cars: readonly CarOverview[], ours: ReadonlySet<CarId>): ChartSeries[] {
  const field = cars.map((c) => ({ id: c.id, teamId: c.identity.teamId, raceNumber: c.identity.raceNumber }));
  const out: ChartSeries[] = [];
  for (const line of lines.cars) {
    if (line.byLap.length === 0 && !line.now.known) continue;
    const car = cars.find((c) => c.id === line.carId);
    const points: ChartSeries['points'] = line.byLap.map((p) => [p.lap, -p.gapMs / 1000]);
    if (line.now.known) points.push([line.now.value.lap, -line.now.value.gapMs / 1000]);
    out.push({
      label: carCodeById(cars, line.carId).text,
      points,
      ...(line.now.known ? { liveEnd: true } : {}),
      colour: carColour(car ? { id: car.id, teamId: car.identity.teamId, raceNumber: car.identity.raceNumber } : { id: line.carId, teamId: -1, raceNumber: 0 }, field, ours),
    });
  }
  return out;
}
