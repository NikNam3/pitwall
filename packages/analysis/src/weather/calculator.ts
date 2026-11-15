// The `weather` analysis (spec 3.3, ruling R6; SP4.3c O3a): `rain-outlook`'s samples ahead (the forecast with
// `offsetMin ≥ 0` in time order; `rain-outlook` reads the forecast, C43), the game's forecast accuracy, and the index of
// the first rain sample as `rain-outlook` judges it (no rain threshold here). No first rain, or no `rain-outlook`
// output, is `notApplicable` (C3).
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
    const { forecastAccuracy } = view.live.session;
    const outlook = view.outputs.get(RAIN_OUTLOOK) as RainOutlook | undefined;
    const firstRain = outlook?.firstRain;
    const firstRainIndex = firstRain?.known === true ? known(firstRain.value.index, firstRain.at) : unknown('notApplicable');
    return { samples: outlook?.samplesAhead ?? [], accuracy: forecastAccuracy, firstRainIndex };
  },
};
