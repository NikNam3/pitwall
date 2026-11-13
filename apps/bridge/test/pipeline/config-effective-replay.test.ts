// `config.effective` of a replay equals its live run's (review F1; C38, C47, C54): a live run publishes per key the
// fields `config.json` set; a replay or reprocess of the session file it wrote reads its config from the config sidecar
// (`<file>.config.json`) and must publish the same value, `overridden` included, whatever the data dir's `config.json`
// says by then. A sidecar written before the overridden fields were recorded gives `overridden` empty (C3: nothing
// fabricated). Temporary data dirs only (C84); only test-only features declare config here.
import { copyFileSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { FeedId } from '@pitwall/domain';
import { defineConfig } from '@pitwall/engine';
import { ScenarioBuilder, packetBytes } from '../../../../packages/engine/test/builders/index.ts';
import { RECORDING_FEED, recordingPipeline } from '../../src/cli/process-recording.ts';
import { defineFeature, type Feature } from '../../src/features/feature.ts';
import { loadFeatureConfig, recordingConfig, sessionConfigPath, type FeatureConfig } from '../../src/feature-config.ts';
import { TopicHub } from '../../src/hub/topic-hub.ts';
import { PwrecSource } from '../../src/input/pwrec-source.ts';
import { createLogger } from '../../src/log.ts';
import { FeedPipeline } from '../../src/pipeline/feed-pipeline.ts';
import { openDatabase } from '../../src/storage/db.ts';
import { ArraySource, type PreparedPacket } from '../helpers/array-source.ts';

/** The value of `config.effective` (its topic file, `packages/contracts/src/topics/config.effective.ts`). */
type ConfigEffectiveValue = { values: Record<string, Record<string, number | string | boolean>>; overridden: Record<string, string[]> };

const F = 'effective' as FeedId;
const log = createLogger({ level: 'silent' });
const tmp = () => mkdtempSync(join(tmpdir(), 'config-effective-replay-'));

const threshold = defineConfig('test.threshold', { limit: 1_000_000, label: 'cars' });
const other = defineConfig('test.other', { enabled: false });
const features: Feature[] = [defineFeature({ name: 'watcher', calculators: [], topics: [], config: [threshold, other] })];

const packets = (): PreparedPacket[] =>
  new ScenarioBuilder({ sessionUid: 91n, cars: 2 }).session().participants().frames(10, () => {}).packets()
    .map(({ packet, receivedAtMs }) => ({ bytes: packetBytes(packet), receivedAtMs }));

/** A hub that keeps every `config.effective` value `feed` publishes. */
function recordingHub(feed: FeedId): { hub: TopicHub; values: ConfigEffectiveValue[] } {
  const hub = new TopicHub({ now: () => 0 });
  const values: ConfigEffectiveValue[] = [];
  const publish = hub.publishState.bind(hub);
  hub.publishState = ((feedId, topic, value) => {
    if (feedId === feed && topic === 'config.effective') values.push((value as (params: object) => ConfigEffectiveValue)({}));
    return publish(feedId, topic, value);
  }) as TopicHub['publishState'];
  return { hub, values };
}

/** The data dir of a later replay: its `config.json` sets other fields than the live run's did. */
function laterDataDir(): string {
  const root = tmp();
  writeFileSync(join(root, 'config.json'), JSON.stringify({ 'test.other': { enabled: true } }));
  return root;
}

/** As `pitwall replay` runs a recording: its config is the recording's (`recordingConfig`), served as live. */
async function replay(file: string): Promise<ConfigEffectiveValue[]> {
  const { hub, values } = recordingHub(F);
  const config = recordingConfig(file, features, loadFeatureConfig(laterDataDir(), features), log);
  const pipeline = new FeedPipeline({ feedId: F, source: new PwrecSource({ feedId: F, path: file, mode: 'asFastAsPossible' }), hub, features, config, log });
  pipeline.start();
  await pipeline.done;
  return values;
}

/** As `pitwall reprocess` runs a recording (`recordingPipeline`, C38). */
async function reprocess(file: string): Promise<ConfigEffectiveValue[]> {
  const { hub, values } = recordingHub(RECORDING_FEED);
  const config: FeatureConfig = recordingConfig(file, features, loadFeatureConfig(laterDataDir(), features), log);
  const pipeline = recordingPipeline({ path: file, hub, log, config, features });
  pipeline.start();
  await pipeline.done;
  return values;
}

describe('config.effective of a replay equals its live run', () => {
  let live: ConfigEffectiveValue[];
  let file: string;
  beforeAll(async () => {
    const root = tmp();
    writeFileSync(join(root, 'config.json'), JSON.stringify({ 'test.threshold': { limit: 5 } }));
    const { hub, values } = recordingHub(F);
    const dir = tmp();
    const pipeline = new FeedPipeline({
      feedId: F, source: new ArraySource(F, packets()), hub, features, config: loadFeatureConfig(root, features), log,
      storage: { rulesVersion: 'unversioned', db: openDatabase(join(tmp(), 'live.db')), recordingsDir: dir },
    });
    pipeline.start();
    await pipeline.done;
    live = values;
    const files = readdirSync(dir).filter((name) => name.endsWith('.pwrec.gz'));
    expect(files).toHaveLength(1);
    file = join(dir, files[0]!);
    // the live run published the override
    expect(live).toHaveLength(1);
    expect(live[0]?.overridden['test.threshold']).toEqual(['limit']);
  }, 60_000);

  it('a replay of a recording made with a config.json override publishes the same config.effective as its live run, overridden included', async () => {
    const replayed = await replay(file);
    expect(replayed).toHaveLength(1);
    expect(replayed[0]).toEqual(live[0]);
  });

  it('reprocess of that recording publishes the same config.effective as its live run', async () => {
    const reprocessed = await reprocess(file);
    expect(reprocessed).toHaveLength(1);
    expect(reprocessed[0]).toEqual(live[0]);
  });

  it('a config sidecar without overridden fields (older recordings) gives overridden empty for every key, never a throw', async () => {
    // an older recording: the session file with a sidecar that holds the effective config only
    const older = join(tmp(), 'older.pwrec.gz');
    copyFileSync(file, older);
    writeFileSync(sessionConfigPath(older), `${JSON.stringify({ 'test.threshold': { limit: 5, label: 'cars' }, 'test.other': { enabled: false } }, null, 2)}\n`);
    for (const values of [await replay(older), await reprocess(older)]) {
      expect(values).toHaveLength(1);
      expect(values[0]?.values).toEqual({ 'test.threshold': { limit: 5, label: 'cars' }, 'test.other': { enabled: false } });
      expect(values[0]?.overridden).toEqual({ 'test.threshold': [], 'test.other': [] });
    }
  });
});
