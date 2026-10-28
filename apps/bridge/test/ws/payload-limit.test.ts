import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { FeedId } from '@pitwall/domain';
import { TopicHub } from '../../src/hub/topic-hub.ts';
import { WsServer } from '../../src/ws/server.ts';

const cleanup: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanup.splice(0).reverse()) await c();
});

describe('WsServer payload limit', () => {
  it('closes a connection that sends a message over 65 536 bytes with code 1009', async () => {
    const feeds = () => [{ feedId: 'f1' as FeedId, kind: 'replay' as const, label: 'test' }];
    const server = await WsServer.start({ port: 0, hub: new TopicHub({ now: () => performance.now() }), feeds });
    cleanup.push(() => server.close());
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}`);
    cleanup.push(() => ws.terminate());
    await new Promise((resolve) => ws.once('open', resolve));
    const closed = new Promise<number>((resolve) => ws.once('close', resolve));
    ws.send('x'.repeat(65_537));
    expect(await closed).toBe(1009);
  });
});
