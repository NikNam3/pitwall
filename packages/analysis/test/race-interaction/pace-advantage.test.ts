// `race-interaction`'s pace advantage reads `degradation`'s residuals (SP4.3c Task 13, spec §5.3 O2; C43): a held
// car's advantage is the leader's pace minus its own, each the median of the car's `fieldResiduals` (degradation's rule:
// a lap's time less the field's median lap over the laps race-interaction's filter keeps), over its free-air laps (the
// shared `freeAirLaps` with driver-noise's `freeAirGapMs`), else over all its usable laps. race-interaction computes no
// residual of its own.
import { currentLaps, type CarId, type LapRecord } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import { fieldResiduals } from '../../src/degradation/index.ts';
import { DRIVER_NOISE_CONFIG } from '../../src/driver-noise/config.ts';
import { excludedLap, followingEpisodes, RACE_INTERACTION_CONFIG } from '../../src/race-interaction/index.ts';
import { freeAirLaps } from '../../src/shared/free-air.ts';
import { median } from '../../src/shared/stats.ts';
import { projectionOf, scene, TRACK } from './scene.ts';

const CONFIG = RACE_INTERACTION_CONFIG.defaults;

/** Lap times around `base`, each lap its own offset, so a car's median residual is no single lap's. */
const varied = (base: number, offsets: readonly number[]): number[] => offsets.map((o) => base + o);

// car 1 follows car 0 0.4 s behind and is faster; car 2 runs alone 10 s back; every car's laps vary
const FOLLOW = scene([
  { car: 0, startAt: 0, lapTimes: varied(90_000, [0, 120, -60, 40, 0, -80, 30, 10, -20]) },
  { car: 1, startAt: 400, lapTimes: varied(89_900, [0, -40, 70, -10, 50, 0, -30, 20, 60]) },
  { car: 2, startAt: 10_000, lapTimes: varied(90_300, [0, 200, -150, 90, -40, 0, 60, -110, 30]) },
]);

describe("race-interaction's pace advantage is degradation's residuals (O2)", () => {
  it('each zone`s advantage is the leader`s median residual less the follower`s', () => {
    const history = projectionOf(FOLLOW);
    const episodes = followingEpisodes(history, TRACK, CONFIG);
    const zones = episodes.flatMap((e) => e.zones.map((z) => ({ ...z, follower: e.follower, leader: e.leader })));
    expect(zones.length, 'the scene holds a following episode').toBeGreaterThan(0);

    // the usable laps: those race-interaction's filter keeps
    const current = currentLaps(history.laps as readonly LapRecord[]);
    const byKey = new Map(current.map((l) => [`${l.carId}:${l.lapNumber}`, l]));
    const usable = (car: CarId, lap: number): boolean => {
      const record = byKey.get(`${car}:${lap}`);
      return record !== undefined && !excludedLap(record, { source: { history }, config: CONFIG });
    };
    const residuals = fieldResiduals(current, usable);
    const free = freeAirLaps(history, DRIVER_NOISE_CONFIG.defaults.freeAirGapMs);
    const paceOf = (car: CarId): number => {
      const own = [...(residuals.get(car) ?? new Map<number, number>())];
      const freeAir = own.filter(([lap]) => free.isFree(car, lap)).map(([, r]) => r);
      const pace = median(freeAir.length > 0 ? freeAir : own.map(([, r]) => r));
      if (pace === undefined) throw new Error(`car ${car}: no residual`);
      return pace;
    };
    for (const z of zones) {
      expect(z.advantageMs, `follower ${z.follower} behind ${z.leader}, zone ${z.zone}`).toBe(Math.round(paceOf(z.leader) - paceOf(z.follower)));
    }
  });
});
