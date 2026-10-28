import { decodeClientMessage, encodeMessage, type ServerMessage } from '@pitwall/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TopicStore } from '../../src/connection/topic-store.svelte.ts';
import { createWsConnection, type ConnectionState } from '../../src/connection/connection.ts';

type Listener = (event: { data?: string }) => void;

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readyState = 0;
  readonly sent: string[] = [];
  onopen: Listener | null = null;
  onmessage: Listener | null = null;
  onclose: Listener | null = null;
  onerror: Listener | null = null;
  private readonly listeners = new Map<string, Set<Listener>>();

  readonly url: string;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }
  addEventListener(type: string, cb: Listener): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(cb);
    this.listeners.set(type, set);
  }
  removeEventListener(type: string, cb: Listener): void {
    this.listeners.get(type)?.delete(cb);
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.serverClose();
  }
  private emit(type: 'open' | 'message' | 'close', event: { data?: string }): void {
    (this[`on${type}` as 'onopen'] as Listener | null)?.(event);
    for (const cb of this.listeners.get(type) ?? []) cb(event);
  }
  serverOpen(): void {
    this.readyState = 1;
    this.emit('open', {});
  }
  serverSend(message: ServerMessage): void {
    this.emit('message', { data: encodeMessage(message) });
  }
  serverClose(): void {
    this.readyState = 3;
    this.emit('close', {});
  }
}

const last = () => FakeWebSocket.instances.at(-1) as FakeWebSocket;

beforeEach(() => {
  FakeWebSocket.instances = [];
  vi.useFakeTimers();
  vi.stubGlobal('WebSocket', FakeWebSocket);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('createWsConnection', () => {
  it('connects to the url and reports connecting, then open', () => {
    const states: ConnectionState[] = [];
    const c = createWsConnection('ws://bridge');
    c.onState((s) => states.push(s));
    expect(c.state).toBe('connecting');
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(last().url).toBe('ws://bridge');
    last().serverOpen();
    expect(states).toEqual(['open']);
  });

  it('decodes server messages for listeners and drops malformed ones', () => {
    const c = createWsConnection('ws://bridge');
    const got: ServerMessage[] = [];
    c.onMessage((m) => got.push(m));
    last().serverOpen();
    last().serverSend({ type: 'heartbeat' });
    last().onmessage?.({ data: 'not json' });
    expect(got).toEqual([{ type: 'heartbeat' }]);
  });

  it('sends encoded client messages once open', () => {
    const c = createWsConnection('ws://bridge');
    last().serverOpen();
    c.send({ type: 'unsubscribe', id: 's1' });
    expect(last().sent.map((t) => decodeClientMessage(t))).toEqual([{ type: 'unsubscribe', id: 's1' }]);
  });

  it('reconnects after 250 ms, doubling on each failed attempt, capped at 5 s', () => {
    const states: ConnectionState[] = [];
    const c = createWsConnection('ws://bridge');
    c.onState((s) => states.push(s));
    const delays = [250, 500, 1000, 2000, 4000, 5000, 5000];
    delays.forEach((delay, i) => {
      last().serverClose();
      expect(states.at(-1)).toBe('closed');
      expect(FakeWebSocket.instances).toHaveLength(i + 1);
      vi.advanceTimersByTime(delay - 1);
      expect(FakeWebSocket.instances).toHaveLength(i + 1);
      vi.advanceTimersByTime(1);
      expect(FakeWebSocket.instances).toHaveLength(i + 2);
    });
  });

  it('honours initialBackoffMs and maxBackoffMs', () => {
    createWsConnection('ws://bridge', { initialBackoffMs: 10, maxBackoffMs: 30 });
    for (const delay of [10, 20, 30, 30]) {
      const n = FakeWebSocket.instances.length;
      last().serverClose();
      vi.advanceTimersByTime(delay - 1);
      expect(FakeWebSocket.instances).toHaveLength(n);
      vi.advanceTimersByTime(1);
      expect(FakeWebSocket.instances).toHaveLength(n + 1);
    }
  });

  it('initialBackoffMs: 0 still waits at least 100 ms between attempts (floor), then doubles', () => {
    createWsConnection('ws://bridge', { initialBackoffMs: 0, maxBackoffMs: 5000 });
    for (const delay of [100, 200, 400]) {
      const n = FakeWebSocket.instances.length;
      last().serverClose();
      vi.advanceTimersByTime(delay - 1);
      expect(FakeWebSocket.instances).toHaveLength(n);
      vi.advanceTimersByTime(1);
      expect(FakeWebSocket.instances).toHaveLength(n + 1);
    }
  });

  it('reports open again after a reconnect', () => {
    const states: ConnectionState[] = [];
    const c = createWsConnection('ws://bridge');
    c.onState((s) => states.push(s));
    last().serverOpen();
    last().serverClose();
    vi.advanceTimersByTime(250);
    last().serverOpen();
    expect(states.filter((s) => s !== 'connecting')).toEqual(['open', 'closed', 'open']);
  });

  it('an unsubscribed listener no longer hears messages', () => {
    const c = createWsConnection('ws://bridge');
    const got: ServerMessage[] = [];
    const off = c.onMessage((m) => got.push(m));
    last().serverOpen();
    off();
    last().serverSend({ type: 'heartbeat' });
    expect(got).toEqual([]);
  });
});

describe('TopicStore.dispose over a real connection', () => {
  it('stops the reconnect timer: no new socket is opened after dispose', () => {
    const c = createWsConnection('ws://bridge');
    const store = new TopicStore(c);
    last().serverOpen();
    last().serverClose();
    store.dispose();
    vi.advanceTimersByTime(60_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});
