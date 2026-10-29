// Pure helpers of the gap chart: the reference option, the folded flag phases, the bands and one line per car.
import type { CarOverview, Fold } from '@pitwall/contracts';
import type { CarId, FlagPhase, GapperLines, GapperReference } from '@pitwall/domain';
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

/** Flag phases ordered by start; a phase that arrives again (it ended or grew) replaces the old one. */
export const phasesFold: Fold<FlagPhase, FlagPhase[]> = {
  init: () => [],
  add: (acc, incoming) => {
    const kept = acc.filter((p) => !incoming.some((n) => n.start === p.start));
    return [...kept, ...incoming].sort((a, b) => a.start - b.start);
  },
};

const BAND_KIND = { SC: 'sc', VSC: 'vsc', red: 'red' } as const;

/** The phases as chart bands over the leader's laps, at least one lap wide. */
export function phaseBands(phases: readonly FlagPhase[]): PhaseBand[] {
  return phases.map((p) => ({
    from: p.startLeaderLap,
    to: Math.max(p.endLeaderLap, p.startLeaderLap + 1),
    kind: BAND_KIND[p.kind],
  }));
}

/** One line per car with laps: lap against -gap in seconds, so a car losing time drops; `ours` from kit `ourCars`. */
export function gapSeries(lines: GapperLines, cars: readonly CarOverview[], ours: ReadonlySet<CarId>): ChartSeries[] {
  const field = cars.map((c) => ({ id: c.id, teamId: c.identity.teamId, raceNumber: c.identity.raceNumber }));
  const out: ChartSeries[] = [];
  for (const line of lines.cars) {
    if (line.byLap.length === 0) continue;
    const car = cars.find((c) => c.id === line.carId);
    out.push({
      label: carCodeById(cars, line.carId).text,
      points: line.byLap.map((p) => [p.lap, -p.gapMs / 1000]),
      colour: carColour(car ? { id: car.id, teamId: car.identity.teamId, raceNumber: car.identity.raceNumber } : { id: line.carId, teamId: -1, raceNumber: 0 }, field, ours),
    });
  }
  return out;
}
