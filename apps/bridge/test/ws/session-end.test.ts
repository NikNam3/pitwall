// SP4.3c Task 10b (C59, C73): `session.end` over the WebSocket. The server hands it to the feed's pipeline through the
// option `endSession` (which `serve` wires to `FeedPipeline.endSession` of the action's feed, as `choose` is wired to
// `commitDecision`), never to the UI state, and answers the pipeline's result. Without a pipeline to take it the action is
// `notSupported`.
import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import type { ActionOutcome, FeedInfo, ServerMessage, UiAction } from '@pitwall/contracts';
import { TopicHub } from '../../src/hub/topic-hub.ts';
import { WsServer, type WsServerOptions } from '../../src/ws/server.ts';

const cleanup: Array<() => unknown> = [];
afterEach(async () => { for (const c of cleanup.splice(0).reverse()) await c(); });

type EndAction = Extract<UiAction, { kind: 'session.end' }>;
/** The option this task adds to `WsServerOptions`; passed through a cast so the file compiles before it exists. */
type EndSeam = { endSession?: (action: EndAction) => ActionOutcome };

async function start(extra: Partial<WsServerOptions> & EndSeam) {
  const hub = new TopicHub({ now: () => performance.now() });
  const feeds = (): FeedInfo[] => [];
  const server = await WsServer.start({ port: 0, hub, feeds, ...(extra as Partial<WsServerOptions>) });
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

describe('session.end over the WebSocket', () => {
  it('routes session.end to the feed\'s pipeline and answers its ok', async () => {
    const endSession = vi.fn((_action: EndAction): ActionOutcome => ({ ok: true }));
    const uiState = { apply: vi.fn() };
    const { send, answer } = await start({ endSession, uiState });
    const action = { kind: 'session.end', feedId: 'f1' };
    send('e1', action);
    expect(await answer('e1')).toEqual({ type: 'actionResult', id: 'e1', ok: true });
    expect(endSession).toHaveBeenCalledTimes(1);
    expect(endSession).toHaveBeenCalledWith(action);
    expect(uiState.apply).not.toHaveBeenCalled();
  });

  it('answers the pipeline\'s rejection: no running session is invalid (C73)', async () => {
    const endSession = vi.fn((_action: EndAction): ActionOutcome => ({ ok: false, reason: 'invalid', message: 'no running session' }));
    const { send, answer } = await start({ endSession });
    send('e2', { kind: 'session.end', feedId: 'f1' });
    expect(await answer('e2')).toEqual({ type: 'actionResult', id: 'e2', ok: false, reason: 'invalid', message: 'no running session' });
  });

  it('answers session.end with notSupported without a pipeline to take it', async () => {
    const uiState = { apply: vi.fn(() => ({ ok: true as const })) };
    const { send, answer } = await start({ uiState });
    send('e3', { kind: 'session.end', feedId: 'f1' });
    expect(await answer('e3')).toMatchObject({ type: 'actionResult', id: 'e3', ok: false, reason: 'notSupported' });
    expect(uiState.apply).not.toHaveBeenCalled();
  });
});
