// The bands of `car-bands` and the lap they judge, shared with `alarms`, which judges the last completed lap's aggregates against them.
import type { BandState, CarId, LapRecord, VisualCompound } from '@pitwall/domain';
import type { DeepReadonly } from '@pitwall/engine';
import type { CAR_BANDS_CONFIG } from './config.ts';

/** One band, in the channel's unit (°C or psi). */
export type Band = { lo: number; hi: number };
/** The band of every channel kind for one tyre kind. */
export type Bands = { surface: Band; carcass: Band; pressure: Band; brakes: Band; engine: Band };

/** The bands of a tyre kind: inter and wet have their own, every other compound is dry. */
export const bandsFor = (compound: VisualCompound, c: ReturnType<typeof CAR_BANDS_CONFIG.read>): Bands => {
  const tyre =
    compound === 'inter'
      ? { surface: { lo: c.surfaceInterLo, hi: c.surfaceInterHi }, carcass: { lo: c.carcassInterLo, hi: c.carcassInterHi } }
      : compound === 'wet'
        ? { surface: { lo: c.surfaceWetLo, hi: c.surfaceWetHi }, carcass: { lo: c.carcassWetLo, hi: c.carcassWetHi } }
        : { surface: { lo: c.surfaceDryLo, hi: c.surfaceDryHi }, carcass: { lo: c.carcassDryLo, hi: c.carcassDryHi } };
  return {
    ...tyre,
    pressure: { lo: c.pressureLo, hi: c.pressureHi },
    brakes: { lo: c.brakeLo, hi: c.brakeHi },
    engine: { lo: 0, hi: c.engineHi },
  };
};

/** Where a value is against a band. */
export const stateOf = (value: number, { lo, hi }: Band): BandState => (value < lo ? 'below' : value > hi ? 'above' : 'in');

/** Each car's last completed lap: its highest-numbered record (the provisional and confirmed records of a lap share their ranges). */
export const lastLaps = (laps: readonly DeepReadonly<LapRecord>[]): Map<CarId, DeepReadonly<LapRecord>> => {
  const last = new Map<CarId, DeepReadonly<LapRecord>>();
  for (const lap of laps) {
    const seen = last.get(lap.carId);
    if (seen === undefined || lap.lapNumber > seen.lapNumber) last.set(lap.carId, lap);
  }
  return last;
};
