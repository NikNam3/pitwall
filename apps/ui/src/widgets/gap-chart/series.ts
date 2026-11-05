// Pure helpers of the gap chart: the reference option, the bands and one line per car.
import type { CarOverview } from '@pitwall/contracts';
import type { CarId, GapperLines, GapperReference } from '@pitwall/domain';
import { carCodeById } from '../../kit/car/car-label.ts';
import type { ChartSeries, PhaseBand } from '../../kit/chart/data.ts';
import { role } from '../../theme/index.ts';

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
 * One line per car of the gapper's window with points or a gap now: x as the gapper gives it (completed laps plus the
 * segment), y = -gap in seconds, so a car losing time drops. A car with a gap now continues to it as a live (dotted)
 * last segment. Ours in the ownCar role (the teammate dashed), every other car textFaint; the kit chart owns the y range.
 */
export function gapSeries(lines: GapperLines, cars: readonly CarOverview[], ours: ReadonlySet<CarId>): ChartSeries[] {
  const out: ChartSeries[] = [];
  const player = ours.values().next().value;
  for (const line of lines.cars) {
    // `points` is optional until Task 15; a gapper line without it falls back to its per-lap points.
    const drawn = line.points ?? line.byLap;
    if (drawn.length === 0 && !line.now.known) continue;
    const points: ChartSeries['points'] = drawn.map((p) => [p.lap, -p.gapMs / 1000]);
    if (line.now.known) points.push([line.now.value.lap, -line.now.value.gapMs / 1000]);
    const own = ours.has(line.carId);
    out.push({
      label: carCodeById(cars, line.carId).text,
      points,
      ...(line.now.known ? { liveEnd: true } : {}),
      colour: own ? { colour: role('ownCar'), dashed: line.carId !== player, ownCar: true } : { colour: role('textFaint'), dashed: false, ownCar: false },
    });
  }
  return out;
}
