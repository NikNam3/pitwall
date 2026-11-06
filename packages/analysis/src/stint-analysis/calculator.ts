// `stint-analysis` (spec 5, 5.1, 4.1, 4.4): `stintAnalysis.car`, our cars' stints from `degradation` as the stint scatter
// draws them: every lap with its use, the fit line with its band per tyre age, and per compound the estimate pooled over
// our cars' stints on it (`pool.ts`). Quick: per frame over `degradation`, which runs on a lap, a stint or a pick.
import { carId, known, unknown, type CarId, type CompoundEstimate, type FitPoint, type Known, type SessionTime, type StintFit } from '@pitwall/domain';
import { copyPlain, type EngineView, type QuickCalculator } from '@pitwall/engine/readers';
import { DEGRADATION, type DegradationOutput, type StintDegradation } from '../degradation/index.ts';
import { ourCars } from '../shared/our-cars.ts';
import { STINT_ANALYSIS, type StintAnalysisOutput } from './index.ts';
import { poolCompound } from './pool.ts';

/**
 * The fit line of `stint`, one point per whole tyre age from its first lap's to its last lap's: `ms = α + ν · a` and
 * `sdMs = sqrt(var α + a² · var ν + 2a · cov(α, ν))` from the posterior; `insufficientData` without one.
 */
function fitLineOf(stint: StintDegradation): Known<FitPoint[]> {
  const { basePaceMs: alpha, nuMsPerLap: nu, cov } = stint;
  const first = stint.laps[0];
  const last = stint.laps.at(-1);
  if (!cov.known || !alpha.known || !nu.known || first === undefined || last === undefined) return unknown('insufficientData');
  const [[vaa, van], [, vnn]] = cov.value;
  const points = Array.from({ length: Math.max(0, last.tyreAge - first.tyreAge + 1) }, (_, i): FitPoint => {
    const a = first.tyreAge + i;
    const variance = vaa + a * a * vnn + 2 * a * van;
    return { tyreAge: a, ms: Math.round(alpha.value + nu.value * a), sdMs: Math.round(Math.sqrt(Math.max(0, variance))) };
  });
  return known(points, cov.at);
}

/** `stint` as the topic carries it: plain copies of `degradation`'s values, and the fit line. */
function stintFitOf(stint: StintDegradation): StintFit {
  return {
    stint: stint.stint,
    firstLap: stint.laps[0]?.lapNumber ?? 0,
    lastLap: stint.laps.at(-1)?.lapNumber ?? 0,
    actual: stint.actual,
    visual: stint.visual,
    basePaceMs: copyPlain(stint.basePaceMs),
    nuMsPerLap: copyPlain(stint.nuMsPerLap),
    nuSdMs: copyPlain(stint.nuSdMs),
    basis: stint.basis,
    fuelCorrected: stint.fuelCorrected,
    source: copyPlain(stint.source),
    laps: stint.laps.map((l) => ({
      lapNumber: l.lapNumber,
      tyreAge: l.tyreAge,
      lapTimeMs: l.lapTimeMs,
      correctedMs: copyPlain(l.correctedMs),
      use: copyPlain(l.use),
    })),
    fitLine: fitLineOf(stint),
  };
}

/**
 * Per actual compound, in the order our cars' stints first used it, the estimate pooled over every stint of ours on it
 * (spec 5.1), TO SOFT the prior's offset. The current prior is the newest stint's start: `degradation` fits every stint
 * from scratch over the current priors, so each starts from it.
 */
function compoundsOf(stints: readonly StintDegradation[], now: SessionTime): CompoundEstimate[] {
  const byCompound = new Map<string, { first: StintDegradation; group: StintDegradation[] }>();
  for (const s of stints) {
    const entry = byCompound.get(s.actual);
    if (entry === undefined) byCompound.set(s.actual, { first: s, group: [s] });
    else entry.group.push(s);
  }
  return [...byCompound.values()].map(({ first, group }): CompoundEstimate => {
    const prior = (group.at(-1) ?? first).startPrior;
    const pooled = poolCompound(prior, group, now);
    return {
      actual: first.actual,
      visual: first.visual,
      alphaOffsetMs: copyPlain(prior.alphaOffsetMs),
      nuMsPerLap: pooled.nuMsPerLap,
      nuSdMs: pooled.nuSdMs,
      laps: pooled.laps,
      source: copyPlain(pooled.source),
    };
  });
}

/** Our cars' stints in the order they started (the first lap), the player's first on a tie. */
function ourStints(degradation: DegradationOutput, cars: readonly CarId[]): StintDegradation[] {
  const stints = cars.flatMap((car) => degradation[car] ?? []);
  const firstLap = (s: StintDegradation): number => s.laps[0]?.lapNumber ?? Number.POSITIVE_INFINITY;
  return stints.map((s, i) => ({ s, i })).sort((a, b) => firstLap(a.s) - firstLap(b.s) || a.i - b.i).map(({ s }) => s);
}

/** Per car: our cars' stints and priors per compound; every other car `degradation` holds is `notApplicable`. */
export const stintAnalysisCalculator: QuickCalculator<StintAnalysisOutput> = {
  id: STINT_ANALYSIS,
  kind: 'quick',
  reads: [{ calculator: DEGRADATION }, 'identity'],
  cadence: 'frame',
  compute: (view: EngineView): StintAnalysisOutput => {
    const degradation = (view.outputs.get(DEGRADATION) ?? {}) as DegradationOutput;
    const now = view.live.sessionTime;
    const out: StintAnalysisOutput = {};
    for (const key of Object.keys(degradation)) out[carId(Number(key))] = unknown('notApplicable');
    const cars = ourCars(view.live) as CarId[];
    const compounds = compoundsOf(ourStints(degradation, cars), now);
    for (const car of cars) {
      const stints = degradation[car] ?? [];
      out[car] = known({ stints: stints.map(stintFitOf), compounds: copyPlain(compounds) }, now);
    }
    return out;
  },
};
