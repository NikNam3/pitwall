import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import type { FeedId } from '@pitwall/domain';
import type { FeedInfo, ServerMessage } from '@pitwall/contracts';
import { TopicHub } from '../../src/hub/topic-hub.ts';
import { WsServer } from '../../src/ws/server.ts';
import { WsClient } from '../../src/ws/client.ts';

const F = 'f1' as FeedId;
const feeds = (): FeedInfo[] => [{ feedId: F, kind: 'replay', label: 'test' }];
const cleanup: Array<() => unknown> = [];
afterEach(async () => { for (const c of cleanup.splice(0).reverse()) await c(); });
const server = async (hub: TopicHub, o: Partial<Parameters<typeof WsServer.start>[0]> = {}) => {
  const s = await WsServer.start({ port: 0, hub, feeds, ...o }); cleanup.push(() => s.close()); return s;
};
const client = (port: number, o = {}) => { const c = WsClient.connect(`ws://127.0.0.1:${port}`, o); cleanup.push(() => c.close()); return c; };
const raw = async (port: number) => {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`); const got: ServerMessage[] = [];
  ws.on('message', (d) => got.push(JSON.parse(String(d)))); await new Promise((r) => ws.once('open', r));
  cleanup.push(() => ws.terminate()); return { ws, got };
};
const newHub = () => new TopicHub({ now: () => performance.now() });

describe('WsServer / WsClient', () => {
  it('sends hello with the contract version and feeds on connect', async () => {
    const s = await server(newHub()); const hellos: unknown[] = [];
    client(s.port).onHello((m) => hellos.push(m));
    await vi.waitFor(() => expect(hellos).toEqual([{ type: 'hello', contractVersion: 2, feeds: feeds() }]));
  });
  it('routes subscribe/unsubscribe to the hub (default feed = first feed)', async () => {
    const hub = newHub(); hub.publishAppend(F, 'laps', [{ n: 1 }]);
    const s = await server(hub); const c = client(s.port); const got: ServerMessage[] = [];
    const id = c.subscribe('laps', {}, (m) => got.push(m));
    await vi.waitFor(() => expect(got).toEqual([{ type: 'snapshot', id, entries: [{ n: 1 }] }]));
    hub.publishAppend(F, 'laps', [{ n: 2 }]);
    await vi.waitFor(() => expect(got).toHaveLength(2));
    expect(got[1]).toEqual({ type: 'append', id, entries: [{ n: 2 }] });
    c.unsubscribe(id); await new Promise((r) => setTimeout(r, 50));
    hub.publishAppend(F, 'laps', [{ n: 3 }]); await new Promise((r) => setTimeout(r, 50));
    expect(got).toHaveLength(2);
  });
  it('answers command with notSupported, malformed input and unknown feeds with error', async () => {
    const s = await server(newHub()); const { ws, got } = await raw(s.port);
    ws.send(JSON.stringify({ type: 'command', id: 'c1', command: { kind: 'boxCall', tyre: 'soft' } }));
    ws.send('{"type":"subscribe"');
    ws.send(JSON.stringify({ type: 'subscribe', id: 's1', topic: 'laps', params: {}, feedId: 'nope' }));
    await vi.waitFor(() => expect(got.slice(1)).toEqual([
      { type: 'commandResult', id: 'c1', ok: false, reason: 'notSupported' },
      { type: 'error', reason: 'malformed' },
      { type: 'error', id: 's1', reason: 'unknownFeed' },
    ]));
  });
  it('sends heartbeats and drops a silent client; a heartbeating client stays', async () => {
    const hub = newHub(); const s = await server(hub, { heartbeatMs: 50, timeoutMs: 200 });
    const { ws, got } = await raw(s.port); const closed = new Promise((r) => ws.once('close', r));
    const c = client(s.port, { heartbeatMs: 50 }); const live: ServerMessage[] = [];
    c.subscribe('events', {}, (m) => live.push(m));
    await closed;
    expect(got.some((m) => m.type === 'heartbeat')).toBe(true);
    hub.publishAppend(F, 'events', ['e']);
    await vi.waitFor(() => expect(live.at(-1)).toMatchObject({ type: 'append', entries: ['e'] }));
  });
  it('client resubscribes after the server restarts on the same port', async () => {
    const hub = newHub(); hub.publishAppend(F, 'laps', ['a']);
    const s1 = await WsServer.start({ port: 0, hub, feeds }); const port = s1.port;
    const c = client(port, { reconnectMs: 50 }); let hellos = 0; c.onHello(() => { hellos++; });
    const got: ServerMessage[] = []; const id = c.subscribe('laps', {}, (m) => got.push(m));
    await vi.waitFor(() => expect(got).toHaveLength(1));
    await s1.close();
    await server(hub, { port });
    await vi.waitFor(() => expect(got).toEqual([{ type: 'snapshot', id, entries: ['a'] }, { type: 'snapshot', id, entries: ['a'] }]), { timeout: 3000 });
    expect(hellos).toBe(2);
    hub.publishAppend(F, 'laps', ['b']);
    await vi.waitFor(() => expect(got).toHaveLength(3));
    await new Promise((r) => setTimeout(r, 50));
    expect(got).toHaveLength(3);
  });
  it('rejects a busy port with a clear startup error', async () => {
    const s = await server(newHub());
    await expect(WsServer.start({ port: s.port, hub: newHub(), feeds })).rejects.toThrow(`WebSocket port ${s.port} is already in use`);
  });
});
