// The run's driver profiles travel with its recording (SP4.3a Task 6; C38, C59, C62c, C75; spec 4): a live session asks
// the profile store once, at its start, for the snapshot of its slots, hands it to the scheduler as
// `SchedulerInput.drivers` (so `view.drivers`) and writes it next to the session file as `<file>.profiles.json`. It is
// fixed for the run: an edit while the session runs changes nothing until the next session start (C75). A replay reads
// the sidecar (`recordingProfiles`), so it reproduces the live stream (C38); a recording without one runs with `drivers`
// `null`, every `view.drivers` slot `notApplicable`. The store here is a fake (C84).
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { TOPICS, type ServerMessage, type TopicName } from '@pitwall/contracts';
import { known, type FeedId, type ProfileSnapshot, type SessionRef } from '@pitwall/domain';
import type { EngineView, QuickCalculator } from '@pitwall/engine';
import type { SlotIdentity } from '../../src/drivers/store.ts';
import { effectiveConfig, recordingConfig } from '../../src/feature-config.ts';
import { defineFeature, type Feature } from '../../src/features/feature.ts';
import { TopicHub } from '../../src/hub/topic-hub.ts';
import { PwrecSource } from '../../src/input/pwrec-source.ts';
import { createLogger } from '../../src/log.ts';
import { recordingDecisions } from '../../src/pipeline/decision-sidecars.ts';
import { FeedPipeline, type FeedPipelineOptions } from '../../src/pipeline/feed-pipeline.ts';
import { recordingProfiles } from '../../src/pipeline/profile-sidecar.ts';
import { StreamHash } from '../../src/pipeline/stream-hash.ts';
import { openDatabase } from '../../src/storage/db.ts';
import { recordingTrack, TRACKS_DIR } from '../../src/track-files/load.ts';
import { HookedSource } from '../helpers/hooked-source.ts';
import { segmentPath } from '../fixtures/replay.ts';

const F = 'profiles' as FeedId;
const LAP10 = segmentPath('race-zandvoort-lap10.pwrec.gz');
/** The record of LAP10 (1778 records) after which the test edits the store. */
const EDIT_AT = 800;
const log = createLogger({ level: 'silent' });
const tmp = () => mkdtempSync(join(tmpdir(), 'profiles-sidecar-'));
const profilesSidecar = (file: string): string => `${file}.profiles.json`;
const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));

/** A snapshot that links slot 0 to `anna`, told apart from another by `laps`. */
const snapshotOf = (fingerprint: string, laps: number): ProfileSnapshot => ({
  fingerprint,
  bySlot: Array.from({ length: 22 }, (_, slot) => (slot === 0 ? 'anna' : null)),
  profiles: {
    anna: {
      person: 'anna', displayName: 'Anna',
      entries: { 'fake.lapCount': { value: known(laps, 0), laps, sessions: 3, newestSession: '2026-10-03T20:00:00.000Z' } },
    },
  },
});
const FIRST = snapshotOf('fp-first', 15);
const EDITED = snapshotOf('fp-edited', 21);

/** A fake profile store: `snapshotFor` answers `current`, which the test may change (an edit in the store). */
function fakeProfiles(start: ProfileSnapshot) {
  const state = { current: start };
  const snapshotFor = vi.fn((_slots: readonly SlotIdentity[], _session: SessionRef): ProfileSnapshot => state.current);
  return { state, store: { snapshotFor } };
}

/**
 * A unit that keeps `view.drivers` of every frame; it reads `drivers` (C41, C62c) and `feed`, which changes on every
 * frame, so it runs on every frame (nothing reads it, so it always runs).
 */
function driversProbe(): { feature: Feature; seen: Array<EngineView['drivers']> } {
  const seen: Array<EngineView['drivers']> = [];
  const calc: QuickCalculator<number> = {
    kind: 'quick',
    id: 'test.drivers-probe',
    reads: ['feed', 'drivers'],
    cadence: 'frame',
    compute: (view) => {
      seen.push(structuredClone(view.drivers) as EngineView['drivers']);
      return seen.length;
    },
  };
  return { feature: defineFeature({ name: 'drivers-probe', calculators: [calc], topics: [] }), seen };
}

/** The params of the one subscription per feed topic (no feature here has a `select`). */
const HASH_PARAMS = { carId: 0, referenceCarId: 0, reference: { kind: 'leaderAverage' } };

type Run = { seen: Array<EngineView['drivers']>; hash: string; file: string | undefined };

/**
 * Runs `path` through a pipeline of the probe, with one client subscribed to every feed topic once, the hub's clock on
 * the record times and a tick after every record; the client's messages are hashed (`StreamHash`). `record`: a live run
 * with a recordings dir (and a database), so it writes a session file with its sidecars; `after(index)` runs after each
 * record. `extra` adds options (the fake store, a replay's sidecars).
 */
