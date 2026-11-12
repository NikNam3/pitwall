// The 1-state Kalman filter of `track-wetness` (SP4.3a spec 5.1, research 12 §3): the state is the track's wetness, how
// much slower than its dry reference the field runs (ms); it moves as a random walk from lap to lap. The measurement of
// a lap is the field's common mode; a lap without one only predicts. The weather enters only the prediction step (its
// process noise), never a measurement.

/** The filter's noises (`TRACK_WETNESS_CONFIG`). */
export type WetnessFilterConfig = { processNoiseMs: number; measurementNoiseMs: number; initialSdMs: number; forecastRainNoiseFactor: number };

/** The posterior after the newest lap: mean and sd (ms); `undefined` before any measurement. */
export type WetnessState = { wetnessMs: number; sdMs: number } | undefined;

/**
 * Runs the filter over one measurement per lap, oldest first (`undefined`: the lap has none). It starts at 0 (a dry
 * track) with `initialSdMs`; each lap first adds the process noise, then updates on its measurement. `rainPct` (the
 * forecast's rain chance now, when known) widens the newest lap's prediction step only: more rain coming, the track may
 * move further (× `1 + forecastRainNoiseFactor · rainPct / 100` on its variance). Without any measurement it has no state.
 */
export function runWetnessFilter(measurements: readonly (number | undefined)[], config: WetnessFilterConfig, rainPct?: number): WetnessState {
  const q = config.processNoiseMs * config.processNoiseMs;
  const r = config.measurementNoiseMs * config.measurementNoiseMs;
  let x = 0;
  let p = config.initialSdMs * config.initialSdMs;
  let measured = false;
  for (let i = 0; i < measurements.length; i++) {
    const newest = i === measurements.length - 1;
    p += newest && rainPct !== undefined ? q * (1 + (config.forecastRainNoiseFactor * rainPct) / 100) : q;
    const z = measurements[i];
    if (z === undefined) continue;
    const k = p / (p + r);
    x += k * (z - x);
    p *= 1 - k;
    measured = true;
  }
  return measured ? { wetnessMs: x, sdMs: Math.sqrt(p) } : undefined;
}
