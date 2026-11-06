// The `weather` analysis (spec 3.3, ruling R6): the session's forecast samples with `offsetMin ≥ 0` in time order, the
// game's forecast accuracy, and the index of the first rain sample as `rain-outlook` judges it (C43: no rain threshold
// here). No first rain, or no `rain-outlook` output, is `notApplicable` (C3).
import { known, unknown } from '@pitwall/domain';
import type { QuickCalculator } from '@pitwall/engine/readers';
import { RAIN_OUTLOOK, type RainOutlook } from '../rain-outlook/index.ts';
import { WEATHER, type WeatherOutput } from './index.ts';

export const weatherCalculator: QuickCalculator<WeatherOutput> = {
  id: WEATHER,
  kind: 'quick',
  reads: ['session', { calculator: RAIN_OUTLOOK }],
  cadence: 'frame',
  compute: (view) => {
    const { forecast, forecastAccuracy } = view.live.session;
    const samples = forecast.filter((s) => s.offsetMin >= 0).sort((a, b) => a.offsetMin - b.offsetMin);
    const firstRain = (view.outputs.get(RAIN_OUTLOOK) as RainOutlook | undefined)?.firstRain;
    const firstRainIndex = firstRain?.known === true ? known(firstRain.value.index, firstRain.at) : unknown('notApplicable');
    return { samples, accuracy: forecastAccuracy, firstRainIndex };
  },
};