async function run(path: string, o: { record?: boolean; after?: (index: number) => void; extra?: Partial<FeedPipelineOptions> } = {}): Promise<Run> {
  const probe = driversProbe();
  let nowMs = 0;
  const hub = new TopicHub({ now: () => nowMs });
  const hash = new StreamHash(new Set());
  hub.addClient('hash', {
    send: (message: ServerMessage) => {
      const topic = 'id' in message ? (message.id as TopicName | undefined) : undefined;
      if (topic === undefined) throw new Error(`a message of no subscription: ${JSON.stringify(message)}`);
      hash.add(topic, message);
    },
    bufferedAmount: () => 0,
  });
  for (const topic of Object.keys(TOPICS) as TopicName[]) {
    if (TOPICS[topic].scope === 'feed') hub.subscribe({ clientId: 'hash', id: topic, topic, params: HASH_PARAMS, feedId: F });
  }
  const dir = o.record === true ? tmp() : undefined;
  const source = new HookedSource(new PwrecSource({ feedId: F, path, mode: 'asFastAsPossible' }), {
    before: (packet) => {
      nowMs = packet.receivedAtMs;
    },
    after: (index) => {
      hub.tick();
      o.after?.(index);
    },
  });
  const pipeline = new FeedPipeline({
    feedId: F, source, hub, features: [probe.feature], log,
    ...(dir !== undefined && { storage: { db: openDatabase(join(tmp(), 'live.db')), rulesVersion: 'unversioned', recordingsDir: dir } }),
    ...o.extra,
  });
  pipeline.start();
  await pipeline.done;
  hub.tick();
  const files = dir === undefined ? [] : readdirSync(dir).filter((name) => name.endsWith('.pwrec.gz'));
  if (dir !== undefined) expect(files).toHaveLength(1);
  return { seen: probe.seen, hash: hash.digest(), file: dir === undefined ? undefined : join(dir, files[0]!) };
}

/** The options of a pipeline built from the recording `file`, as a replay builds them: every sidecar applies. */
const replayOf = (file: string): Partial<FeedPipelineOptions> => ({
  config: recordingConfig(file, [], effectiveConfig([])),
  tracks: (trackId) => recordingTrack(file, trackId, TRACKS_DIR, log),
  recorded: recordingDecisions(file, log),
  recordedProfiles: recordingProfiles(file, log),
});

const notApplicable = (drivers: EngineView['drivers']): boolean => drivers.length > 0 && drivers.every((d) => !d.known && d.reason === 'notApplicable');

describe('the profiles sidecar', { timeout: 120_000 }, () => {
  it('session start writes the profiles sidecar; a replay with it equals the live run (C38)', async () => {
    const profiles = fakeProfiles(FIRST);
    const live = await run(LAP10, { record: true, extra: { profiles: profiles.store } });

    // Asked once, at the session's start, with the session's slots as Participants names them.
    expect(profiles.store.snapshotFor).toHaveBeenCalledOnce();
    const [slots, session] = profiles.store.snapshotFor.mock.calls[0]!;
    expect(slots.length).toBeGreaterThan(0);
    for (const slot of slots) {
      expect(slot).toEqual({ carId: expect.any(Number), teamId: expect.any(Number), raceNumber: expect.any(Number), name: slot.name === null ? null : expect.any(String) });
    }
    expect(session).toEqual({ sessionUid: expect.any(String), weekendId: expect.any(String), feedCar: expect.any(Number) });
    // Its snapshot is the run's, and goes next to the session file.
    expect(readJson(profilesSidecar(live.file!))).toEqual(FIRST);
    expect(live.seen.length).toBeGreaterThan(0);
    expect(live.seen.at(-1)?.[0]).toEqual(known(FIRST.profiles['anna'], 0));
    expect(live.seen.at(-1)?.[1]).toMatchObject({ known: false, reason: 'notApplicable' });

    // The replay of the session file reads the sidecar: the same view.drivers on every frame, the same stream.
    expect(recordingProfiles(live.file!, log)).toEqual(FIRST);
    const replay = await run(live.file!, { extra: replayOf(live.file!) });
    expect(replay.seen).toEqual(live.seen);
    expect(replay.hash).toBe(live.hash);
  });

  it('a recording without a profiles sidecar runs with drivers null', async () => {
    const recording = join(tmp(), 'no-sidecar.pwrec.gz');
    copyFileSync(LAP10, recording);
    expect(recordingProfiles(recording, log)).toBeNull();
    const replay = await run(recording, { extra: replayOf(recording) });
    expect(replay.seen.length).toBeGreaterThan(0);
    expect(replay.seen.every(notApplicable)).toBe(true);

    // A sidecar that is no snapshot is treated as absent.
    const broken = join(tmp(), 'broken.pwrec.gz');
    copyFileSync(LAP10, broken);
    writeFileSync(profilesSidecar(broken), '{"fingerprint": 7}\n');
    expect(recordingProfiles(broken, log)).toBeNull();
    // A live run without a profile store has none either.
    const bare = await run(LAP10);
    expect(bare.seen.every(notApplicable)).toBe(true);
  });

  it('an edit during a session changes nothing until the next session start (C75)', async () => {
    const profiles = fakeProfiles(FIRST);
    const live = await run(LAP10, {
      record: true,
      extra: { profiles: profiles.store },
      // The user links, excludes or overrides while the session runs: the store would now answer another snapshot.
      after: (index) => {
        if (index === EDIT_AT) profiles.state.current = EDITED;
      },
    });
    expect(profiles.store.snapshotFor).toHaveBeenCalledOnce();
    const atStart = known(FIRST.profiles['anna'], 0);
    // From the frame the run has its snapshot on (its slots known), slot 0 is the snapshot's to the end.
    const from = live.seen.findIndex((drivers) => drivers[0]?.known === true);
    expect(from).toBeGreaterThanOrEqual(0);
    expect(live.seen.length - from).toBeGreaterThan(EDIT_AT / 10);
    expect(live.seen.slice(from).every((drivers) => JSON.stringify(drivers[0]) === JSON.stringify(atStart))).toBe(true);
    expect(readJson(profilesSidecar(live.file!))).toEqual(FIRST);

    // The next session starts on the edited snapshot.
    const next = await run(LAP10, { record: true, extra: { profiles: profiles.store } });
    expect(readJson(profilesSidecar(next.file!))).toEqual(EDITED);
    expect(next.seen.at(-1)?.[0]).toEqual(known(EDITED.profiles['anna'], 0));
  });
});
