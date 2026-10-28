// Config reaches the calculators through the pipeline, and each live session stores the config it ran with next to its
// session file, so replaying that file raises the same alarms. Only test-only features declare config here.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ServerMessage } from '@pitwall/contracts';
import type { FeedId, Insight } from '@pitwall/domain';
import { defineConfig, type QuickCalculator } from '@pitwall/engine';
import { ScenarioBuilder, packetBytes } from '../../../../packages/engine/test/builders/index.ts';
import { bindInsights, defineFeature, type Feature } from '../../src/features/feature.ts';
import { loadFeatureConfig, recordingConfig, sessionConfigPath } from '../../src/feature-config.ts';
import { TopicHub } from '../../src/hub/topic-hub.ts';
import type { PacketSource } from '../../src/input/packet-source.ts';
import { PwrecSource } from '../../src/input/pwrec-source.ts';
import { readPwrec } from '../../src/pwrec/reader.ts';
import { createLogger } from '../../src/log.ts';
import { FeedPipeline } from '../../src/pipeline/feed-pipeline.ts';
import { openDatabase } from '../../src/storage/db.ts';
import { ArraySource, type PreparedPacket } from '../helpers/array-source.ts';

const F = 'test' as FeedId;
const tmp = () => mkdtempSync(join(tmpdir(), 'pipeline-config-'));

/** Both calculators below compare the number of car slots (always above 0) with `limit`. */
const threshold = defineConfig('test.threshold', { limit: 1_000_000, label: 'cars' });
const other = defineConfig('test.other', { enabled: false });

/** Insight-only: bound to no topic, so it runs whatever is subscribed. Raises `test.over` once the slots exceed the limit. */
function watcher(seen: number[] = []) {
  const calc: QuickCalculator<number> = {
    kind: 'quick',
    id: 'test.watcher',
    reads: ['timing'],
    cadence: 'frame',
    compute: (view) => view.state.cars.length,
    insights: (out, _prev, view): Insight[] => {
      const { limit, label } = threshold.read(view);
      seen.push(limit);
      if (out <= limit) return [];
      return [{ key: 'test.over', severity: 'advisory', category: 'race', feedId: view.state.feedId, kind: 'test.over', params: { limit, label }, raisedAt: view.state.sessionTime }];
    },
  };
  const features: Feature[] = [
    defineFeature({ name: 'watcher', calculators: [calc], topics: [], config: [threshold, other] }),
    defineFeature({ name: 'insights', calculators: [], topics: [bindInsights('insights')] }),
  ];
  return { features, seen };
}

const packetsOf = (uid = 77n): PreparedPacket[] =>
  new ScenarioBuilder({ sessionUid: uid, cars: 2 }).session().participants().frames(10, () => {}).packets()
    .map(({ packet, receivedAtMs }) => ({ bytes: packetBytes(packet), receivedAtMs }));

type Run = { raised: Insight[]; dir: string };

/** Runs `source` through a pipeline of `features`; a live run (a session file per session) when `dir` is given. */
async function run(source: PacketSource, features: Feature[], opts: { config?: object; dir?: string } = {}): Promise<Run> {
  const sent: ServerMessage[] = [];
  const hub = new TopicHub({ now: () => 0 });
  hub.addClient('c', { send: (m) => sent.push(m), bufferedAmount: () => 0 });
  hub.subscribe({ clientId: 'c', id: 'insights', topic: 'insights', params: {}, feedId: F });
  const dir = opts.dir ?? tmp();
  const pipeline = new FeedPipeline({
    feedId: F, source, hub, features, log: createLogger({ level: 'silent' }),
    ...(opts.config && { config: opts.config as never }),
    ...(opts.dir && { storage: { db: openDatabase(join(tmp(), 'p.db')), recordingsDir: dir } }),
  });
  pipeline.start();
  await pipeline.done;
  const entries = sent.flatMap((m) => ('id' in m && m.id === 'insights' && 'entries' in m ? (m.entries as Array<{ type: string; insight?: Insight }>) : []));
  return { raised: entries.flatMap((e) => (e.type === 'raised' && e.insight ? [e.insight] : [])), dir };
}

const overs = (r: Run) => r.raised.filter((i) => i.kind === 'test.over');
const sessionFiles = (dir: string) => readdirSync(dir).filter((name) => name.endsWith('.pwrec.gz')).sort();
const sidecar = (file: string): unknown => JSON.parse(readFileSync(sessionConfigPath(file), 'utf8'));

describe('FeedPipeline: config reaches the calculators', () => {
  it('with the default (no config given) the threshold insight does not fire', async () => {
    const { features, seen } = watcher();
    expect(overs(await run(new ArraySource(F, packetsOf()), features))).toEqual([]);
    expect(seen.length).toBeGreaterThan(0);
    expect(new Set(seen)).toEqual(new Set([1_000_000]));
  });
  it('with an override it fires, and the calculator sees the override merged over its defaults', async () => {
    const { features, seen } = watcher();
    const r = await run(new ArraySource(F, packetsOf()), features, { config: { 'test.threshold': { limit: 0, label: 'cars' } } });
    expect(overs(r)).toEqual([expect.objectContaining({ params: { limit: 0, label: 'cars' } })]);
    expect(new Set(seen)).toEqual(new Set([0]));
  });
  it('a section the config leaves out reads as its defaults', async () => {
    const { features, seen } = watcher();
    await run(new ArraySource(F, packetsOf()), features, { config: { 'test.other': { enabled: true } } });
    expect(new Set(seen)).toEqual(new Set([1_000_000]));
  });
  it('the config comes from loadFeatureConfig as the CLI uses it: the file overrides, the default does not fire', async () => {
    const { features } = watcher();
    const root = tmp();
    const none = loadFeatureConfig(root, features);
    expect(overs(await run(new ArraySource(F, packetsOf()), features, { config: none }))).toEqual([]);
    writeFileSync(join(root, 'config.json'), JSON.stringify({ 'test.threshold': { limit: 1 } }));
    expect(overs(await run(new ArraySource(F, packetsOf()), features, { config: loadFeatureConfig(root, features) }))).toHaveLength(1);
  });
});

