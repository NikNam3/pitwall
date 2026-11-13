// The lap model's parameters (SP4.3a spec 6.2, plan review P9, C50): built here, by `forecast-field`, from the as-of
// view and the units' outputs; `lap-model` takes them as plain inputs.
import type { LapModelParams, NoiseCompound } from '@pitwall/domain';
import type { AsOfView, CalculatorId, DeepReadonly } from '@pitwall/engine/readers';
import { DEGRADATION, DEGRADATION_CONFIG, type DegradationOutput } from '../../degradation/index.ts';
import { FORECAST_FIELD_CONFIG } from './config.ts';

/** The dry compounds whose offsets are fitted against medium (medium is 0). */
const FITTED = ['soft', 'hard'] as const satisfies readonly NoiseCompound[];
type Fitted = (typeof FITTED)[number];

const configOf = <C extends object>(section: { key: string; defaults: C }, view: Pick<AsOfView, 'config'>): C =>
  ({ ...section.defaults, ...view.config[section.key] }) as C;

/** The prior of the fitted offsets against medium: the track file's (relative to its medium), else the config's. */
export function priorOffsets(view: Pick<AsOfView, 'track' | 'config'>): Record<Fitted, number> {
  const track = view.track;
  if (track.known && track.value.defaults.compoundOffsetsMs.known) {
    const { soft, medium, hard } = track.value.defaults.compoundOffsetsMs.value.value;
    return { soft: soft - medium, hard: hard - medium };
  }
  const c = configOf(FORECAST_FIELD_CONFIG, view);
  return { soft: c.defaultSoftOffsetMs, hard: c.defaultHardOffsetMs };
}

/**
 * The fresh-set offsets of soft and hard against medium (spec 6.2): every stint's `α` is the car's own pace plus its
 * compound's offset, weighted by `α`'s posterior variance (`cov[0][0]`; a stint without one is left out). With each
 * car's pace profiled out, the offsets are the Gaussian posterior under the prior (the track file's offsets, sd
 * `compoundOffsetPriorSdMs`): a compound no car ran against another keeps the prior.
 */
function fittedOffsets(degradation: DeepReadonly<DegradationOutput>, prior: Record<Fitted, number>, priorSdMs: number): Record<Fitted, number> {
  const n = FITTED.length;
  const precision = 1 / (priorSdMs * priorSdMs);
  // the normal equations A·o = b over the fitted offsets
  const a = FITTED.map((_, i) => FITTED.map((__, j) => (i === j ? precision : 0)));
  const b = FITTED.map((c) => prior[c] * precision);
  for (const stints of Object.values(degradation)) {
    // per car: Σw, Σw·e, Σw·α, Σw·e·eᵀ, Σw·e·α, with e the compound's indicator over the fitted offsets
    let w = 0;
    let wAlpha = 0;
    const we = new Array<number>(n).fill(0);
    const weAlpha = new Array<number>(n).fill(0);
    for (const s of stints) {
      if (!s.basePaceMs.known || !s.cov.known) continue;
      const variance = s.cov.value[0][0];
      if (!(variance > 0) || !(s.visual === 'medium' || (FITTED as readonly string[]).includes(s.visual))) continue;
      const wi = 1 / variance;
      const alpha = s.basePaceMs.value;
      w += wi;
      wAlpha += wi * alpha;
      const k = (FITTED as readonly string[]).indexOf(s.visual);
      if (k >= 0) {
        we[k] = (we[k] as number) + wi;
        weAlpha[k] = (weAlpha[k] as number) + wi * alpha;
      }
    }
    if (w === 0) continue;
    // the car's pace profiled out: its Schur complement (e is an indicator, so Σw·e·eᵀ is diagonal)
    for (let i = 0; i < n; i++) {
      const row = a[i] as number[];
      row[i] = (row[i] as number) + (we[i] as number);
      for (let j = 0; j < n; j++) row[j] = (row[j] as number) - ((we[i] as number) * (we[j] as number)) / w;
      b[i] = (b[i] as number) + (weAlpha[i] as number) - ((we[i] as number) * wAlpha) / w;
    }
  }
  const o = solve(a, b);
  return { soft: o[0] as number, hard: o[1] as number };
}

/** Solves the small symmetric positive-definite system `a·x = b` (Gaussian elimination; `a` has the prior on its diagonal). */
function solve(a: number[][], b: number[]): number[] {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i] as number]);
  for (let col = 0; col < n; col++) {
    const pivot = m[col] as number[];
    for (let r = col + 1; r < n; r++) {
      const row = m[r] as number[];
      const f = (row[col] as number) / (pivot[col] as number);
      for (let c = col; c <= n; c++) row[c] = (row[c] as number) - f * (pivot[c] as number);
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    const row = m[r] as number[];
    let sum = row[n] as number;
    for (let c = r + 1; c < n; c++) sum -= (row[c] as number) * (x[c] as number);
    x[r] = sum / (row[r] as number);
  }
  return x;
}

/**
 * The compound offsets fitted from `degradation`'s α per compound with the track file's offsets as a weak prior (a
 * compound without a stint takes the track file's); fuel at `degradation`'s γ (30 ms/kg), so the lap model adds what
 * the pace was corrected by; the cold-tyre terms of lap 1 and 2 and their wet factor; the neutralised factors; the
 * wetness terms.
 */
export function lapModelParams(view: AsOfView, outputs: ReadonlyMap<CalculatorId, unknown>): LapModelParams {
  const c = configOf(FORECAST_FIELD_CONFIG, view);
  const degradation = (outputs.get(DEGRADATION) as DeepReadonly<DegradationOutput> | undefined) ?? {};
  const offsets = fittedOffsets(degradation, priorOffsets(view), c.compoundOffsetPriorSdMs);
  return {
    compoundOffsetMs: { soft: offsets.soft, medium: 0, hard: offsets.hard, inter: c.interOffsetMs, wet: c.wetOffsetMs },
    fuelMsPerKg: configOf(DEGRADATION_CONFIG, view).gammaMsPerKg,
    convexFromPct: c.convexFromPct,
    convexMsPerPct2: c.convexMsPerPct2,
    convexFlagged: true,
    coldTyreMs: [c.coldTyreLap1Ms, c.coldTyreLap2Ms],
    coldTyreWetFactor: c.coldTyreWetFactor,
    neutralised: {
      sc: { paceFactor: c.scPaceFactor, wearFactor: c.scWearFactor, fuelFactor: c.scFuelFactor },
      vsc: { paceFactor: c.vscPaceFactor, wearFactor: c.vscWearFactor, fuelFactor: c.vscFuelFactor },
    },
    wetnessMsPerMs: { slick: c.slickMsPerWetnessMs, inter: c.interMsPerWetnessMs, wet: c.wetMsPerWetnessMs },
  };
}
