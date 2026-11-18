// A CLI command's connection to a running bridge (C58): its WebSocket port (`PITWALL_WS_PORT`), its greeting with the
// feeds it serves, a topic's current value and a uiAction's answer (C73). Used by `pitwall drivers`, `pitwall basis` and
// `pitwall plans`; not a command of its own.
import WebSocket from 'ws';
import { decodeServerMessage, encodeMessage, type ClientMessage, type FeedInfo, type ServerMessage, type TopicName, type UiAction } from '@pitwall/contracts';
import type { FeedId } from '@pitwall/domain';
import { loadConfig } from '../../config.ts';
import type { CliIo } from '../io.ts';

/** How long a command waits for a running bridge to greet and to answer. */
const BRIDGE_TIMEOUT_MS = 5000;

/** A connection to a running bridge, open once it has greeted; `feeds` are the feeds its greeting named. */
export type Bridge = {
  feeds: readonly FeedInfo[];
  send(message: ClientMessage): void;
  next(match: (m: ServerMessage) => boolean): Promise<ServerMessage>;
  close(): void;
};

/** Connects to the bridge on `port`; `undefined` when nothing listens there. */
export function connect(port: number, io: CliIo): Promise<Bridge | undefined> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    const waiting: Array<{ match: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }> = [];
    let greeted = false;
    const fail = (message: string): void => {
      clearTimeout(timer);
      socket.terminate();
      if (greeted) for (const w of waiting.splice(0)) w.resolve({ type: 'error', reason: 'malformed' });
      reject(new Error(message));
    };
    const timer = setTimeout(() => fail(`the bridge on port ${port} did not answer`), BRIDGE_TIMEOUT_MS);
    io.signal.addEventListener('abort', () => fail('interrupted'), { once: true });
    const bridge: Bridge = {
      feeds: [],
      send: (message) => socket.send(encodeMessage(message)),
      next: (match) => new Promise((res) => waiting.push({ match, resolve: res })),
      close: () => {
        clearTimeout(timer);
        socket.terminate();
      },
    };
    socket.on('error', (error: NodeJS.ErrnoException) => {
      if (!greeted && error.code === 'ECONNREFUSED') {
        clearTimeout(timer);
        resolve(undefined);
      } else fail(`the bridge on port ${port}: ${error.message}`);
    });
    socket.on('close', () => {
      if (greeted) fail('the bridge closed the connection');
    });
    socket.on('message', (data, isBinary) => {
      const message = isBinary ? undefined : decodeServerMessage(data.toString());
      if (message === undefined) return;
      if (!greeted) {
        if (message.type === 'starting') fail('the bridge is still starting (rebuilding stored sessions); try again once it serves');
        if (message.type !== 'hello') return;
        greeted = true;
        clearTimeout(timer);
        resolve({ ...bridge, feeds: message.feeds });
        return;
      }
      const i = waiting.findIndex((w) => w.match(message));
      if (i >= 0) waiting.splice(i, 1)[0]?.resolve(message);
    });
  });
}

/** Within `BRIDGE_TIMEOUT_MS`, else a rejection naming what was awaited. */
function inTime<T>(promise: Promise<T>, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`the bridge did not answer ${what}`)), BRIDGE_TIMEOUT_MS);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** The current value of a topic of the bridge (its snapshot), of the feed `feed` for a feed topic; `undefined` without data. */
export async function topicValue(bridge: Bridge, topic: TopicName, id: string, feed?: FeedId): Promise<unknown> {
  const answer = bridge.next((m) => 'id' in m && m.id === id && (m.type === 'snapshot' || m.type === 'topicStatus' || m.type === 'error'));
  bridge.send(feed === undefined ? { type: 'subscribe', id, topic, params: {} } : { type: 'subscribe', id, topic, params: {}, feedId: feed });
  const message = await inTime(answer, `the subscription to ${topic}`);
  if (message.type === 'error') throw new Error(`the bridge refused the subscription to ${topic} (${message.reason})`);
  return message.type === 'snapshot' ? message.value : undefined;
}

/** Sends `action` and waits for its answer: `undefined` when accepted, else the bridge's message (C73). */
export async function sendAction(bridge: Bridge, action: UiAction, id: string): Promise<string | undefined> {
  const answer = bridge.next((m) => m.type === 'actionResult' && m.id === id);
  bridge.send({ type: 'uiAction', id, action });
  const result = await inTime(answer, 'the action');
  if (result.type !== 'actionResult') throw new Error('the bridge did not answer the action');
  return result.ok ? undefined : (result.message ?? `the bridge rejected the action (${result.reason})`);
}

/** The feed a command acts on: `--feed`, else the bridge's only feed; a message when neither names one. */
export function chooseFeed(bridge: Bridge, requested: string | undefined): { feed: FeedId } | { error: string } {
  const ids = bridge.feeds.map((f) => f.feedId).join(', ') || 'none';
  if (requested !== undefined) {
    const found = bridge.feeds.find((f) => f.feedId === requested);
    return found === undefined ? { error: `the bridge serves no feed "${requested}" (feeds: ${ids})` } : { feed: found.feedId };
  }
  const only = bridge.feeds.length === 1 ? bridge.feeds[0] : undefined;
  if (only !== undefined) return { feed: only.feedId };
  return { error: bridge.feeds.length === 0 ? 'the bridge serves no feed' : `the bridge serves several feeds; name one with --feed (${ids})` };
}

/**
 * Runs `use` on a connection to the running bridge and closes it after; without a bridge prints that one is needed and
 * returns 1.
 */
export async function withBridge(io: CliIo, command: string, use: (bridge: Bridge) => Promise<number>): Promise<number> {
  const port = loadConfig(io.env).wsPort;
  const bridge = await connect(port, io);
  if (bridge === undefined) {
    io.err(`pitwall: "${command}" needs a running bridge; none answers on port ${port}`);
    return 1;
  }
  try {
    return await use(bridge);
  } finally {
    bridge.close();
  }
}
