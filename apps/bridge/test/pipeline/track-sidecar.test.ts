// The session's track file travels with its recording (C59, C62b, spec 4): a live session loads the committed file of
// its track id, hands it to the units as `view.track` (its data, without the provenance, C35) and writes the whole file
// next to the session file as `<file>.track.json`; a replay uses that sidecar, so it reproduces the live stream (C38)
// whatever the committed files say by then. A session without a valid file writes a not-applicable sidecar, so a file
// committed for its track later does not change its replay (C62b, pre-4.1 spec 1).
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { trackDataOf, unknown, type FeedId, type TrackFile } from '@pitwall/domain';
import type { EngineView, QuickCalculator } from '@pitwall/engine';
import { zandvoortTrack, zandvoortTrackFile } from '../../../../test-support/track.ts';
import { sessionConfigPath } from '../../src/feature-config.ts';
import { defineFeature, type Feature } from '../../src/features/feature.ts';
import talkWindow from '../../src/features/talk-window/register.ts';
import { TopicHub } from '../../src/hub/topic-hub.ts';
import { PwrecSource } from '../../src/input/pwrec-source.ts';
import { createLogger } from '../../src/log.ts';
import { FeedPipeline, type FeedPipelineOptions } from '../../src/pipeline/feed-pipeline.ts';
import { topicStreamHash } from '../../src/pipeline/stream-hash.ts';
import { openDatabase } from '../../src/storage/db.ts';
import { loadTrackFile, recordingTrack } from '../../src/track-files/load.ts';
import { segmentPath } from '../fixtures/replay.ts';

const F = 'test' as FeedId;
const ZANDVOORT = 26;
const FULL_LAP = segmentPath('race-zandvoort-full-lap.pwrec.gz');
const LAP10 = segmentPath('race-zandvoort-lap10.pwrec.gz');
const log = createLogger({ level: 'silent' });
const tmp = () => mkdtempSync(join(tmpdir(), 'track-sidecar-'));
const trackSidecar = (file: string): string => `${file}.track.json`;
const writeJson = (path: string, value: unknown): void => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);

/** A unit that keeps every `view.track` it is given; it raises nothing, but runs on every frame (nothing reads it). */
function trackProbe(): { feature: Feature; seen: Array<EngineView['track']> } {
  const seen: Array<EngineView['track']> = [];
  const calc: QuickCalculator<number> = {
    kind: 'quick',
    id: 'test.track-probe',
    reads: ['timing'],
    cadence: 'frame',
    compute: (view) => {
      seen.push(view.track);
      return seen.length;
    },
  };
  return { feature: defineFeature({ name: 'track-probe', calculators: [calc], topics: [] }), seen };
}

/** Runs `source` through a pipeline of `features`; `extra` adds options (a live run's storage, a replay's `tracks`). */
async function run(path: string, features: Feature[], extra: Partial<FeedPipelineOptions> = {}): Promise<void> {
  const hub = new TopicHub({ now: () => 0 });
  const pipeline = new FeedPipeline({ feedId: F, source: new PwrecSource({ feedId: F, path, mode: 'asFastAsPossible' }), hub, features, log, ...extra });
  pipeline.start();
  await pipeline.done;
}

/**
 * A live run over `path`: the track files of `tracksDir` (default: the committed ones), one session file per session
 * in a fresh recordings dir.
 */
async function liveRun(path: string, features: Feature[], tracksDir?: string): Promise<{ file: string; dir: string }> {
  const dir = tmp();
  const tracks = tracksDir === undefined ? {} : { tracks: (id: number) => loadTrackFile(id, tracksDir, log) };
  await run(path, features, { storage: { rulesVersion: 'unversioned', db: openDatabase(join(tmp(), 'live.db')), recordingsDir: dir }, ...tracks });
  const files = readdirSync(dir).filter((name) => name.endsWith('.pwrec.gz'));
  expect(files).toHaveLength(1);
  return { file: join(dir, files[0]!), dir };
}

/** A Zandvoort file told apart from the committed one by its name. */
const zandvoortNamed = (name: string): TrackFile => ({ ...zandvoortTrackFile(), name });

