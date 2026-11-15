// `lap-model` (SP4.3a spec 6.2): a simulator (C50): one car, one lap, additive, on plain inputs only; its parameters
// are built by `forecast-field`. No reads, no cadence, no topic.
import { tyreTypeOf, type LapInput, type LapModelParams, type NoiseCompound } from '@pitwall/domain';
import { defineSimulator } from '@pitwall/engine/readers';

export const SIMULATOR = defineSimulator('lap-model');

/** The domain's `tyreTypeOf`, bound once: the per-lap loops read it without a module lookup per call. */
const typeOf = tyreTypeOf;

/** The tyre term: `degMsPerLap` ms per % wear (ruling R18), plus the convex prior beyond `convexFromPct`. */
function tyreMs(p: LapModelParams, car: LapInput): number {
  const past = Math.max(0, car.wearPct - p.convexFromPct);
  return car.degMsPerLap * car.wearPct + p.convexMsPerPct2 * past * past;
}

/** The cold-tyre term on the first two laps of a set, larger on a wet track (`car.wet`, `track-wetness`'s rule, O3). */
function coldMs(p: LapModelParams, car: LapInput): number {
  const cold = car.lapOnSet === 1 ? p.coldTyreMs[0] : car.lapOnSet === 2 ? p.coldTyreMs[1] : 0;
  return car.wet ? cold * p.coldTyreWetFactor : cold;
}

/**
 * The compound and wetness term of a lap time (SP4.3c O4): the compound's offset plus its tyre type's wetness slope times
 * the wetness. `lapTimeMs` adds the same two parts, in its own summation order (so its floating sums stay as they are).
 */
export function typeTermMs(p: LapModelParams, compound: NoiseCompound, wetnessMs: number): number {
  return p.compoundOffsetMs[compound] + p.wetnessMsPerMs[typeOf(compound)] * wetnessMs;
}

/** One car's lap time (ms, floating) under `p`. */
export function lapTimeMs(p: LapModelParams, car: LapInput): number {
  const green =
    car.paceMs +
    p.compoundOffsetMs[car.compound] +
    tyreMs(p, car) +
    p.fuelMsPerKg * car.fuelKg +
    coldMs(p, car) +
    p.wetnessMsPerMs[typeOf(car.compound)] * car.wetnessMs;
  const paceFactor = car.neutralised === 'none' ? 1 : p.neutralised[car.neutralised].paceFactor;
  return green * paceFactor + car.scatterMs + car.mistakeMs;
}
