// The `weather` analysis (spec 3.3). Stub: Task 7 implements it.
import type { QuickCalculator } from '@pitwall/engine/readers';
import { RAIN_OUTLOOK } from '../rain-outlook/index.ts';
import { WEATHER, type WeatherOutput } from './index.ts';

export const weatherCalculator: QuickCalculator<WeatherOutput> = {
  id: WEATHER,
  kind: 'quick',
  reads: ['session', { calculator: RAIN_OUTLOOK }],
  cadence: 'frame',
  compute: () => {
    throw new Error('not implemented');
  },
};