describe('FeedPipeline: the config travels with the session file', () => {
  it('writes <session file>.config.json next to each live session file, with the effective config', async () => {
    const { features } = watcher();
    const dir = tmp();
    const second = packetsOf(78n).map((p) => ({ ...p, receivedAtMs: p.receivedAtMs + 60_000 }));
    const config = { 'test.threshold': { limit: 3, label: 'cars' }, 'test.other': { enabled: true } };
    await run(new ArraySource(F, [...packetsOf(77n), ...second]), features, { config, dir });
    const files = sessionFiles(dir);
    expect(files).toHaveLength(2);
    expect(readdirSync(dir).sort()).toEqual(files.flatMap((f) => [f, `${f}.config.json`]));
    for (const file of files) expect(sidecar(join(dir, file))).toEqual(config);
  });
  it('without a config option the sidecar holds the defaults of the declared keys', async () => {
    const { features } = watcher();
    const dir = tmp();
    await run(new ArraySource(F, packetsOf()), features, { dir });
    expect(sidecar(join(dir, sessionFiles(dir)[0]!))).toEqual({ 'test.threshold': { limit: 1_000_000, label: 'cars' }, 'test.other': { enabled: false } });
  });
  it('is written when the session file opens: a live session that never ends already has it', async () => {
    const { features } = watcher();
    const dir = tmp();
    // The source delivers the packets and stays open, as a live feed does.
    const open: PromiseWithResolvers<void> = Promise.withResolvers();
    const source: PacketSource = {
      feedId: F, done: open.promise,
      start: (on) => { for (const p of packetsOf()) on({ feedId: F, ...p }); },
      stop: async () => open.resolve(),
    };
    const hub = new TopicHub({ now: () => 0 });
    const pipeline = new FeedPipeline({ feedId: F, source, hub, features, log: createLogger({ level: 'silent' }), storage: { db: openDatabase(join(tmp(), 'o.db')), recordingsDir: dir } });
    pipeline.start();
    expect(readdirSync(dir).filter((n) => n.endsWith('.config.json'))).toHaveLength(1);
    await pipeline.stop();
  });
  it('a sidecar that cannot be written does not stop the session: the session file and the topics carry on', async () => {
    const { features } = watcher();
    const dir = tmp();
    const at = new Date(2026, 9, 28, 13, 5, 9).getTime();
    const sessionFile = join(dir, '2026-10-28_13-05-09_000000000000004d.pwrec.gz');
    mkdirSync(sessionConfigPath(sessionFile)); // a directory where the sidecar belongs
    const packets = packetsOf();
    const hub = new TopicHub({ now: () => 0 });
    const sent: ServerMessage[] = [];
    hub.addClient('c', { send: (m) => sent.push(m), bufferedAmount: () => 0 });
    hub.subscribe({ clientId: 'c', id: 'info', topic: 'session.info', params: {}, feedId: F });
    const pipeline = new FeedPipeline({
      feedId: F, source: new ArraySource(F, packets), hub, features, log: createLogger({ level: 'silent' }), wallClock: () => at,
      storage: { db: openDatabase(join(tmp(), 'f.db')), recordingsDir: dir },
    });
    pipeline.start();
    await pipeline.done;
    let n = 0;
    for await (const _ of readPwrec(sessionFile)) n++;
    expect(n).toBe(packets.length);
    expect(sent.some((m) => 'id' in m && m.id === 'info' && m.type === 'update')).toBe(true);
  });
  it('a session processed from a recording writes no session file and so no sidecar', async () => {
    const { features } = watcher();
    const dir = tmp();
    const hub = new TopicHub({ now: () => 0 });
    const pipeline = new FeedPipeline({ feedId: F, source: new ArraySource(F, packetsOf()), hub, features, log: createLogger({ level: 'silent' }), storage: { db: openDatabase(join(tmp(), 'r.db')), sourcePath: join(dir, 'x.pwrec.gz') } });
    pipeline.start();
    await pipeline.done;
    expect(readdirSync(dir)).toEqual([]);
  });

  it('replaying a live session file with the config next to it raises the alarm the live run raised', async () => {
    const { features } = watcher();
    const dir = tmp();
    const effective = loadFeatureConfig(dir, features);
    // Live run with the override.
    const live = await run(new ArraySource(F, packetsOf()), features, { config: { ...effective, 'test.threshold': { limit: 1, label: 'cars' } }, dir });
    expect(overs(live)).toHaveLength(1);
    const file = join(dir, sessionFiles(dir)[0]!);

    // Replay later, when the engineer's config is back to the defaults: the stored config wins.
    const replayed = recordingConfig(file, features, effective);
    expect(replayed).toEqual({ 'test.threshold': { limit: 1, label: 'cars' }, 'test.other': { enabled: false } });
    const again = await run(new PwrecSource({ feedId: F, path: file, mode: 'asFastAsPossible' }), features, { config: replayed });
    expect(overs(again)).toEqual(overs(live));

    // Without the sidecar the replay uses the current config and the alarm stays silent.
    const bare = recordingConfig(join(tmp(), 'other.pwrec.gz'), features, effective);
    expect(overs(await run(new PwrecSource({ feedId: F, path: file, mode: 'asFastAsPossible' }), features, { config: bare }))).toEqual([]);
  });
});
