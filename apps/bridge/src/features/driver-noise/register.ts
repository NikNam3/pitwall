import { DRIVER_NOISE_CONFIG, DRIVER_NOISE_PROFILES, driverNoiseCalculator } from '@pitwall/analysis';
import { defineFeature } from '../feature.ts';

/**
 * `driver-noise` (SP4.3a spec 5.2): per car its lap scatter, correlation, mistakes, big events, retirements and wear
 * rates, AI or human by the car's car-driver span; a calculator the forecast reads (no topic). Its driver-profile
 * entries (C62c) the bridge's profile store runs over each person's linked sessions.
 */
export default defineFeature({
  name: 'driver-noise',
  calculators: [driverNoiseCalculator],
  topics: [],
  config: [DRIVER_NOISE_CONFIG],
  profiles: [DRIVER_NOISE_PROFILES],
});
