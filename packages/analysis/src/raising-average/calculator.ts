// The `raising-average` analysis (spec 3.1): per car its `forPace` laps (`lap-classes`, each lap's current record, C25)
// sorted ascending; point X the mean of the fastest X, rounded to integer ms. Every car with a lap record, by car id.
import { currentLaps, type CarId, type LapRecord, type Ms } from '@pitwall/domain';
import type { QuickCalculator } from '@pitwall/engine/readers';
import { isPaceLap, LAP_CLASSES_CONFIG, type LapClassOptions } from '../lap-classes/index.ts';
import { behaviourFor } from '../shared/behaviour.ts';
import { phaseRow, RAISING_AVERAGE_BEHAVIOUR, type RaisingAverageEffect } from './behaviour.ts';
import { RAISING_AVERAGE, type RaisingAverageCurve, type RaisingAverageOutput } from './index.ts';

/** The running means of `times`, sorted ascending: entry X − 1 is the mean of the fastest X, rounded to integer ms. */
const curveOf = (times: number[]): Ms[] => {
  const sorted = [...times].sort((a, b) => a - b);
  let sum = 0;
  return sorted.map((t, i) => {
    sum += t;
    return Math.round(sum / (i + 1));
  });
};

export const raisingAverageCalculator: QuickCalculator<RaisingAverageOutput> = {
  id: RAISING_AVERAGE,
  kind: 'quick',
  reads: ['laps', 'spans:weekend-phase'],
  cadence: 'frame',
  compute: (view): RaisingAverageOutput => {
    // the session's row (the weekend phase); without its span the grid's (C14: a pending phase reads as the race)
    const rows = behaviourFor(RAISING_AVERAGE_BEHAVIOUR, view);
    const session: RaisingAverageEffect = rows.length === 0 ? phaseRow('pending') : Object.assign({}, ...rows);
    const opts: LapClassOptions = { isRace: session.isRace === true, ...LAP_CLASSES_CONFIG.read(view) };
    const byCar = new Map<CarId, number[]>();
    for (const lap of currentLaps(view.history.laps as readonly LapRecord[])) {
      const times = byCar.get(lap.carId) ?? [];
      if (isPaceLap(lap, opts)) times.push(lap.lapTimeMs);
      byCar.set(lap.carId, times);
    }
    const cars: RaisingAverageCurve[] = [...byCar.entries()]
      .sort(([a], [b]) => a - b)
      .map(([carId, times]) => ({ carId, laps: times.length, pointsMs: curveOf(times) }));
    return { cars };
  },
};
