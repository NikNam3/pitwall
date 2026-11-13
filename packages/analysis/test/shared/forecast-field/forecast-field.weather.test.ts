// `forecast-field`'s forecast on laps (SP4.3b Task 19c, spec §7.1, S12; contract C3): research 19's wetness spike found
// the forecast mapped onto laps by one sample (the one in force at a lap's middle), which on the game's 5/15/30-minute
// grid puts even a perfect forecast's changes 1.7–3 laps late. A lap now takes the rain chance interpolated linearly
// between the two forecast samples around its midpoint, the midpoint's time ahead from the leader's lap time (from the
// leader's place on its lap now); a midpoint past the last sample takes the last sample's.
//
// Row (brief Task 19c, row 5): a perfect forecast that goes from dry at its 5-minute sample to rain at its 10-minute one
// maps onto laps by linear interpolation: each lap's rain chance is the interpolation at its midpoint, so the change
// (its 50 % point, 7.5 minutes ahead) falls on the lap whose midpoint passes it, not on the lap that reaches 10 minutes.
import type { ForecastSample, LapRecord } from '@pitwall/domain';
import { asOfNow, type AsOfView } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { buildStartingPoint } from '../../../src/shared/forecast-field/index.ts';
import { generated, materialised, PARAMS, plainNoise, upstreamOf } from './support.ts';

const g = generated();

/** A perfect forecast on the game's grid: `rainPct` per offset in minutes. */
const forecast = (byOffset: [number, number][]): ForecastSample[] =>
  byOffset.map(([offsetMin, rainPct]) => ({ offsetMin, weather: rainPct >= 25 ? 'lightRain' : 'overcast', trackTempC: 30, trackTempTrend: 'flat', airTempC: 22, airTempTrend: 'flat', rainPct }));

/** Dry now and at 5 minutes, raining from the 10-minute sample on. */
const SAMPLES: [number, number][] = [
  [0, 0],
  [5, 0],
  [10, 100],
  [15, 100],
  [30, 100],
];

/** The rain chance linearly between the samples around `min` (the first before any, the last after all). */
function interpolated(min: number): number {
  const first = SAMPLES[0]!;
  if (min <= first[0]) return first[1];
  for (let i = 1; i < SAMPLES.length; i++) {
    const [t1, r1] = SAMPLES[i]!;
    const [t0, r0] = SAMPLES[i - 1]!;
    if (min <= t1) return r0 + ((min - t0) / (t1 - t0)) * (r1 - r0);
  }
  return SAMPLES[SAMPLES.length - 1]![1];
}

describe("forecast-field's forecast on laps (Task 19c)", () => {
  it("forecast-field: a perfect forecast's rain change at a sample boundary maps onto the lap whose midpoint passes it (linear interpolation), not up to 3 laps late", () => {
    // mid-lap, so the leader's place on its lap counts
    const frames = g.race.framesOfLap(6);
    const base = materialised(asOfNow(g.viewAt(frames[frames.length >> 1]!)));
    const view: AsOfView = { ...base, fixed: { ...base.fixed, weatherNow: { weather: 'overcast', forecast: forecast(SAMPLES), forecastAccuracy: 'perfect' } } };
    const sp = buildStartingPoint(view, upstreamOf(view, plainNoise(PARAMS.cars, [6, 7], view.at)));
    if (!sp.known) throw new Error(`starting point unknown: ${sp.reason}`);
    if (!sp.value.weather.known) throw new Error(`weather unknown: ${sp.value.weather.reason}`);
    const { byLap } = sp.value.weather.value;

    // the leader's newest lap time and its place on its lap: the minutes ahead of each lap's midpoint
    const leader = sp.value.order[0]!;
    const leaderLaps = (view.history.laps as readonly LapRecord[]).filter((l) => l.carId === leader);
    const leaderLapMs = leaderLaps.reduce((a, b) => (b.lapNumber >= a.lapNumber ? b : a)).lapTimeMs;
    const fraction = sp.value.lapFraction[leader]!;
    expect(fraction).toBeGreaterThan(0.1);
    const midMin = (lap: number): number => ((lap - sp.value.lap + 0.5 - fraction) * leaderLapMs) / 60_000;

    expect(byLap[0]!.lap).toBe(sp.value.lap);
    for (const { lap, rainPct } of byLap) {
      expect(Math.abs(rainPct - interpolated(midMin(lap))), `lap ${lap} (midpoint ${midMin(lap).toFixed(2)} min)`).toBeLessThanOrEqual(1);
    }
    // the change: the first lap at 50 % or more is the one whose midpoint passes 7.5 minutes
    const first = byLap.find((l) => l.rainPct >= 50)!;
    expect(midMin(first.lap)).toBeGreaterThanOrEqual(7.5);
    expect(midMin(first.lap - 1)).toBeLessThan(7.5);
  });
});
