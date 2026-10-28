// Reconnecting WebSocket client (spec 8): subscriptions survive a dropped connection and are re-sent after every reconnect.
import WebSocket from 'ws';
import type { FeedId } from '@pitwall/domain';
import { decodeServerMessage, encodeMessage } from '@pitwall/contracts';
import type { ClientMessage, ServerMessage, TopicName } from '@pitwall/contracts';

export type WsClientOptions = {
  /** Wait before reconnecting after the connection dropped. Default 1000. */
  reconnectMs?: number;
  /** How often a heartbeat goes out while connected. Default 5000. */
  heartbeatMs?: number;
};

type HelloMessage = Extract<ServerMessage, { type: 'hello' }>;
type Subscription = { request: Extract<ClientMessage, { type: 'subscribe' }>; onMessage: (message: ServerMessage) => void };

export class WsClient {
  private readonly subscriptions = new Map<string, Subscription>();
  private readonly helloListeners: Array<(message: HelloMessage) => void> = [];
  private readonly reconnectMs: number;
  private readonly heartbeatMs: number;
  private socket?: WebSocket;
  private heartbeatTimer?: NodeJS.Timeout;
  private reconnectTimer?: NodeJS.Timeout;
  private nextSubscription = 1;
  private closed = false;

  private readonly url: string;

  private constructor(url: string, options: WsClientOptions) {
    this.url = url;
    this.reconnectMs = options.reconnectMs ?? 1000;
    this.heartbeatMs = options.heartbeatMs ?? 5000;
  }

  /** Returns at once and keeps (re)connecting in the background until `close()`. */
  static connect(url: string, options: WsClientOptions = {}): WsClient {
    const client = new WsClient(url, options);
    client.open();
    return client;
  }

  /** The returned id stays the same across reconnects. */
  subscribe(topic: TopicName, params: object, onMessage: (message: ServerMessage) => void, feedId?: FeedId): string {
    const id = `sub-${this.nextSubscription++}`;
    const request: Subscription['request'] =
      feedId === undefined ? { type: 'subscribe', id, topic, params } : { type: 'subscribe', id, topic, params, feedId };
    this.subscriptions.set(id, { request, onMessage });
    this.sendIfOpen(request); // while not open, the request goes out with all others once the connection opens
    return id;
  }

  unsubscribe(id: string): void {
    if (this.subscriptions.delete(id)) this.sendIfOpen({ type: 'unsubscribe', id });
  }

  /** Called for the hello of every connection, including after a reconnect. */
  onHello(listener: (message: HelloMessage) => void): void {
    this.helloListeners.push(listener);
  }

  close(): void {
    this.closed = true;
    clearTimeout(this.reconnectTimer);
    clearInterval(this.heartbeatTimer);
    this.socket?.terminate();
  }

  private open(): void {
    const socket = new WebSocket(this.url);
    this.socket = socket;
    socket.on('open', () => {
      for (const { request } of this.subscriptions.values()) this.sendIfOpen(request);
      this.heartbeatTimer = setInterval(() => this.sendIfOpen({ type: 'heartbeat' }), this.heartbeatMs);
    });
    socket.on('message', (data, isBinary) => {
      const message = isBinary ? undefined : decodeServerMessage(data.toString());
      if (message !== undefined) this.dispatch(message);
    });
    // Errors (e.g. connection refused) are always followed by `close`, which schedules the reconnect.
    socket.on('error', () => {});
    socket.on('close', () => {
      clearInterval(this.heartbeatTimer);
      if (!this.closed) this.reconnectTimer = setTimeout(() => this.open(), this.reconnectMs);
    });
  }

  private dispatch(message: ServerMessage): void {
    if (message.type === 'hello') {
      for (const listener of this.helloListeners) listener(message);
    } else if ('id' in message && message.id !== undefined) {
      this.subscriptions.get(message.id)?.onMessage(message);
    }
  }

  private sendIfOpen(message: ClientMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(encodeMessage(message));
  }
}
