// `driver-noise`'s driver-profile entries (contract C62c; SP4.3a spec 4, 5.2): each an aggregate weighted by laps over
// the person's linked sessions' human-span laps, each session's values from `runAsOf([degradation, track-wetness,
// driver-noise], asOfStored(session, ctx))` (plan review P2): the linked car's entry with its human model's values,
// weighted by the laps it rests on. A wear rate enters only where the car's own wear was measured on the compound.
import { known, unknown, type CarNoise, type Known, type NoiseCompound } from '@pitwall/domain';
import { asOfStored, defineProfiles, runAsOf, type AsOfUnit, type AsOfView, type ProfileCtx, type ProfileEntryDecl, type StoredDriverSession } from '@pitwall/engine/readers';
import { degradationAsOf, degradationCalculator } from '../degradation/calculator.ts';
import { trackWetnessAsOf } from '../track-wetness/asof.ts';
import { trackWetnessCalculator } from '../track-wetness/calculator.ts';
import { humanNoiseAsOf, PROFILE_KEYS } from './asof.ts';
import type { CarModels } from './residuals.ts';

/** The upstream units of one stored session's run (P2): `driver-noise`'s own form runs on their outputs. */
const UPSTREAM: readonly AsOfUnit[] = [
  { id: degradationCalculator.id, reads: degradationCalculator.reads, asOf: degradationAsOf },
  { id: trackWetnessCalculator.id, reads: trackWetnessCalculator.reads, asOf: trackWetnessAsOf },
];

type SessionNoise = { noise: CarNoise; ownWear: CarModels['ownWear'] } | undefined;

/** The linked car's human entry in one stored session, with its own wear rates. */
function sessionNoiseOf(session: StoredDriverSession, ctx: ProfileCtx): SessionNoise {
  const base: AsOfView = asOfStored(session, ctx);
  return humanNoiseAsOf({ ...base, outputs: runAsOf(UPSTREAM, base) }, session.carId);
}

/** One session's value of an entry and the laps it is weighted by. */
type Weighted = { value: number; laps: number; at: number } | undefined;

/** An entry from one value per session: the laps-weighted mean, resting on the laps of the sessions that have one. */
function aggregateOf(pick: (own: NonNullable<SessionNoise>) => Weighted, range: readonly [number, number]): ProfileEntryDecl {
  return {
    version: 1,
    range,
    aggregate(sessions, ctx): { value: Known<number>; laps: number } {
      let sum = 0;
      let laps = 0;
      let at = 0;
      for (const session of sessions) {
        const own = sessionNoiseOf(session, ctx);
        const w = own === undefined ? undefined : pick(own);
        if (w === undefined || w.laps <= 0) continue;
        sum += w.value * w.laps;
        laps += w.laps;
        at = Math.max(at, w.at);
      }
      return laps === 0 ? { value: unknown('insufficientData'), laps: 0 } : { value: known(sum / laps, at), laps };
    },
  };
}

/** A value of the session's entry, weighted by the entry's laps (the free-air laps its σ, ρ and mistakes rest on). */
const modelEntry = (value: (n: CarNoise) => Known<number>, range: readonly [number, number]): ProfileEntryDecl =>
  aggregateOf(({ noise }) => {
    const v = value(noise);
    return v.known ? { value: v.value, laps: noise.laps, at: v.at } : undefined;
  }, range);

/** A compound's wear rate weighted by the car's laps on it, in sessions where its own wear was measured. */
const wearEntry = (compound: NoiseCompound): ProfileEntryDecl =>
  aggregateOf(({ ownWear }) => {
    const own = ownWear[compound];
    return own === undefined ? undefined : { value: own.ratePct, laps: own.laps, at: own.at };
  }, [0, 100]);

const COMPOUNDS: readonly NoiseCompound[] = ['soft', 'medium', 'hard', 'inter', 'wet'];

const sizeOf = (pick: (s: { medianMs: number; sigmaLog: number }) => number) => (n: CarNoise): Known<number> =>
  n.mistakeSize.known ? known(pick(n.mistakeSize.value), n.mistakeSize.at) : n.mistakeSize;

export const DRIVER_NOISE_PROFILES = defineProfiles('driver-noise', {
  entries: {
    [PROFILE_KEYS.sigmaMs]: modelEntry((n) => n.sigmaMs, [0, 10_000]),
    [PROFILE_KEYS.rho]: modelEntry((n) => n.rho, [-1, 1]),
    [PROFILE_KEYS.mistakeRate]: modelEntry((n) => n.mistakeRatePerLap, [0, 1]),
    [PROFILE_KEYS.mistakeMedianMs]: modelEntry(sizeOf((s) => s.medianMs), [0, 60_000]),
    [PROFILE_KEYS.mistakeSigmaLog]: modelEntry(sizeOf((s) => s.sigmaLog), [0, 5]),
    ...Object.fromEntries(COMPOUNDS.map((c) => [PROFILE_KEYS.wearRatePct(c), wearEntry(c)])),
  },
});
