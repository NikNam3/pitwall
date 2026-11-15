// A car's pace against the field (SP4.3c Task 13, spec §5.3 O2; C43): `degradation` owns a car's pace, this one rule
// included. A lap's residual is its time less the field's median lap of that lap number, so the race's fuel and tyre
// trend cancel; `race-interaction`'s pace advantage reads it.
import type { CarId, LapRecord } from '@pitwall/domain';
import type { DeepReadonly } from '@pitwall/engine/readers';
import { median } from '../shared/stats.ts';

/** Per car, per lap number, the lap's residual (ms). */
export type FieldResiduals = Map<CarId, Map<number, number>>;

/**
 * Per car and lap number, the residual of each lap `usable` keeps: its lap time less the median lap time of that lap
 * number over the laps `usable` keeps. `laps` are current records (C25), one per car and lap number.
 */
export function fieldResiduals(laps: readonly DeepReadonly<LapRecord>[], usable: (car: CarId, lap: number) => boolean): FieldResiduals {
  const kept = laps.filter((l) => usable(l.carId, l.lapNumber));
  const timesByLap = new Map<number, number[]>();
  for (const l of kept) {
    const list = timesByLap.get(l.lapNumber);
    if (list === undefined) timesByLap.set(l.lapNumber, [l.lapTimeMs]);
    else list.push(l.lapTimeMs);
  }
  const fieldMedian = new Map<number, number>();
  for (const [lap, times] of timesByLap) {
    const m = median(times);
    if (m !== undefined) fieldMedian.set(lap, m);
  }
  const out: FieldResiduals = new Map();
  for (const l of kept) {
    const own = out.get(l.carId) ?? new Map<number, number>();
    out.set(l.carId, own);
    own.set(l.lapNumber, l.lapTimeMs - (fieldMedian.get(l.lapNumber) as number));
  }
  return out;
}
