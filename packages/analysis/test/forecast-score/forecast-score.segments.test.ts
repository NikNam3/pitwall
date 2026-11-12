// `forecast-score` on real data (contract C84, SP4.3a spec 9, plan Task 19 row 11, ruling R15): the engine runs each
// segment of Task 22 frame by frame (`SessionTracker`, `SessionRunner`) and the test reads its final projection.
// Behaviour only, never the recording's values (C84):
//  - race-rejoin holds a green stop from its box release to 1.6 s into the out lap, not the in lap (R15): the stop is
//    recorded, green, no penalty, no repair, so a rejoin candidate, and the race order at its pit exit is measured,
//    holding every car once; the full rejoin case is on builder races (`experiments.test.ts`, `job.test.ts`);
//  - race-pass-braking-zone holds one pass into a braking zone: `race-interaction`'s following episodes over it hold
//    exactly one episode with a pass.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { feedId, type CarId, type TrackData, type TrackFile } from '@pitwall/domain';
import { SessionRunner, SessionTracker, type DeepReadonly, type Projection, type StepResult } from '@pitwall/engine';
import { beforeAll, describe, expect, it } from 'vitest';
import { segmentPackets } from '../../../../test-support/segments.ts';
import { orderAtPitExit } from '../../src/forecast-score/experiments.ts';
import { RACE_INTERACTION_CONFIG } from '../../src/race-interaction/config.ts';
import { CONFIG } from './support.ts';

const REJOIN = 'race-rejoin.pwrec.gz';
const PASS = 'race-pass-braking-zone.pwrec.gz';

/** `race-interaction`'s episodes (plan Task 12), as declared: written apart, so read by name from its index. */
type FollowingEpisode = { follower: CarId; leader: CarId; zones: { zone: number; advantageMs: number; drs: boolean; wet: boolean; passed: boolean }[] };
type FollowingEpisodes = (history: Projection, track: DeepReadonly<TrackData>, config: typeof RACE_INTERACTION_CONFIG.defaults) => FollowingEpisode[];

/** The committed track file of `trackId` (`data/tracks/`, C62b) as `view.track` holds it: without its provenance. */
function trackOf(trackId: number): DeepReadonly<TrackData> {
  const { source: _source, ...data } = JSON.parse(readFileSync(join(import.meta.dirname, `../../../../data/tracks/${trackId}.json`), 'utf8')) as TrackFile;
  return data;
}

/** The segment's final projection (its append frames included) and its track id. */
async function runSegment(file: string): Promise<{ history: Projection; trackId: number }> {
  const tracker = new SessionTracker({ feedId: feedId(file) });
  const events = (await segmentPackets(file)).flatMap(({ packet, receivedAtMs }) => tracker.push(packet, receivedAtMs));
  const frames = [...events, ...tracker.end()].flatMap((e) => (e.type === 'frame' ? [e.frame] : []));
  const first = frames.find((f) => f.session !== undefined);
  if (first?.session === undefined) throw new Error(`${file}: no frame carried a session`);
  const runner = new SessionRunner({ feedId: feedId(file), sessionUid: first.sessionUid, session: first.session });
  let last: { history: Projection; trackId: number } | undefined;
  const onResult = ({ state }: StepResult): void => {
    last = { history: state.history, trackId: state.session.trackId };
  };
  for (const f of frames.slice(frames.indexOf(first))) runner.apply(f, onResult);
  runner.end(onResult);
  if (last === undefined) throw new Error(`${file}: the runner gave no state`);
  // The runner changes its state in place: a copy of what the test reads.
  return structuredClone(last);
}

let rejoin: { history: Projection; trackId: number };
let pass: { history: Projection; trackId: number };

describe('forecast-score on real data', () => {
  beforeAll(async () => {
    rejoin = await runSegment(REJOIN);
    pass = await runSegment(PASS);
  }, 120_000);

  it('segment race-rejoin gives one rejoin case; race-pass-braking-zone one following episode with a pass', async () => {
    // race-rejoin: the green stop and the order measured at its pit exit (R15).
    const candidates = rejoin.history.pitStops.filter((s) => s.flag === 'green' && !s.penaltyServed && s.stationaryTimeMs <= CONFIG.repairStationaryMs);
    expect(candidates.length).toBeGreaterThan(0);
    for (const stop of candidates) {
      const order = orderAtPitExit(rejoin.history, stop);
      expect(order.known, `car ${stop.carId}`).toBe(true);
      if (!order.known) continue;
      expect(order.value.filter((c) => c === stop.carId), `car ${stop.carId}`).toHaveLength(1);
      expect(new Set(order.value).size).toBe(order.value.length);
    }

    // race-pass-braking-zone: one following episode with a pass.
    const { followingEpisodes } = (await import('../../src/race-interaction/index.ts')) as unknown as { followingEpisodes: FollowingEpisodes };
    const episodes = followingEpisodes(pass.history, trackOf(pass.trackId), RACE_INTERACTION_CONFIG.defaults);
    expect(episodes.filter((e) => e.zones.some((z) => z.passed))).toHaveLength(1);
  });
});
