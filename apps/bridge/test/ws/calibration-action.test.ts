// SP4.1a Task 5, delegated (R5): the server routes the calibration uiActions (every `calibration.*` kind but
// `calibration.choose`, Task 4's) to the calibration store (C62a) and answers its rejection as UI state's are (C73).
// Every other uiAction still goes to the UI state.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import type { FeedInfo, ServerMessage } from '@pitwall/contracts';
import type { CalibrationAction } from '../../src/calibration/store.ts';
import { TopicHub } from '../../src/hub/topic-hub.ts';
import { createLogger } from '../../src/log.ts';
import { UiState } from '../../src/ui-state/ui-state.ts';
import { WsServer } from '../../src/ws/server.ts';

const cleanup: Array<() => unknown> = [];
afterEach(async () => { for (const c of cleanup.splice(0).reverse()) await c(); });
const feeds = (): FeedInfo[] => [];

type Result = { ok: true } | { ok: false; reason: 'invalid'; message: string };

/** A real UiState on a temp dir and a fake calibration store behind a real WsServer, as `serve.ts` wires them. */
async function start(result: Result = { ok: true }) {
  const hub = new TopicHub({ now: () => performance.now() });
  const uiState = UiState.open(join(mkdtempSync(join(tmpdir(), 'ws-cal-')), 'ui'), hub, createLogger({ level: 'silent' }));
  cleanup.push(() => uiState.close());
  const uiApply = vi.spyOn(uiState, 'apply');
  const calibration = { apply: vi.fn((_action: CalibrationAction): Result => result) };
  const server = await WsServer.start({ port: 0, hub, feeds, uiState, calibration });
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
  return { calibration, uiApply, send, answer };
}

const source = { sessionUid: '123', weekendId: '77', feedCar: 0, car: 0, firstLap: 1, excludedLaps: [] };
const at = { trackId: 10, setId: 'dry' };
const ACTIONS = [
  { kind: 'calibration.set.create', trackId: 10, name: 'Dry' },
  { kind: 'calibration.set.copy', ...at, name: 'Dry copy' },
  { kind: 'calibration.set.rename', ...at, name: 'Dry v2' },
  { kind: 'calibration.set.delete', ...at },
  { kind: 'calibration.source.add', ...at, source },
  { kind: 'calibration.source.remove', ...at, source },
  { kind: 'calibration.lap.exclude', ...at, source, lap: 2 },
  { kind: 'calibration.lap.include', ...at, source, lap: 2 },
  { kind: 'calibration.override.set', ...at, key: 'degradation.nuMsPerLap.medium', value: 55 },
  { kind: 'calibration.override.clear', ...at, key: 'degradation.nuMsPerLap.medium' },
];

describe('calibration uiActions over the WebSocket', () => {
  it.each(ACTIONS)('routes $kind to the calibration store and answers its ok', async (action) => {
    const { calibration, uiApply, send, answer } = await start();
    send('a1', action);
    expect(await answer('a1')).toEqual({ type: 'actionResult', id: 'a1', ok: true });
    expect(calibration.apply).toHaveBeenCalledWith(action);
    expect(uiApply).not.toHaveBeenCalled();
  });

  it('answers the store\'s rejection as invalid, as the UI state\'s are (C73)', async () => {
    const { calibration, send, answer } = await start({ ok: false, reason: 'invalid', message: 'value out of range' });
    send('a2', { kind: 'calibration.override.set', ...at, key: 'degradation.nuMsPerLap.medium', value: 5000 });
    expect(await answer('a2')).toMatchObject({ type: 'actionResult', id: 'a2', ok: false, reason: 'invalid' });
    expect(calibration.apply).toHaveBeenCalledTimes(1);
  });

  it('routes every other uiAction to the UI state and never calibration.choose to the store', async () => {
    const { calibration, uiApply, send, answer } = await start();
    const group = { id: 1, primary: 'teammate', compare: [], window: { kind: 'live' } };
    send('a3', { kind: 'linkGroup.set', group });
    expect(await answer('a3')).toEqual({ type: 'actionResult', id: 'a3', ok: true });
    expect(uiApply).toHaveBeenCalledTimes(1);
    // A connection's messages are handled in order: once a5 is answered, a4 was handled.
    send('a4', { kind: 'calibration.choose', feedId: 'f1', setId: 'dry' });
    send('a5', { kind: 'linkGroup.set', group });
    await answer('a5');
    expect(calibration.apply).not.toHaveBeenCalled();
  });
});
