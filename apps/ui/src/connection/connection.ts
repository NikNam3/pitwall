// The only module that touches the WebSocket (spec 6.1).
import { decodeServerMessage, encodeMessage, type ClientMessage, type ServerMessage } from '@pitwall/contracts';

export type ConnectionState = 'connecting' | 'open' | 'closed';

/** One link to the bridge. The topic store is its only consumer. */
export interface Connection {
  /** The current state; listeners only hear changes. */
  readonly state: ConnectionState;
  /** Sends a message; dropped while the connection is not open. */
  send(message: ClientMessage): void;
  onMessage(cb: (m: ServerMessage) => void): () => void;
  onState(cb: (s: ConnectionState) => void): () => void;
}

const INITIAL_BACKOFF_MS = 250;
const MAX_BACKOFF_MS = 5000;
const WS_OPEN = 1;

/** A reconnecting WebSocket connection: the delay doubles from `initialBackoffMs` to `maxBackoffMs` and resets after an open. */
export function createWsConnection(
  url: string,
  opts: { initialBackoffMs?: number; maxBackoffMs?: number } = {},
): Connection {
  const initialBackoff = opts.initialBackoffMs ?? INITIAL_BACKOFF_MS;
  const maxBackoff = opts.maxBackoffMs ?? MAX_BACKOFF_MS;
  const messageListeners = new Set<(m: ServerMessage) => void>();
  const stateListeners = new Set<(s: ConnectionState) => void>();
  let state: ConnectionState = 'connecting';
  let backoff = initialBackoff;
  let socket: WebSocket;

  const setState = (next: ConnectionState): void => {
    state = next;
    for (const cb of [...stateListeners]) cb(next);
  };

  const connect = (): void => {
    const ws = new WebSocket(url);
    socket = ws;
    ws.onopen = () => {
      backoff = initialBackoff;
      setState('open');
    };
    ws.onmessage = (event) => {
      const message = typeof event.data === 'string' ? decodeServerMessage(event.data) : undefined;
      if (message === undefined) return;
      for (const cb of [...messageListeners]) cb(message);
    };
    ws.onclose = () => {
      if (socket !== ws) return;
      setState('closed');
      const delay = backoff;
      backoff = Math.min(backoff * 2, maxBackoff);
      setTimeout(() => {
        setState('connecting');
        connect();
      }, delay);
    };
  };
  connect();

  return {
    get state() {
      return state;
    },
    send(message) {
      if (state === 'open' && socket.readyState === WS_OPEN) socket.send(encodeMessage(message));
    },
    onMessage(cb) {
      messageListeners.add(cb);
      return () => messageListeners.delete(cb);
    },
    onState(cb) {
      stateListeners.add(cb);
      return () => stateListeners.delete(cb);
    },
  };
}
