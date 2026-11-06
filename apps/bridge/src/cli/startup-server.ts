// The startup server (C61 "with progress shown"): while `pitwall live` rebuilds stored sessions, before it serves, it
// tells every client on the bridge's WebSocket port what the bridge is doing. It serves nothing: no `hello`, no topic.
import { WebSocket, WebSocketServer } from 'ws';
import { decodeClientMessage, encodeMessage, type ServerMessage, type StartupProgress } from '@pitwall/contracts';
import { StartupError } from '../startup-error.ts';

export type StartupServerOptions = {
  /** 0 picks a free port; read it back from `StartupServer.port`. */
  port: number;
  /** Default `127.0.0.1`. */
  host?: string;
};

/** Larger client messages close the connection; the server reads only heartbeats. */
const MAX_PAYLOAD_BYTES = 65_536;

/**
 * Sends every client `{ type: 'starting', ... }`: the newest progress on connect (0 of 0 before any) and each change.
 * Answers a `heartbeat` with a `heartbeat` and ignores every other client message. `close` disconnects its clients and
 * frees the port, so the UI's connection reconnects to the bridge that serves.
 */
export class StartupServer {
  readonly #wss: WebSocketServer;
  readonly #options: StartupServerOptions;
  #progress: StartupProgress = { step: 'rebuild', done: 0, total: 0 };

  private constructor(wss: WebSocketServer, options: StartupServerOptions) {
    this.#wss = wss;
    this.#options = options;
    wss.on('connection', (socket) => this.#accept(socket));
  }

  /** Resolves once listening; rejects with a `StartupError` when the port cannot be bound. */
  static async start(options: StartupServerOptions): Promise<StartupServer> {
    const wss = new WebSocketServer({ port: options.port, host: options.host ?? '127.0.0.1', maxPayload: MAX_PAYLOAD_BYTES });
    await new Promise<void>((resolve, reject) => {
      wss.once('listening', resolve);
      wss.once('error', (error: NodeJS.ErrnoException) => {
        wss.close();
        reject(new StartupError(error.code === 'EADDRINUSE' ? `WebSocket port ${options.port} is already in use` : error.message));
      });
    });
    return new StartupServer(wss, options);
  }

  get port(): number {
    const address = this.#wss.address();
    return typeof address === 'object' && address !== null ? address.port : this.#options.port;
  }

  /** The newest progress: `done` of `total` recordings rebuilt; sent to every client. */
  progress(done: number, total: number): void {
    this.#progress = { step: 'rebuild', done, total };
    for (const socket of this.#wss.clients) send(socket, this.#message());
  }

  /** Resolves once the clients are disconnected and the port is free again. */
  async close(): Promise<void> {
    for (const socket of this.#wss.clients) socket.terminate();
    await new Promise<void>((resolve) => this.#wss.close(() => resolve()));
  }

  #message(): ServerMessage {
    return { type: 'starting', ...this.#progress };
  }

  #accept(socket: WebSocket): void {
    socket.on('message', (data, isBinary) => {
      const message = isBinary ? undefined : decodeClientMessage(data.toString());
      if (message?.type === 'heartbeat') send(socket, { type: 'heartbeat' });
    });
    // Errors (e.g. an oversized message) are followed by `close`; nothing to clean up.
    socket.on('error', () => {});
    send(socket, this.#message());
  }
}

/** A send that never throws: a broken client is dropped. */
const send = (socket: WebSocket, message: ServerMessage): void => {
  if (socket.readyState !== WebSocket.OPEN) return;
  try {
    socket.send(encodeMessage(message));
  } catch {
    socket.terminate();
  }
};