describe('a live session and its track file', () => {
  const probe = trackProbe();
  let live: { file: string };
  beforeAll(async () => {
    live = await liveRun(FULL_LAP, [probe.feature]);
  }, 60_000);

  it('a live run over race-zandvoort-full-lap with a recordings dir writes <file>.track.json equal to the committed Zandvoort file', () => {
    expect(JSON.parse(readFileSync(trackSidecar(live.file), 'utf8'))).toEqual(zandvoortTrackFile());
  });

  it('a unit reading view.track sees TrackData without source', () => {
    expect(probe.seen.length).toBeGreaterThan(0);
    for (const track of [probe.seen[0], probe.seen.at(-1)]) {
      expect(track).toEqual({ known: true, value: zandvoortTrack(), at: 0 });
      expect(track?.known === true && track.value).not.toHaveProperty('source');
    }
  });
});

describe('a live session on a track without a committed file', () => {
  // talk-window reads the braking zones of view.track, so its topic tells a known track from a notApplicable one
  const features = [talkWindow];
  let live: { file: string };
  beforeAll(async () => {
    // a tracks dir without a Zandvoort file: the session's track is notApplicable
    live = await liveRun(FULL_LAP, [trackProbe().feature, ...features], tmp());
  }, 60_000);

  it('a live session on a track without a committed file writes a not-applicable sidecar', () => {
    expect(existsSync(trackSidecar(live.file))).toBe(true);
    expect(JSON.parse(readFileSync(trackSidecar(live.file), 'utf8'))).toEqual({ known: false, reason: 'notApplicable' });
  });

  it('a replay with a not-applicable sidecar stays notApplicable after a committed file appears (C38)', async () => {
    // the committed files now hold a valid Zandvoort file
    const committed = tmp();
    writeJson(join(committed, `${ZANDVOORT}.json`), zandvoortTrackFile());
    const probe = trackProbe();
    await run(live.file, [probe.feature], { tracks: (id) => recordingTrack(live.file, id, committed, log) });
    expect(probe.seen.length).toBeGreaterThan(0);
    for (const track of [probe.seen[0], probe.seen.at(-1)]) expect(track).toEqual(unknown('notApplicable'));

    // the live run's stream: the segment as it came in, on a notApplicable track (a sidecar that fails validation is
    // notApplicable, whatever the committed files hold)
    const asLive = join(tmp(), 'as-live.pwrec.gz');
    copyFileSync(FULL_LAP, asLive);
    writeJson(trackSidecar(asLive), { ...zandvoortTrackFile(), name: 42 });
    const liveHash = await topicStreamHash(asLive, { features });
    // the stream follows the track: with the committed Zandvoort file it is another one
    expect(await topicStreamHash(FULL_LAP, { features })).not.toBe(liveHash);
    // the replay of the session file the live run wrote, with the committed Zandvoort file there by now
    expect(await topicStreamHash(live.file, { features })).toBe(liveHash);
  }, 120_000);
});

describe('a replay and the sidecar', () => {
  it('a replay of a segment with a sidecar and a different committed file gives the sidecar\'s data (C38)', async () => {
    const recording = join(tmp(), 'replay.pwrec.gz');
    copyFileSync(LAP10, recording);
    const sidecar = zandvoortNamed('from the sidecar');
    writeJson(trackSidecar(recording), sidecar);
    const committed = tmp();
    writeJson(join(committed, `${ZANDVOORT}.json`), zandvoortNamed('committed'));
    const probe = trackProbe();
    // as every pipeline built from a recording does: its track comes from the recording (spec 4)
    await run(recording, [probe.feature], { tracks: (id) => recordingTrack(recording, id, committed, log) });
    expect(probe.seen.length).toBeGreaterThan(0);
    expect(probe.seen.at(-1)).toEqual({ known: true, value: trackDataOf(sidecar), at: 0 });
  });

  it('the stream hash (topicStreamHash) of the live run equals the replay\'s with its sidecar', async () => {
    // talk-window reads the braking zones of view.track, so its topic follows the track file
    const features = [talkWindow];
    const live = await liveRun(LAP10, features);
    // the live run's stream: the segment as it came in, with the committed file the live run loaded
    const liveHash = await topicStreamHash(LAP10, { features });
    // the replay of the session file the live run wrote, with its sidecars
    expect(await topicStreamHash(live.file, { features })).toBe(liveHash);
    // and the replay follows its sidecar: the same session file with other braking zones in it gives another stream
    const other = join(tmp(), 'other.pwrec.gz');
    copyFileSync(live.file, other);
    copyFileSync(sessionConfigPath(live.file), sessionConfigPath(other));
    writeJson(trackSidecar(other), { ...zandvoortTrackFile(), brakingZones: unknown('notApplicable') });
    expect(await topicStreamHash(other, { features })).not.toBe(liveHash);
  });
});
