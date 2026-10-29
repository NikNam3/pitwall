import { boardFor, lapTimesCalculator, LAP_TIMES_CONFIG } from '@pitwall/analysis';
import type { CarId } from '@pitwall/domain';
import { bindState, defineFeature } from '../feature.ts';

/** The own integer property `key` of client params, or `undefined`. */
const intParam = (params: object, key: string): number | undefined => {
  if (!Object.hasOwn(params, key)) return undefined;
  const value = (params as Record<string, unknown>)[key];
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined;
};

/** `lapTimes.board` adds the deltas to `params.referenceCarId`; `lapTimes.projection` is `params.carId`'s projection. */
export default defineFeature({
  name: 'lap-times',
  calculators: [lapTimesCalculator],
  topics: [
    bindState('lapTimes.board', lapTimesCalculator, (out, params) => {
      const reference = intParam(params, 'referenceCarId');
      return reference === undefined ? undefined : boardFor(out.rows, out.sessionBest, reference as CarId);
    }),
    bindState('lapTimes.projection', lapTimesCalculator, (out, params) => {
      const id = intParam(params, 'carId');
      return id === undefined || !Object.hasOwn(out.projections, id) ? undefined : out.projections[id as CarId];
    }),
  ],
  config: [LAP_TIMES_CONFIG],
});
