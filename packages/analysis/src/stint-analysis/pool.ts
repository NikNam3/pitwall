// `stint-analysis`'s pooled estimate per compound (spec 5.1): `degradation`'s `ν` over our cars' stints on one compound,
// in information form on `ν`'s marginal over the compound's current prior; the source by 4.4's half rule. Pure.
import { known, type EstimateSource, type Known, type LapUse, type SessionTime } from '@pitwall/domain';

/** The compound's current prior of `ν`, with its source. */
export type PoolPrior = { nuMsPerLap: number; nuSdMs: number; source: EstimateSource };

/** One stint on the compound as `degradation` gives it: its posterior of `ν`, the prior it started from, its laps' uses. */
export type PoolStint = {
  nuMsPerLap: Known<number>;
  nuSdMs: Known<number>;
  startPrior: { nuMsPerLap: number; nuSdMs: number };
  laps: readonly { use: LapUse }[];
};

/** The pooled estimate: `ν` and its sd, the laps the stints' filters read, the source. */
export type Pooled = { nuMsPerLap: Known<number>; nuSdMs: Known<number>; laps: number; source: EstimateSource };

/** The name a prior's source goes by in `parts`: a calibration's set name, else the source's own parts. */
const priorName = (source: EstimateSource): string => (source.kind === 'calibration' ? source.setName : source.parts);

/** The laps a stint's filter read: `used` and `downWeighted`. */
const readLaps = (stint: PoolStint): number => stint.laps.filter((l) => l.use === 'used' || l.use === 'downWeighted').length;

/** `source`'s kind and fields with the session's share `share` and `parts`, or `session` when the share is above half (4.4). */
function sourceOf(source: EstimateSource, share: number, laps: number): EstimateSource {
  const parts = `${laps} ${laps === 1 ? 'lap' : 'laps'} + ${priorName(source)}`;
  if (share > 0.5) return { kind: 'session', sessionShare: share, parts };
  return { ...source, sessionShare: share, parts };
}

/**
 * Spec 5.1: each stint `s` adds its data information `Iₛ = max(0, 1/σₛ² − 1/σ₀ₛ²)` and `Jₛ = μₛ/σₛ² − ν₀ₛ/σ₀ₛ²` (0 when
 * `Iₛ` is 0) to the prior's `(1/σ₀², ν₀/σ₀²)`; `ν = J / P`, sd `√(1/P)`, the session's share `Σ Iₛ / P`. A stint whose
 * `ν` is unknown adds nothing, its laps included. With no stint the prior as it is, `laps` 0. Known at `at`.
 */
export function poolCompound(prior: PoolPrior, stints: readonly PoolStint[], at: SessionTime): Pooled {
  const priorPrecision = 1 / prior.nuSdMs ** 2;
  let information = 0;
  let weighted = prior.nuMsPerLap * priorPrecision;
  let laps = 0;
  let pooledAny = false;
  for (const s of stints) {
    if (!s.nuMsPerLap.known || !s.nuSdMs.known) continue;
    pooledAny = true;
    laps += readLaps(s);
    const precision = 1 / s.nuSdMs.value ** 2;
    const startPrecision = 1 / s.startPrior.nuSdMs ** 2;
    const info = Math.max(0, precision - startPrecision);
    if (info === 0 || !Number.isFinite(info)) continue;
    information += info;
    weighted += s.nuMsPerLap.value * precision - s.startPrior.nuMsPerLap * startPrecision;
  }
  const total = priorPrecision + information;
  const share = information / total;
  return {
    nuMsPerLap: known(weighted / total, at),
    nuSdMs: known(Math.sqrt(1 / total), at),
    laps,
    source: pooledAny ? sourceOf(prior.source, share, laps) : prior.source,
  };
}
