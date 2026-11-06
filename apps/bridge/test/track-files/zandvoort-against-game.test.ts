// The committed Zandvoort track file against what the game does on a lap (spec 3.4, C84): not a fact of the recording,
// but a check that the file's fractions mean game lap distance. Our car's steering and brake by lap distance on
// race-zandvoort-full-lap; every apex lies near a steering peak, every braking zone overlaps real braking.
import { beforeAll, describe, expect, it } from 'vitest';
import { zandvoortTrack } from '../../../../test-support/track.ts';
import { replayRunner } from '../fixtures/engine-replay.ts';
import { segmentPath } from '../fixtures/replay.ts';

const BIN_M = 10;
const PEAK_REACH_M = 50;
const PEAK_MIN = 0.05;
const APEX_TOLERANCE_M = 60;
const BRAKING = 0.1;

type Profile = { lengthM: number; steer: number[]; brake: number[] };
const profile: Profile = { lengthM: 0, steer: [], brake: [] };

/** Binned by lap distance: the largest |steer| and the highest brake our car showed in each bin. */
beforeAll(async () => {
  const samples: Array<{ at: number; steer: number; brake: number }> = [];
  let lengthM = 0;
  await replayRunner(segmentPath('race-zandvoort-full-lap.pwrec.gz'), ({ state }) => {
    const car = state.cars[state.playerCar];
    if (!car || !state.session || !car.dynamics.known) return;
    lengthM = state.session.trackLengthM;
    samples.push({ at: car.timing.lapDistanceM, steer: Math.abs(car.dynamics.value.steer), brake: car.dynamics.value.brake });
  });
  const bins = Math.ceil(lengthM / BIN_M);
  profile.lengthM = lengthM;
  profile.steer = Array.from({ length: bins }, () => 0);
  profile.brake = Array.from({ length: bins }, () => 0);
  for (const s of samples) {
    if (s.at < 0 || s.at >= lengthM) continue;
    const i = Math.floor(s.at / BIN_M);
    profile.steer[i] = Math.max(profile.steer[i]!, s.steer);
    profile.brake[i] = Math.max(profile.brake[i]!, s.brake);
  }
}, 120_000);

const circular = (a: number, b: number, length: number): number => Math.min(Math.abs(a - b), length - Math.abs(a - b));

/** Lap distances (m) of the peaks of |steer|: smoothed over three bins, above PEAK_MIN, the maximum within PEAK_REACH_M. */
const steeringPeaks = (): number[] => {
  const n = profile.steer.length;
  const smooth = profile.steer.map((_, i) => ((profile.steer[(i + n - 1) % n]! + profile.steer[i]! + profile.steer[(i + 1) % n]!) / 3));
  const reach = Math.round(PEAK_REACH_M / BIN_M);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    if (smooth[i]! <= PEAK_MIN) continue;
    let top = true;
    for (let d = -reach; d <= reach && top; d++) if (smooth[(i + d + n) % n]! > smooth[i]!) top = false;
    if (top) out.push(i * BIN_M + BIN_M / 2);
  }
  return out;
};

describe('the committed Zandvoort track file against the game', () => {
  it('puts every apex within 60 m of a steering peak of our car', () => {
    // Steering, not speed: a fast corner has no speed minimum, but every corner has a steering peak.
    const peaks = steeringPeaks();
    const turns = zandvoortTrack().turns;
    if (!turns.known) throw new Error('the Zandvoort file has no turns');
    const misses = turns.value.flatMap((t) => {
      const at = t.apex * profile.lengthM;
      const nearest = Math.min(...peaks.map((m) => circular(m, at, profile.lengthM)));
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
