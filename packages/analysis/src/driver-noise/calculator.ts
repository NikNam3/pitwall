// `driver-noise` (SP4.3a spec 5.2): per car its lap scatter, correlation, mistakes, big events, retirements and wear
// rates, AI or human by the car's car-driver span. Quick (C31); its scheduled run is its "as of" form at the current
// frame (spec 6.1).
import { asOfNow, type EngineView, type QuickCalculator } from '@pitwall/engine/readers';
import { CAR_STATUS_READS } from '../shared/car-status.ts';
import { driverNoiseAsOf } from './asof.ts';
import { DRIVER_NOISE, type DriverNoiseOutput } from './index.ts';

export const driverNoiseCalculator: QuickCalculator<DriverNoiseOutput> = {
  id: DRIVER_NOISE,
  kind: 'quick',
  // `miniSectors`: the change tag of the crossings list (the brief's `crossings`)
  // `identity`: our car (`fixed.playerCar`), whose rate a hidden rival's wear falls back to
  reads: ['laps', 'stints', 'miniSectors', 'events', 'drivers', 'identity', 'spans:car-driver', CAR_STATUS_READS, 'spans:weekend-phase', { calculator: 'degradation' }, { calculator: 'track-wetness' }],
  cadence: 'lapCompleted',
  compute: (view: EngineView): DriverNoiseOutput => driverNoiseAsOf(asOfNow(view)),
};
