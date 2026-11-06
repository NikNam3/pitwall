// The `rain-outlook` calculator (spec 3.3): the first forecast sample with `offsetMin ≥ 0` and a rain chance of at least
// `rainPct`, and whether it lies within `horizonMin`. `index` is into the samples with `offsetMin ≥ 0` in time order.
// No such sample is `notApplicable` (C3).
import { known, unknown } from '@pitwall/domain';
import type { QuickCalculator } from '@pitwall/engine/readers';
import { RAIN_OUTLOOK, RAIN_OUTLOOK_CONFIG, type RainOutlook } from './index.ts';

export const rainOutlookCalculator: QuickCalculator<RainOutlook> = {
  id: RAIN_OUTLOOK,
  kind: 'quick',
  reads: ['session'],
  cadence: 'frame',
  compute: (view) => {
    const { rainPct, horizonMin } = RAIN_OUTLOOK_CONFIG.read(view);
    const { forecast, updatedAt } = view.live.session;
    const ahead = forecast.filter((s) => s.offsetMin >= 0).sort((a, b) => a.offsetMin - b.offsetMin);
    const index = ahead.findIndex((s) => s.rainPct >= rainPct);
    const first = ahead[index];
    if (first === undefined) return { firstRain: unknown('notApplicable'), withinHorizon: false };
    return {
      firstRain: known({ index, offsetMin: first.offsetMin, rainPct: first.rainPct }, updatedAt),
      withinHorizon: first.offsetMin <= horizonMin,
    };
  },
};
