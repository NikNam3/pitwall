// SP4.3b Task 17, `plan.commit` and `plan.clear` over the WebSocket (C73, C76; spec §8.2, §8.5). Seam: the server's
// option `plan: (action) => ActionOutcome`, which `serve` wires to `PlanRouting.commit` over its map of pipelines; the
// server hands both actions to it, never to the UI state or a store, and answers its result. Without it they are
// `notSupported`.
import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import type { ActionOutcome, FeedInfo, ServerMessage } from '@pitwall/contracts';
import { TopicHub } from '../../src/hub/topic-hub.ts';
import { WsServer, type WsServerOptions } from '../../src/ws/server.ts';

const cleanup: Array<() => unknown> = [];
afterEach(async () => { for (const c of cleanup.splice(0).reverse()) await c(); });

/** The server's options with the `plan` option this task adds. */
type WithPlan = Partial<WsServerOptions> & { plan?: (action: unknown) => ActionOutcome };

async function start(extra: WithPlan) {
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

const policy = { stops: [{ lap: 12, compound: 'hard' }], triggers: [{ kind: 'rain', wetnessMs: 4_000, action: { box: 'inter' } }] };
const actions = [
  { kind: 'plan.commit', feedId: 'f1', carId: 0, policy },
  { kind: 'plan.clear', feedId: 'f1', carId: 0 },
];

describe('the plan uiActions over the WebSocket', () => {
  it.each(actions)('routes $kind to the plan routing and answers its result', async (action) => {
    const plan = vi.fn((_action: unknown): ActionOutcome => ({ ok: true }));
    const uiState = { apply: vi.fn() };
    const calibration = { apply: vi.fn() };
    const { send, answer } = await start({ plan, uiState, calibration });
    send('p1', action);
    expect(await answer('p1')).toEqual({ type: 'actionResult', id: 'p1', ok: true });
    expect(plan).toHaveBeenCalledWith(action);
    expect(uiState.apply).not.toHaveBeenCalled();
    expect(calibration.apply).not.toHaveBeenCalled();
  });

  it('answers a rejection of the plan routing as it is (C73)', async () => {
    const plan = vi.fn((): ActionOutcome => ({ ok: false, reason: 'invalid', message: 'stop lap 58 past the race\'s 57 laps' }));
    const { send, answer } = await start({ plan });
    send('p2', actions[0]);
    expect(await answer('p2')).toEqual({ type: 'actionResult', id: 'p2', ok: false, reason: 'invalid', message: 'stop lap 58 past the race\'s 57 laps' });
  });

  it('answers the plan uiActions with notSupported without a plan routing', async () => {
    const uiState = { apply: vi.fn(() => ({ ok: true as const })) };
    const { send, answer } = await start({ uiState });
    send('p3', actions[1]);
    expect(await answer('p3')).toMatchObject({ type: 'actionResult', id: 'p3', ok: false, reason: 'notSupported' });
    expect(uiState.apply).not.toHaveBeenCalled();
  });
});
