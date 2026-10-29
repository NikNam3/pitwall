import { GAPS_CONFIG, gapperLines, gapsCalculator, gapsToCar, type GapperReference, type GapsOutput } from '@pitwall/analysis';
import type { CarId } from '@pitwall/domain';
import { bindState, defineFeature } from '../feature.ts';

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** `value` names a running car: an integer id among the intervals. */
const runningCar = (out: GapsOutput, value: unknown): CarId | undefined =>
  typeof value === 'number' && Number.isInteger(value) && out.intervals.some((i) => i.carId === value) ? (value as CarId) : undefined;

const carIdParam = (out: GapsOutput, params: object): CarId | undefined =>
  Object.hasOwn(params, 'carId') ? runningCar(out, (params as { carId: unknown }).carId) : undefined;

/** `params.reference` as a `GapperReference`: a known kind, a running car, a positive lap time; otherwise `undefined`. */
function referenceParam(out: GapsOutput, params: object): GapperReference | undefined {
  const reference = Object.hasOwn(params, 'reference') ? (params as { reference: unknown }).reference : undefined;
  if (!isObject(reference)) return undefined;
  switch (reference.kind) {
    case 'leaderAverage':
      return { kind: 'leaderAverage' };
    case 'carAverage': {
      const carId = runningCar(out, reference.carId);
      return carId === undefined ? undefined : { kind: 'carAverage', carId };
    }
    case 'fixed': {
      const { lapMs } = reference;
      return typeof lapMs === 'number' && Number.isFinite(lapMs) && lapMs > 0 ? { kind: 'fixed', lapMs } : undefined;
    }
    default:
      return undefined;
  }
}

/** `gaps`: every gap from the mini-sector crossings (`gaps.intervals`, `gaps.toCar`, `gaps.gapper`, `gaps.neighbourhood`). */
export default defineFeature({
  name: 'gaps',
  calculators: [gapsCalculator],
  topics: [
    bindState('gaps.intervals', gapsCalculator, (out) => out.intervals),
    bindState('gaps.toCar', gapsCalculator, (out, params) => {
      const carId = carIdParam(out, params);
      return carId === undefined ? undefined : gapsToCar(out, carId);
    }),
    bindState('gaps.gapper', gapsCalculator, (out, params) => {
      const reference = referenceParam(out, params);
      return reference === undefined ? undefined : gapperLines(out, reference);
    }),
    bindState('gaps.neighbourhood', gapsCalculator, (out) => out.neighbourhood),
  ],
  config: [GAPS_CONFIG],
});
