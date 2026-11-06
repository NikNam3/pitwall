// `calibration.choose` over the WebSocket (C62a, C73, C76; spec 3.3): the server hands it to the feed's pipeline
// (`choose`, which `serve` wires to `FeedPipeline.commitDecision`), never to the calibration store or the UI state,
// and answers the pipeline's result. Without a pipeline to take it the action is `notSupported`.
import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import type { FeedInfo, ServerMessage, UiAction } from '@pitwall/contracts';
import { TopicHub } from '../../src/hub/topic-hub.ts';
import { WsServer, type WsServerOptions } from '../../src/ws/server.ts';

const cleanup: Array<() => unknown> = [];
afterEach(async () => { for (const c of cleanup.splice(0).reverse()) await c(); });

type Choose = Extract<UiAction, { kind: 'calibration.choose' }>;

async function start(extra: Partial<WsServerOptions>) {
  const hub = new TopicHub({ now: () => performance.now() });
  const feeds = (): FeedInfo[] => [];
  const server = await WsServer.start({ port: 0, hub, feeds, ...extra });
  cleanup.push(() => server.close());
  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`);
  const got: ServerMessage[] = [];
  ws.on('message', (d) => got.push(JSON.parse(String(d)) as ServerMessage));
  await new Promise((r) => ws.once('open', r));
  cleanup.push(() => ws.terminate());
  const send = (id: string, action: unknown) => ws.send(JSON.stringify({ type: 'uiAction', id, action }));
  const answer = (id: string) => vi.waitFor(() => {
    const message = got.find((m) => m.type === 'actionResult' && m.id === id);
    if (message === undefined) throw new Error(`no answer to ${id}`);
    return message;
  });
  return { send, answer };
}

describe('calibration.choose over the WebSocket', () => {
  it.each([{ setId: 'dry' }, { setId: null }])('routes calibration.choose (setId $setId) to the feed\'s pipeline and answers its ok', async ({ setId }) => {
    const choose = vi.fn((_action: Choose) => ({ ok: true as const }));
    const calibration = { apply: vi.fn() };
    const uiState = { apply: vi.fn() };
    const { send, answer } = await start({ choose, calibration, uiState });
    const action = { kind: 'calibration.choose', feedId: 'f1', setId };
    send('c1', action);
    expect(await answer('c1')).toEqual({ type: 'actionResult', id: 'c1', ok: true });
    expect(choose).toHaveBeenCalledWith(action);
    expect(calibration.apply).not.toHaveBeenCalled();
    expect(uiState.apply).not.toHaveBeenCalled();
  });

  it('answers calibration.choose with notSupported without a pipeline to take it', async () => {
    const { send, answer } = await start({});
    send('c2', { kind: 'calibration.choose', feedId: 'f1', setId: 'dry' });
    expect(await answer('c2')).toMatchObject({ type: 'actionResult', id: 'c2', ok: false, reason: 'notSupported' });
  });
});
