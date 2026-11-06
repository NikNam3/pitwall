// The committed Zandvoort track file against what the game does on a lap (spec 3.4, C84): not a fact of the recording,
// but a check that the file's fractions mean game lap distance. Our car's speed and brake by lap distance on
// race-zandvoort-full-lap; every apex lies near a local speed minimum, every braking zone overlaps real braking.
import { beforeAll, describe, expect, it } from 'vitest';
import { zandvoortTrack } from '../../../../test-support/track.ts';
import { replayRunner } from '../fixtures/engine-replay.ts';
import { segmentPath } from '../fixtures/replay.ts';

const BIN_M = 10;
const MINIMUM_WINDOW_M = 40;
const APEX_TOLERANCE_M = 60;
const BRAKING = 0.1;

type Profile = { lengthM: number; speed: number[]; brake: number[] };
const profile: Profile = { lengthM: 0, speed: [], brake: [] };

/** Binned by lap distance: the lowest speed and the highest brake our car showed in each bin. */
beforeAll(async () => {
  const samples: Array<{ at: number; kmh: number; brake: number }> = [];
  let lengthM = 0;
  await replayRunner(segmentPath('race-zandvoort-full-lap.pwrec.gz'), ({ state }) => {
    const car = state.cars[state.playerCar];
    if (!car || !state.session || !car.dynamics.known) return;
    lengthM = state.session.trackLengthM;
    samples.push({ at: car.timing.lapDistanceM, kmh: car.dynamics.value.speedKmh, brake: car.dynamics.value.brake });
  });
  const bins = Math.ceil(lengthM / BIN_M);
  profile.lengthM = lengthM;
  profile.speed = Array.from({ length: bins }, () => Infinity);
  profile.brake = Array.from({ length: bins }, () => 0);
  for (const s of samples) {
    if (s.at < 0 || s.at >= lengthM) continue;
    const i = Math.floor(s.at / BIN_M);
    profile.speed[i] = Math.min(profile.speed[i]!, s.kmh);
    profile.brake[i] = Math.max(profile.brake[i]!, s.brake);
  }
}, 120_000);

const circular = (a: number, b: number, length: number): number => Math.min(Math.abs(a - b), length - Math.abs(a - b));

/** Distances (m) of the lap at which the speed is lowest within `MINIMUM_WINDOW_M` on both sides. */
const localMinima = (): number[] => {
  const n = profile.speed.length;
  const reach = Math.round(MINIMUM_WINDOW_M / BIN_M);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const v = profile.speed[i]!;
    if (!Number.isFinite(v)) continue;
    let lowest = true;
    for (let d = -reach; d <= reach && lowest; d++) {
      const w = profile.speed[(i + d + n) % n]!;
      if (w < v) lowest = false;
    }
    if (lowest) out.push(i * BIN_M + BIN_M / 2);
  }
  return out;
};

describe('the committed Zandvoort track file against the game', () => {
  it('has a lap profile that covers the lap', () => {
    const covered = profile.speed.filter(Number.isFinite).length / profile.speed.length;
    expect(covered).toBeGreaterThan(0.95);
  });

  it('puts every apex within 60 m of a local minimum of our car speed', () => {
    const minima = localMinima();
    const turns = zandvoortTrack().turns;
    if (!turns.known) throw new Error('the Zandvoort file has no turns');
    const misses = turns.value.flatMap((t) => {
      const at = t.apex * profile.lengthM;
      const nearest = Math.min(...minima.map((m) => circular(m, at, profile.lengthM)));
      return nearest <= APEX_TOLERANCE_M ? [] : [`${t.label}: ${nearest.toFixed(0)} m`];
    });
    expect(misses).toEqual([]);
  });

  it('puts every braking zone over a stretch where our car braked', () => {
    const zones = zandvoortTrack().brakingZones;
    if (!zones.known) throw new Error('the Zandvoort file has no braking zones');
    const n = profile.brake.length;
    const misses = zones.value.flatMap((z, k) => {
      const from = Math.floor((z.start * profile.lengthM) / BIN_M);
      const to = Math.floor((z.end * profile.lengthM) / BIN_M);
      const span = (to - from + n) % n;
      const braked = Array.from({ length: span + 1 }, (_, d) => profile.brake[(from + d) % n]!).some((b) => b > BRAKING);
      return braked ? [] : [`zone ${k}`];
    });
    expect(misses).toEqual([]);
  });
});
