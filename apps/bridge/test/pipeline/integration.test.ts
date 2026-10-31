import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { FeedId } from '@pitwall/domain';
import type { ServerMessage } from '@pitwall/contracts';
import { FEATURES } from '../../src/features/index.generated.ts';
import { TopicHub } from '../../src/hub/topic-hub.ts';
import { PwrecSource } from '../../src/input/pwrec-source.ts';
import { createLogger } from '../../src/log.ts';
import { FeedPipeline } from '../../src/pipeline/feed-pipeline.ts';
import { topicStreamHash } from '../../src/pipeline/stream-hash.ts';
import { WsClient } from '../../src/ws/client.ts';
import { WsServer } from '../../src/ws/server.ts';

const segment = (name: string) => join(import.meta.dirname, '../../../../fixtures/segments', name);
const SEGMENT = segment('race-zandvoort-lap10.pwrec.gz');
// The stream hash encodes every feed topic for every car: about 36 MB of messages for SEGMENT's 5 s of race, ~0.8 s a
// replay. Its behaviours need no particular moment, so they hash the shortest race segment (1.5 s, 20 cars) and the
// shortest other recording (the end of a qualifying session).
const HASH_SEGMENT = segment('race-zandvoort-pit-exit.pwrec.gz');
const OTHER_HASH_SEGMENT = segment('qualifying-singapore-end.pwrec.gz');
const F = 'replay' as FeedId;

describe('PwrecSource → pipeline → WebSocket (in process)', () => {
  it('delivers hello, snapshots and updates; resubscribes after reconnect', async () => {
    const hub = new TopicHub({ now: () => performance.now() });
    const feeds = () => [{ feedId: F, kind: 'replay' as const, label: 'segment' }];
    const s1 = await WsServer.start({ port: 0, hub, feeds }); const port = s1.port;
    const c = WsClient.connect(`ws://127.0.0.1:${port}`, { reconnectMs: 50 }); let hellos = 0; c.onHello(() => { hellos++; });
    const info: ServerMessage[] = [], laps: ServerMessage[] = [];
    c.subscribe('session.info', {}, (m) => info.push(m)); c.subscribe('laps', {}, (m) => laps.push(m));
    await vi.waitFor(() => expect(laps).toHaveLength(1));
    expect(info[0]).toMatchObject({ type: 'topicStatus', status: 'noData' });
    const p = new FeedPipeline({ feedId: F, source: new PwrecSource({ feedId: F, path: SEGMENT, mode: 'asFastAsPossible' }), hub, features: FEATURES, log: createLogger({ level: 'silent' }) });
    p.start(); await p.done; hub.tick();
    await vi.waitFor(() => expect(info.some((m) => m.type === 'update' || m.type === 'snapshot')).toBe(true));
    expect(info.findLast((m) => m.type === 'update')).toMatchObject({ value: { sessionUid: '13536157633115227668' } });
    const entries = laps.flatMap((m) => (m.type === 'append' || m.type === 'snapshot' ? (m.entries ?? []) : [])) as Array<{ lapTimeMs: number }>;
    expect(entries.length).toBeGreaterThan(0); expect(entries.every((l) => l.lapTimeMs > 0)).toBe(true);
    await s1.close(); const s2 = await WsServer.start({ port, hub, feeds });
    await vi.waitFor(() => expect(hellos).toBe(2), { timeout: 3000 });
    await vi.waitFor(() => expect(laps.at(-1)).toMatchObject({ type: 'snapshot', entries: expect.arrayContaining([expect.objectContaining({ lapTimeMs: entries[0]!.lapTimeMs })]) }));
    expect(info.at(-1)).toMatchObject({ type: 'snapshot', value: { sessionUid: '13536157633115227668' } });
    c.close(); await s2.close();
  });
  it('topic stream hash is deterministic', async () => {
    const [a, b] = [await topicStreamHash(HASH_SEGMENT), await topicStreamHash(HASH_SEGMENT)];
    expect(a).toMatch(/^[0-9a-f]{64}$/); expect(a).toBe(b);
  });
  it('topic stream hash differs between recordings', async () => {
    expect(await topicStreamHash(OTHER_HASH_SEGMENT)).not.toBe(await topicStreamHash(HASH_SEGMENT));
  });
});
