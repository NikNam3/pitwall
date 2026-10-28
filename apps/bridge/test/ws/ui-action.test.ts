import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import type { FeedInfo, ServerMessage } from '@pitwall/contracts';
import { TopicHub } from '../../src/hub/topic-hub.ts';
import { createLogger } from '../../src/log.ts';
import { UiState } from '../../src/ui-state/ui-state.ts';
import { WsServer } from '../../src/ws/server.ts';

const cleanup: Array<() => unknown> = [];
afterEach(async () => { for (const c of cleanup.splice(0).reverse()) await c(); });
const feeds = (): FeedInfo[] => [];

/** A real UiState on a temp dir behind a real WsServer (option `uiState`), as `serve.ts` wires them. */
async function start() {
  const hub = new TopicHub({ now: () => performance.now() });
  const uiState = UiState.open(join(mkdtempSync(join(tmpdir(), 'ws-ui-')), 'ui'), hub, createLogger({ level: 'silent' }));
  cleanup.push(() => uiState.close());
  const server = await WsServer.start({ port: 0, hub, feeds, uiState });
  cleanup.push(() => server.close());
  const open = async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}`); const got: ServerMessage[] = [];
    ws.on('message', (d) => got.push(JSON.parse(String(d)))); await new Promise((r) => ws.once('open', r));
    cleanup.push(() => ws.terminate()); return { ws, got };
  };
  return { open };
}
const group = { id: 1, primary: 'teammate', compare: [], window: { kind: 'live' } };

describe('uiAction over the WebSocket', () => {
  it('answers ok:true and updates every subscriber of ui.linkGroups, with no feed on offer', async () => {
    const { open } = await start();
    const a = await open(), b = await open();
    for (const [c, id] of [[a, 'la'], [b, 'lb']] as const) c.ws.send(JSON.stringify({ type: 'subscribe', id, topic: 'ui.linkGroups', params: {} }));
    await vi.waitFor(() => {
      expect(a.got.some((m) => m.type === 'snapshot' && m.id === 'la')).toBe(true);
      expect(b.got.some((m) => m.type === 'snapshot' && m.id === 'lb')).toBe(true);
    });
    a.ws.send(JSON.stringify({ type: 'uiAction', id: 'act1', action: { kind: 'linkGroup.set', group } }));
    await vi.waitFor(() => expect(a.got).toContainEqual({ type: 'actionResult', id: 'act1', ok: true }));
    await vi.waitFor(() => expect(b.got).toContainEqual({ type: 'update', id: 'lb', value: [group] }), { timeout: 3000 });
    expect(a.got).toContainEqual({ type: 'update', id: 'la', value: [group] });
  });
  it('answers ok:false invalid for a structurally invalid action and changes nothing', async () => {
    const { open } = await start();
    const a = await open();
    a.ws.send(JSON.stringify({ type: 'subscribe', id: 'l', topic: 'ui.linkGroups', params: {} }));
    await vi.waitFor(() => expect(a.got.some((m) => m.type === 'snapshot')).toBe(true));
    a.ws.send(JSON.stringify({ type: 'uiAction', id: 'act2', action: { kind: 'workbook.open', name: 'does-not-exist' } }));
    await vi.waitFor(() => expect(a.got).toContainEqual({ type: 'actionResult', id: 'act2', ok: false, reason: 'invalid' }));
    expect(a.got.filter((m) => m.type === 'update')).toEqual([]);
  });
  it('a malformed uiAction is answered with error malformed, not actionResult', async () => {
    const { open } = await start();
    const a = await open();
    a.ws.send(JSON.stringify({ type: 'uiAction', id: 'act3', action: { kind: 'nonsense' } }));
    await vi.waitFor(() => expect(a.got).toContainEqual({ type: 'error', reason: 'malformed' }));
    expect(a.got.some((m) => m.type === 'actionResult')).toBe(false);
  });
});
