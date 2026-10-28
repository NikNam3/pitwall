// WebSocket server (spec 8): one hub client per connection, hello on connect, heartbeats, silent clients dropped.
// Besides subscriptions it only passes `uiAction` messages to the UI state and `replayControl` messages to the replay; the reserved `command` channel is always answered with `notSupported`.
import { WebSocket, WebSocketServer } from 'ws';
import type { FeedId } from '@pitwall/domain';
import { CONTRACT_VERSION, TOPICS, decodeClientMessage, encodeMessage } from '@pitwall/contracts';
import type { ClientMessage, FeedInfo, ReplayControl, ServerMessage } from '@pitwall/contracts';
import type { Logger } from '../log.ts';
import type { UiState } from '../ui-state/ui-state.ts';
import type { TopicHub } from '../hub/topic-hub.ts';
import { StartupError } from '../startup-error.ts';

export type WsServerOptions = {
  /** 0 picks a free port; read it back from `WsServer.port`. */
  port: number;
  hub: TopicHub;
  /** The feeds on offer right now; asked again for every connection and subscription. */
  feeds: () => FeedInfo[];
  /** The UI state that `uiAction` messages change; without it they are answered with `notSupported`. */
  uiState?: Pick<UiState, 'apply'>;
  /** The replay transport that `replayControl` messages drive; without it (a live feed), or when its `control` returns `false`, they are answered with `notSupported`. */
  replay?: { control(control: ReplayControl): boolean | undefined };
  /** Default `127.0.0.1`. */
  host?: string;
  /** How often `hub.tick()` flushes throttled subscriptions and owed snapshots. Default 10. */
  tickMs?: number;
  /** How often every client gets a heartbeat. Default 5000. */
  heartbeatMs?: number;
  /** A client that sent nothing for this long is dropped. Default 15000. */
  timeoutMs?: number;
  /**
   * Gets one `ws subscribe` line per accepted subscription (the Playwright specs check them for duplicates): at info
   * with `clientId`, `id`, `topic` and `feedId`; at debug, instead, with the client's `params` as well.
   */
  log?: Pick<Logger, 'info' | 'debug' | 'isLevelEnabled'>;
};

/** Larger client messages close the connection with code 1009; real ones are a few hundred bytes. */
const MAX_PAYLOAD_BYTES = 65_536;

type Send = (message: ServerMessage) => void;

export class WsServer {
  private readonly lastSeen = new Map<WebSocket, number>();
  private readonly timers: NodeJS.Timeout[];
  private nextClient = 1;

  private readonly wss: WebSocketServer;
  private readonly options: WsServerOptions;

  private constructor(wss: WebSocketServer, options: WsServerOptions) {
    this.wss = wss;
    this.options = options;
    this.wss.on('connection', (socket) => this.accept(socket));
    this.timers = [
      setInterval(() => options.hub.tick(), options.tickMs ?? 10),
      setInterval(() => this.heartbeat(), options.heartbeatMs ?? 5000),
    ];
  }

  /** Resolves once listening; rejects with a `StartupError` when the port cannot be bound. */
  static async start(options: WsServerOptions): Promise<WsServer> {
    const wss = new WebSocketServer({ port: options.port, host: options.host ?? '127.0.0.1', maxPayload: MAX_PAYLOAD_BYTES });
    await new Promise<void>((resolve, reject) => {
      wss.once('listening', resolve);
      wss.once('error', (error: NodeJS.ErrnoException) => {
        wss.close();
        reject(new StartupError(error.code === 'EADDRINUSE' ? `WebSocket port ${options.port} is already in use` : error.message));
      });
    });
    return new WsServer(wss, options);
  }

  get port(): number {
    const address = this.wss.address();
    return typeof address === 'object' && address !== null ? address.port : this.options.port;
  }

  /** Resolves once the port is free again. */
  async close(): Promise<void> {
    for (const timer of this.timers) clearInterval(timer);
    for (const socket of this.wss.clients) socket.terminate();
    await new Promise<void>((resolve) => this.wss.close(() => resolve()));
  }

