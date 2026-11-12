// The feed's effective config as a core topic (SP4.3b Task 2; C47, C54, C55; spec 2.3): the feed's pipeline publishes
// `config.effective` once per session start, typed by its topic file and not through a binding: every declared key with
// the value the run computes with, and per key the fields whose value came from `config.json`. The config file lives in
// a temporary data dir (C84); only test-only features declare config here.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { ServerMessage } from '@pitwall/contracts';
import type { FeedId } from '@pitwall/domain';
import { defineConfig } from '@pitwall/engine';
import { ScenarioBuilder, packetBytes } from '../../../../packages/engine/test/builders/index.ts';
import { defineFeature, type Feature } from '../../src/features/feature.ts';
import { loadFeatureConfig } from '../../src/feature-config.ts';
import { TopicHub } from '../../src/hub/topic-hub.ts';
import { createLogger } from '../../src/log.ts';
import { FeedPipeline } from '../../src/pipeline/feed-pipeline.ts';
import { openDatabase } from '../../src/storage/db.ts';
import { ArraySource, type PreparedPacket } from '../helpers/array-source.ts';

/** The value of `config.effective` (its topic file, `packages/contracts/src/topics/config.effective.ts`). */
type ConfigEffectiveValue = { values: Record<string, Record<string, number | string | boolean>>; overridden: Record<string, string[]> };

const F = 'effective' as FeedId;
const tmp = () => mkdtempSync(join(tmpdir(), 'config-effective-'));

const threshold = defineConfig('test.threshold', { limit: 1_000_000, label: 'cars' });
const other = defineConfig('test.other', { enabled: false });
const features: Feature[] = [defineFeature({ name: 'watcher', calculators: [], topics: [], config: [threshold, other] })];

const packetsOf = (uid: bigint, offsetMs = 0): PreparedPacket[] =>
  new ScenarioBuilder({ sessionUid: uid, cars: 2 }).session().participants().frames(10, () => {}).packets()
    .map(({ packet, receivedAtMs }) => ({ bytes: packetBytes(packet), receivedAtMs: receivedAtMs + offsetMs }));

describe('FeedPipeline: config.effective', () => {
  it('config.effective holds every declared key with its value and the keys config.json overrode', async () => {
    const root = tmp();
    writeFileSync(join(root, 'config.json'), JSON.stringify({ 'test.threshold': { limit: 5 } }));
    const config = loadFeatureConfig(root, features);

    const hub = new TopicHub({ now: () => 0 });
    const published = vi.spyOn(hub, 'publishState');
    const sent: ServerMessage[] = [];
    hub.addClient('c', { send: (m) => sent.push(m), bufferedAmount: () => 0 });
    hub.subscribe({ clientId: 'c', id: 'effective', topic: 'config.effective', params: {}, feedId: F });
    // A live run of two sessions.
    const source = new ArraySource(F, [...packetsOf(77n), ...packetsOf(78n, 60_000)]);
    const pipeline = new FeedPipeline({
      feedId: F, source, hub, features, config, log: createLogger({ level: 'silent' }),
      storage: { rulesVersion: 'unversioned', db: openDatabase(join(tmp(), 'e.db')), recordingsDir: tmp() },
    });
    pipeline.start();
    await pipeline.done;

    // Published by the feed's pipeline, once per session start.
    const calls = published.mock.calls.filter(([feed, topic]) => feed === F && topic === 'config.effective');
    expect(calls).toHaveLength(2);
    const value = calls.at(-1)?.[2]({}) as ConfigEffectiveValue;
    expect(value.values).toEqual({ 'test.threshold': { limit: 5, label: 'cars' }, 'test.other': { enabled: false } });
    expect(value.overridden['test.threshold']).toEqual(['limit']);
    expect(Object.entries(value.overridden).filter(([key, fields]) => key !== 'test.threshold' && fields.length > 0)).toEqual([]);

    // A subscribed window gets it as the topic's value.
    const values = sent.flatMap((m) => ((m.type === 'snapshot' || m.type === 'update') && m.id === 'effective' && 'value' in m ? [m.value] : []));
    expect(values.at(-1)).toEqual(value);
  });
});
