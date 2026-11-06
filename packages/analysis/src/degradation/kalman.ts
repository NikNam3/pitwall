// The 2-state Kalman filter of `degradation` (spec 4.1, Cappello & Hoegh): state tyre pace `α` (ms at tyre age 0) and
// degradation `ν` (ms per lap of age); observation a pace lap's corrected time `α + ν · age` plus noise. `α` starts
// diffuse: the first lap sets it, so a stint's base pace is its own and `ν` starts from the prior alone.
import { known, unknown, type Known } from '@pitwall/domain';
import type { DEGRADATION_CONFIG } from './config.ts';

/** The filter's thresholds and noises (`DEGRADATION_CONFIG`). */
export type FilterConfig = Pick<
  (typeof DEGRADATION_CONFIG)['defaults'],
  'obsSdMs' | 'processAlphaSdMs' | 'processNuSdMs' | 'outlierSd' | 'outlierNoiseFactor'
>;

/** One pace lap as the filter reads it: its tyre age at the start and its (corrected) time in ms. */
export type FilterLap = { lapNumber: number; tyreAge: number; ms: number };

/** What `ν` starts from: the calibration's or the config default's mean and sd, ms per lap. */
export type FilterPrior = { nuMsPerLap: number; nuSdMs: number };

/** How the filter used a lap: at full weight, or down-weighted as a slow outlier. */
export type FilterUse = 'used' | 'downWeighted';

/** The posterior after every lap: means, covariance `[[α α, α ν], [ν α, ν ν]]`, and per lap its use, in the laps' order. */
export type FilterState = {
  /** `undefined` before the first lap: `α` is diffuse. */
  alphaMs: number | undefined;
  nuMsPerLap: number;
  cov: [[number, number], [number, number]];
  uses: FilterUse[];
};

/**
 * Runs the filter over `laps` (oldest first). The first lap sets `α` exactly (diffuse prior); each further lap first
 * adds the process noise per lap of tyre age since the last, then updates. A lap slower than the prediction by more
 * than `outlierSd` sd of the innovation is down-weighted (its noise variance × `outlierNoiseFactor`); a faster lap
 * never is.
 */
export function runFilter(laps: readonly FilterLap[], prior: FilterPrior, config: FilterConfig): FilterState {
  const r = config.obsSdMs * config.obsSdMs;
  const qa = config.processAlphaSdMs * config.processAlphaSdMs;
  const qn = config.processNuSdMs * config.processNuSdMs;
  let alpha: number | undefined;
  let nu = prior.nuMsPerLap;
  let paa = 0;
  let pan = 0;
  let pnn = prior.nuSdMs * prior.nuSdMs;
  let lastAge = 0;
  const uses: FilterUse[] = [];
  for (const lap of laps) {
    const age = lap.tyreAge;
    if (alpha === undefined) {
      alpha = lap.ms - nu * age;
      paa = r + pnn * age * age;
      pan = -pnn * age;
      lastAge = age;
      uses.push('used');
      continue;
    }
    const steps = Math.abs(age - lastAge);
    lastAge = age;
    paa += qa * steps;
    pnn += qn * steps;
    const innovation = lap.ms - (alpha + nu * age);
    const hph = paa + 2 * pan * age + pnn * age * age;
    const down = innovation > config.outlierSd * Math.sqrt(hph + r);
    const s = hph + (down ? r * config.outlierNoiseFactor : r);
    const ka = (paa + pan * age) / s;
    const kn = (pan + pnn * age) / s;
    alpha += ka * innovation;
    nu += kn * innovation;
    paa -= ka * ka * s;
    pan -= ka * kn * s;
    pnn -= kn * kn * s;
    uses.push(down ? 'downWeighted' : 'used');
  }
  return { alphaMs: alpha, nuMsPerLap: nu, cov: [[paa, pan], [pan, pnn]], uses };
}

/** A stint's fit: the filter's posterior mean and covariance and how it used each lap. */
export type StintFitResult = { alphaMs: number; nuMsPerLap: number; cov: [[number, number], [number, number]]; laps: { lapNumber: number; use: FilterUse }[] };

/**
 * The filter over a stint's pace laps (`runFilter`), for the priors aggregate and the strategy (spec 4.1):
 * `insufficientData` below two laps, where `ν` is the prior's alone.
 */
export function fitStint(laps: readonly FilterLap[], prior: FilterPrior, config: FilterConfig): Known<StintFitResult> {
  if (laps.length < 2) return unknown('insufficientData');
  const state = runFilter(laps, prior, config);
  if (state.alphaMs === undefined) return unknown('insufficientData');
  // one use per lap, in the laps' order
  const uses = laps.map((lap, i) => ({ lapNumber: lap.lapNumber, use: state.uses[i] as FilterUse }));
  return known({ alphaMs: state.alphaMs, nuMsPerLap: state.nuMsPerLap, cov: state.cov, laps: uses }, 0);
}
