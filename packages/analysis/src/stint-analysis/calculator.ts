// `stint-analysis` (spec 5, 4.1, 4.4): `stintAnalysis.car`, our cars' stints from `degradation` as the stint scatter
// draws them: every lap with its use, the fit line with its band per tyre age, and per compound the prior the first stint
// on it started from. It maps `degradation`'s output and judges nothing of its own (C43). Quick: per frame over
// `degradation`, which runs on a lap, a stint or a pick.
import { carId, known, unknown, type CarId, type CompoundEstimate, type FitPoint, type Known, type SessionTime, type StintFit } from '@pitwall/domain';
import { copyPlain, type EngineView, type QuickCalculator } from '@pitwall/engine/readers';
import { DEGRADATION, type DegradationOutput, type StintDegradation } from '../degradation/index.ts';
import { ourCars } from '../shared/our-cars.ts';
import { STINT_ANALYSIS, type StintAnalysisOutput } from './index.ts';

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

/** Per compound (actual and visual), in the order the stints first used it, the prior its first stint started from. */
function compoundsOf(stints: readonly StintDegradation[], now: SessionTime): CompoundEstimate[] {
  const seen = new Set<string>();
  const out: CompoundEstimate[] = [];
  for (const s of stints) {
    const key = `${s.actual}/${s.visual}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const p = s.startPrior;
    out.push({
      actual: s.actual,
      visual: s.visual,
      alphaOffsetMs: copyPlain(p.alphaOffsetMs),
      nuMsPerLap: known(p.nuMsPerLap, now),
      nuSdMs: known(p.nuSdMs, now),
      source: copyPlain(p.source),
    });
  }
  return out;
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
    for (const car of ourCars(view.live) as CarId[]) {
      const stints = degradation[car] ?? [];
      out[car] = known({ stints: stints.map(stintFitOf), compounds: compoundsOf(stints, now) }, now);
    }
    return out;
  },
};