  private accept(socket: WebSocket): void {
    const clientId = `c${this.nextClient++}`;
    const { hub, feeds } = this.options;
    const send = safeSend(socket);
    hub.addClient(clientId, { send, bufferedAmount: () => socket.bufferedAmount });
    this.lastSeen.set(socket, performance.now());
    socket.on('message', (data, isBinary) => {
      this.lastSeen.set(socket, performance.now());
      const message = isBinary ? undefined : decodeClientMessage(data.toString());
      if (message === undefined) send({ type: 'error', reason: 'malformed' });
      else this.handle(clientId, message, send);
    });
    // Errors (e.g. an oversized message) are followed by `close`, which does the cleanup.
    socket.on('error', () => {});
    socket.on('close', () => {
      this.lastSeen.delete(socket);
      hub.removeClient(clientId);
    });
    send({ type: 'hello', contractVersion: CONTRACT_VERSION, feeds: feeds() });
  }

  private handle(clientId: string, message: ClientMessage, send: Send): void {
    switch (message.type) {
      case 'subscribe': {
        const { id, topic, params } = message;
        // A global topic belongs to no feed: any `feedId` the client sent is ignored.
        const global = TOPICS[topic].scope === 'global';
        const feedId = global ? undefined : this.resolveFeed(message.feedId);
        if (feedId === undefined && !global) {
          send({ type: 'error', id, reason: 'unknownFeed' });
          return;
        }
        this.logSubscribe({ clientId, id, topic, params, feedId });
        this.options.hub.subscribe({ clientId, id, topic, params, feedId });
        return;
      }
      case 'unsubscribe':
        this.options.hub.unsubscribe(clientId, message.id);
        return;
      case 'command':
        send({ type: 'commandResult', id: message.id, ok: false, reason: 'notSupported' });
        return;
      case 'uiAction': {
        const result = this.options.uiState?.apply(message.action) ?? { ok: false, reason: 'notSupported' } as const;
        send({ type: 'actionResult', id: message.id, ...result });
        return;
      }
      case 'replayControl': {
        const { replay } = this.options;
        // `false` means the replay is not ready yet to take controls.
        const taken = replay !== undefined && replay.control(message.control) !== false;
        send({ type: 'actionResult', id: message.id, ...(taken ? { ok: true as const } : { ok: false as const, reason: 'notSupported' as const }) });
        return;
      }
      case 'heartbeat':
        return; // only refreshes `lastSeen`
    }
  }

  /** One line per subscription; the params (client-sized, up to MAX_PAYLOAD_BYTES) only at debug. */
  private logSubscribe({ params, ...line }: { clientId: string; id: string; topic: string; params: unknown; feedId: FeedId | undefined }): void {
    const { log } = this.options;
    if (log?.isLevelEnabled('debug')) log.debug({ ...line, params }, 'ws subscribe');
    else log?.info(line, 'ws subscribe');
  }

  /** The requested feed, or the first one when none is requested; `undefined` when it does not exist. */
  private resolveFeed(requested: FeedId | undefined): FeedId | undefined {
    const feeds = this.options.feeds();
    const feedId = requested ?? feeds[0]?.feedId;
    return feeds.some((feed) => feed.feedId === feedId) ? feedId : undefined;
  }

  private heartbeat(): void {
    const silentSince = performance.now() - (this.options.timeoutMs ?? 15_000);
    for (const [socket, lastSeen] of this.lastSeen) {
      if (lastSeen < silentSince) socket.terminate();
      else safeSend(socket)({ type: 'heartbeat' });
    }
  }
}

/** A send that never throws, so one broken client cannot stop the hub from serving the others. */
const safeSend =
  (socket: WebSocket): Send =>
  (message) => {
    if (socket.readyState !== WebSocket.OPEN) return;
    try {
      socket.send(encodeMessage(message));
    } catch {
      socket.terminate();
    }
  };
