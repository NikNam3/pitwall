// `driver-noise`'s driver-profile entries (contract C62c; SP4.3a spec 4, 5.2): each an aggregate weighted by laps over
// the person's linked sessions' human-span laps, each session's values from `runAsOf([degradation, track-wetness,
// driver-noise], asOfStored(session, ctx))` (plan review P2).
import type { NoiseCompound } from '@pitwall/domain';
import { defineProfiles, type ProfileEntryDecl } from '@pitwall/engine/readers';

/** A stub entry: its aggregate is the implement phase's. */
const entry = (range: readonly [number, number]): ProfileEntryDecl => ({
  version: 1,
  range,
  aggregate: () => {
    throw new Error('not implemented');
  },
});

const COMPOUNDS: readonly NoiseCompound[] = ['soft', 'medium', 'hard', 'inter', 'wet'];

export const DRIVER_NOISE_PROFILES = defineProfiles('driver-noise', {
  entries: {
    'driverNoise.sigmaMs': entry([0, 10_000]),
    'driverNoise.rho': entry([-1, 1]),
    'driverNoise.mistakeRate': entry([0, 1]),
    'driverNoise.mistakeMedianMs': entry([0, 60_000]),
    'driverNoise.mistakeSigmaLog': entry([0, 5]),
    ...Object.fromEntries(COMPOUNDS.map((c) => [`driverNoise.wearRatePct.${c}`, entry([0, 100])])),
  },
});
