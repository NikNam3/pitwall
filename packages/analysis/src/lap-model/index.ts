// `lap-model` (SP4.3a spec 6.2): a simulator (C50): one car, one lap, additive, on plain inputs only; its parameters
// are built by `forecast-field`. No reads, no cadence, no topic.
import type { LapInput, LapModelParams, NoiseCompound, TyreType } from '@pitwall/domain';
import { defineSimulator } from '@pitwall/engine/readers';

export const SIMULATOR = defineSimulator('lap-model');

const TYRE_TYPE: Record<NoiseCompound, TyreType> = { soft: 'slick', medium: 'slick', hard: 'slick', inter: 'inter', wet: 'wet' };

/** The tyre term: `degMsPerLap` ms per % wear (ruling R18), plus the convex prior beyond `convexFromPct`. */
function tyreMs(p: LapModelParams, car: LapInput): number {
  const past = Math.max(0, car.wearPct - p.convexFromPct);
  return car.degMsPerLap * car.wearPct + p.convexMsPerPct2 * past * past;
}

/** The cold-tyre term on the first two laps of a set, larger on a wet track. */
function coldMs(p: LapModelParams, car: LapInput): number {
  const cold = car.lapOnSet === 1 ? p.coldTyreMs[0] : car.lapOnSet === 2 ? p.coldTyreMs[1] : 0;
  return car.wetnessMs > 0 ? cold * p.coldTyreWetFactor : cold;
}

/** One car's lap time (ms, floating) under `p`. */
export function lapTimeMs(p: LapModelParams, car: LapInput): number {
  const green =
    car.paceMs +
    p.compoundOffsetMs[car.compound] +
    tyreMs(p, car) +
    p.fuelMsPerKg * car.fuelKg +
    coldMs(p, car) +
    p.wetnessMsPerMs[TYRE_TYPE[car.compound]] * car.wetnessMs;
  const paceFactor = car.neutralised === 'none' ? 1 : p.neutralised[car.neutralised].paceFactor;
  return green * paceFactor + car.scatterMs + car.mistakeMs;
}
