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

const SEGMENT = join(import.meta.dirname, '../../../../fixtures/segments/tt-zandvoort-lap1.pwrec.gz');
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
    expect(info.findLast((m) => m.type === 'update')).toMatchObject({ value: { sessionUid: '1895827638050388100' } });
    const entries = laps.flatMap((m) => (m.type === 'append' || m.type === 'snapshot' ? (m.entries ?? []) : [])) as Array<{ lapTimeMs: number }>;
    expect(entries.length).toBeGreaterThan(0); expect(entries.every((l) => l.lapTimeMs > 0)).toBe(true);
    await s1.close(); const s2 = await WsServer.start({ port, hub, feeds });
    await vi.waitFor(() => expect(hellos).toBe(2), { timeout: 3000 });
    await vi.waitFor(() => expect(laps.at(-1)).toMatchObject({ type: 'snapshot', entries: expect.arrayContaining([expect.objectContaining({ lapTimeMs: entries[0]!.lapTimeMs })]) }));
    expect(info.at(-1)).toMatchObject({ type: 'snapshot', value: { sessionUid: '1895827638050388100' } });
    c.close(); await s2.close();
  });
  it('topic stream hash is deterministic', async () => {
    const [a, b] = [await topicStreamHash(SEGMENT), await topicStreamHash(SEGMENT)];
    expect(a).toMatch(/^[0-9a-f]{64}$/); expect(a).toBe(b);
  });
  it('topic stream hash differs between recordings', async () => {
    const other = join(import.meta.dirname, '../../../../fixtures/segments/race-singapore-start.pwrec.gz');
    expect(await topicStreamHash(other)).not.toBe(await topicStreamHash(SEGMENT));
  });
});
