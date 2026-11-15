// `rain-outlook` (spec 3.3; SP4.3c O3a): the one reading of the forecast (C43): "rain is coming" (one threshold,
// `rainPct`), the samples ahead and the highest chance per remaining lap. Read by `weather`, `race-moment` and
// `strategy`'s candidate rule. A calculator: no topic.
import type { ForecastSample, Known, Percent } from '@pitwall/domain';

export * from './config.ts';

/** The calculator id. */
export const RAIN_OUTLOOK = 'rain-outlook';

/**
 * The first forecast sample at or above `rainPct` (index into `samplesAhead`), whether it is within `horizonMin`, and
 * the samples ahead: those with `offsetMin ≥ 0` in time order.
 */
export type RainOutlook = { firstRain: Known<{ index: number; offsetMin: number; rainPct: Percent }>; withinHorizon: boolean; samplesAhead: ForecastSample[] };

/** A forecast read per race lap: per lap its rain chance (0–100). */
export type ChanceByLap = readonly { lap: number; rainPct: number }[];

/** The forecast's samples ahead (`offsetMin ≥ 0`), in time order. */
export const samplesAheadOf = (forecast: readonly ForecastSample[]): ForecastSample[] => forecast.filter((s) => s.offsetMin >= 0).sort((a, b) => a.offsetMin - b.offsetMin);

/**
 * The highest chance per remaining lap: per lap from `fromLap` on (in lap order), the highest rain chance of the
 * forecast on any lap from `fromLap` up to it.
 */
export function maxChanceByLap(byLap: ChanceByLap, fromLap: number): { lap: number; rainPct: number }[] {
  const out: { lap: number; rainPct: number }[] = [];
  let max = -Infinity;
  for (const l of [...byLap].filter((e) => e.lap >= fromLap).sort((a, b) => a.lap - b.lap)) {
    max = Math.max(max, l.rainPct);
    out.push({ lap: l.lap, rainPct: max });
  }
  return out;
}

/** Whether rain is coming from `fromLap` up to `toLap`: the forecast's highest chance on those laps at `rainPct` or above. */
export function rainComing(byLap: ChanceByLap, fromLap: number, toLap: number, rainPct: number): boolean {
  const upTo = maxChanceByLap(byLap, fromLap).filter((l) => l.lap <= toLap).at(-1);
  return upTo !== undefined && upTo.rainPct >= rainPct;
}
