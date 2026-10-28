// replayControl over the WebSocket (Task 5). ASSUMED injection point: `WsServerOptions.replay?: { control(c: ReplayControl): void }`;
// without it (a live feed) the answer is `notSupported`.
import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import type { FeedInfo, ReplayControl, ServerMessage } from '@pitwall/contracts';
import { TopicHub } from '../../src/hub/topic-hub.ts';
import { WsServer, type WsServerOptions } from '../../src/ws/server.ts';

const cleanup: Array<() => unknown> = [];
afterEach(async () => { for (const c of cleanup.splice(0).reverse()) await c(); });
const feeds = (): FeedInfo[] => [];

async function start(extra: object = {}) {
  const hub = new TopicHub({ now: () => performance.now() });
  const server = await WsServer.start({ port: 0, hub, feeds, ...extra } as WsServerOptions);
  cleanup.push(() => server.close());
  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`);
  const got: ServerMessage[] = [];
  ws.on('message', (d) => got.push(JSON.parse(String(d))));
  await new Promise((r) => ws.once('open', r));
  cleanup.push(() => ws.terminate());
  return { ws, got };
}

describe('replayControl over the WebSocket', () => {
  it.each<ReplayControl>([
    { kind: 'pause' }, { kind: 'play' }, { kind: 'speed', factor: 4 }, { kind: 'jumpToLap', lap: 5 }, { kind: 'jumpToTime', sessionTimeMs: 61_250 },
  ])('hands %o to the replay and answers actionResult ok', async (control) => {
    const replay = { control: vi.fn() };
    const { ws, got } = await start({ replay });
    ws.send(JSON.stringify({ type: 'replayControl', id: 'rc1', control }));
    await vi.waitFor(() => expect(got).toContainEqual({ type: 'actionResult', id: 'rc1', ok: true }));
    expect(replay.control).toHaveBeenCalledExactlyOnceWith(control);
  });
  it('answers notSupported on a feed that is not a replay (no replay controller)', async () => {
    const { ws, got } = await start();
    ws.send(JSON.stringify({ type: 'replayControl', id: 'rc2', control: { kind: 'pause' } }));
    await vi.waitFor(() => expect(got).toContainEqual({ type: 'actionResult', id: 'rc2', ok: false, reason: 'notSupported' }));
  });
  it('a malformed replayControl is answered with error malformed and reaches nobody', async () => {
    const replay = { control: vi.fn() };
    const { ws, got } = await start({ replay });
    ws.send(JSON.stringify({ type: 'replayControl', id: 'rc3', control: { kind: 'speed', factor: 0 } }));
    await vi.waitFor(() => expect(got).toContainEqual({ type: 'error', reason: 'malformed' }));
    expect(replay.control).not.toHaveBeenCalled();
    expect(got.some((m) => m.type === 'actionResult')).toBe(false);
  });
});
