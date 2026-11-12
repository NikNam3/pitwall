// A starting bridge's progress (C61 "with progress shown"): before `hello` the bridge sends `starting` messages; the
// topic store keeps the newest as `starting` until a `hello` arrives, across a reconnect too (the startup server closes
// the link before the real bridge serves).
import { CONTRACT_VERSION, type ServerMessage } from '@pitwall/contracts';
import { feedId } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import { TopicStore } from '../../src/connection/topic-store.svelte.ts';
import { FakeConnection } from './fake-connection.ts';

const setup = () => {
  const connection = new FakeConnection();
  const store = new TopicStore(connection);
  return { connection, store };
};
const starting = (done: number, total: number): ServerMessage => ({ type: 'starting', step: 'rebuild', done, total });
const hello: ServerMessage = { type: 'hello', contractVersion: CONTRACT_VERSION, feeds: [{ feedId: feedId('f1'), kind: 'udp', label: 'x', team: null }] };

describe('TopicStore: the starting progress', () => {
  it('is undefined before any message', () => {
    expect(setup().store.starting).toBeUndefined();
  });

  it('keeps the newest starting message: step, done and total', () => {
    const { connection, store } = setup();
    connection.push(starting(0, 0));
    expect(store.starting).toEqual({ step: 'rebuild', done: 0, total: 0 });
    connection.push(starting(0, 7));
    connection.push(starting(3, 7));
    expect(store.starting).toEqual({ step: 'rebuild', done: 3, total: 7 });
  });

  it('is cleared by hello', () => {
    const { connection, store } = setup();
    connection.push(starting(7, 7));
    connection.push(hello);
    expect(store.starting).toBeUndefined();
    expect(store.feeds.map((f) => f.feedId)).toEqual(['f1']);
  });

  it('is kept across a reconnect until a hello arrives', () => {
    const { connection, store } = setup();
    connection.push(starting(5, 7));
    // the startup server closes the link; the connection reconnects to the bridge that now serves
    connection.close();
    expect(store.starting).toEqual({ step: 'rebuild', done: 5, total: 7 });
    connection.reopen();
    expect(store.starting).toEqual({ step: 'rebuild', done: 5, total: 7 });
    connection.push(hello);
    expect(store.starting).toBeUndefined();
  });

  it('a starting message after hello (a bridge restarting) shows the progress again', () => {
    const { connection, store } = setup();
    connection.push(hello);
    connection.close();
    connection.reopen();
    connection.push(starting(1, 4));
    expect(store.starting).toEqual({ step: 'rebuild', done: 1, total: 4 });
  });

  it('subscribes nothing and answers nothing on a starting message', () => {
    const { connection } = setup();
    connection.push(starting(1, 4));
    expect(connection.sent).toEqual([]);
  });
});
