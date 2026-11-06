// A uiAction's result reaches its sender (C73, Task k1). Contract the tests assume of `TopicStore`:
//  - `send({ type: 'uiAction', id, action })` sends the message and returns a promise of the outcome: the bridge's
//    `actionResult` of the same id without `type` and `id` (`{ ok: true }` or `{ ok: false, reason, message? }`);
//  - results are matched by id, whatever their order;
//  - an action still unanswered when the link closes resolves `{ ok: false, reason: 'linkLost' }`, without a message
//    (the sender words it, C68: no user-visible wording in `connection/`); so does one sent while the link is not
//    open. No timer is involved.
import type { ClientMessage, UiAction } from '@pitwall/contracts';
import { describe, expect, it } from 'vitest';
import { TopicStore } from '../../src/connection/topic-store.svelte.ts';
import { FakeConnection } from './fake-connection.ts';

const ack: UiAction = { kind: 'alert.ack', key: 'f1:a:1000' };
const mute: UiAction = { kind: 'alertGroup.mute', category: 'tyres', muted: true };
const realism: UiAction = { kind: 'realism.set', enabled: true };

const setup = (initial: FakeConnection['state'] = 'open') => {
  const connection = new FakeConnection(initial);
  const store = new TopicStore(connection);
  /** Sends `action` under `id` and records whether its outcome has arrived yet. */
  const act = (id: string, action: UiAction) => {
    const tracked: { settled: boolean; outcome: Promise<unknown> } = { settled: false, outcome: Promise.resolve(undefined) };
    tracked.outcome = Promise.resolve(store.send({ type: 'uiAction', id, action } satisfies ClientMessage)).then((outcome) => {
      tracked.settled = true;
      return outcome;
    });
    return tracked;
  };
  return { connection, store, act };
};

/** Lets every resolved promise run its callbacks. */
const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

describe('TopicStore: the result of a uiAction', () => {
  it('a uiAction resolves with the bridge\'s actionResult of its id', async () => {
    const { connection, act } = setup();
    const sent = act('main.1', ack);
    expect(connection.sent).toEqual([{ type: 'uiAction', id: 'main.1', action: ack }]);
    await flush();
    expect(sent.settled).toBe(false);
    connection.push({ type: 'actionResult', id: 'main.1', ok: true });
    expect(await sent.outcome).toEqual({ ok: true });
  });

  it('a rejection carries its reason and message', async () => {
    const { connection, act } = setup();
    const invalid = act('main.1', realism);
    const unsupported = act('main.2', mute);
    connection.push({ type: 'actionResult', id: 'main.1', ok: false, reason: 'invalid', message: 'enabled must be a boolean' });
    connection.push({ type: 'actionResult', id: 'main.2', ok: false, reason: 'notSupported' });
    expect(await invalid.outcome).toEqual({ ok: false, reason: 'invalid', message: 'enabled must be a boolean' });
    expect(await unsupported.outcome).toEqual({ ok: false, reason: 'notSupported' });
  });

  it('results of interleaved actions reach their own sender', async () => {
    const { connection, act } = setup();
    const a = act('main.1', ack);
    const b = act('main.2', mute);
    const c = act('main.3', realism);
    connection.push({ type: 'actionResult', id: 'main.2', ok: false, reason: 'invalid', message: 'no such category' });
    connection.push({ type: 'actionResult', id: 'main.99', ok: true });
    await flush();
    expect([a.settled, b.settled, c.settled]).toEqual([false, true, false]);
    connection.push({ type: 'actionResult', id: 'main.3', ok: true });
    connection.push({ type: 'actionResult', id: 'main.1', ok: false, reason: 'notSupported' });
    expect(await a.outcome).toEqual({ ok: false, reason: 'notSupported' });
    expect(await b.outcome).toEqual({ ok: false, reason: 'invalid', message: 'no such category' });
    expect(await c.outcome).toEqual({ ok: true });
  });

  it('pending actions resolve as failed when the link closes', async () => {
    const { connection, act } = setup();
    const answered = act('main.1', ack);
    const pending = [act('main.2', mute), act('main.3', realism)];
    connection.push({ type: 'actionResult', id: 'main.1', ok: true });
    await flush();
    expect(pending.map((p) => p.settled)).toEqual([false, false]);
    connection.setState('closed');
    // exactly these keys: no message
    const failed = { ok: false, reason: 'linkLost' };
    for (const p of pending) expect(await p.outcome).toStrictEqual(failed);
    expect(await answered.outcome).toEqual({ ok: true });
    // A late answer for an id the close already settled changes nothing.
    connection.reopen();
    connection.push({ type: 'actionResult', id: 'main.2', ok: true });
    expect(await pending[0]!.outcome).toStrictEqual(failed);
    // Sent while the link is not open: the connection drops it, so it fails at once.
    connection.setState('closed');
    const whileClosed = act('main.4', ack);
    expect(await whileClosed.outcome).toStrictEqual(failed);
  });
});
