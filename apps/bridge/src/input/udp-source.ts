import { createSocket, type Socket } from 'node:dgram';
import type { FeedId } from '@pitwall/domain';
import { deferred } from './deferred.ts';
import type { PacketSource, RawPacket } from './packet-source.ts';

export interface UdpSourceOptions {
  readonly feedId: FeedId;
  /** 0 picks an ephemeral port; read it back from `boundPort`. */
  readonly port: number;
  /** Default `0.0.0.0`. */
  readonly host?: string;
  /** Monotonic ms clock stamped on every datagram. Default `performance.now`. */
  readonly clock?: () => number;
}

const defaultClock = (): number => performance.now();

/** Listens for the datagrams of one feed on one UDP port. */
export class UdpSource implements PacketSource {
  readonly feedId: FeedId;
  readonly done: Promise<void>;
  /** Resolves once bound; rejects with the bind error (e.g. `EADDRINUSE`). */
  readonly listening: Promise<void>;
  readonly #port: number;
  readonly #host: string;
  readonly #clock: () => number;
  readonly #finish = deferred();
  readonly #bound = deferred();
  #socket: Socket | undefined;
  #boundPort: number | undefined;
  #stopped = false;
  #closing = false;

  constructor(opts: UdpSourceOptions) {
    this.feedId = opts.feedId;
    this.#port = opts.port;
    this.#host = opts.host ?? '0.0.0.0';
    this.#clock = opts.clock ?? defaultClock;
    this.done = this.#finish.promise;
    this.listening = this.#bound.promise;
    this.done.catch(() => {});
    this.listening.catch(() => {});
  }

  /** The bound port; undefined until `listening` resolves. */
  get boundPort(): number | undefined {
    return this.#boundPort;
  }

  start(onPacket: (packet: RawPacket) => void): void {
    if (this.#socket !== undefined) throw new Error('UdpSource: already started');
    const socket = createSocket('udp4');
    this.#socket = socket;
    socket.on('message', (message) => {
      if (this.#stopped) return;
      onPacket({ feedId: this.feedId, receivedAtMs: this.#clock(), bytes: new Uint8Array(message) });
    });
    socket.once('listening', () => {
      this.#boundPort = socket.address().port;
      this.#bound.resolve();
    });
    socket.on('error', (error) => {
      this.#bound.reject(error);
      this.#finish.reject(error);
      this.#close(socket);
    });
    socket.once('close', () => {
      this.#bound.reject(new Error('UdpSource: closed before it was listening'));
      this.#finish.resolve();
    });
    socket.bind(this.#port, this.#host);
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    if (this.#socket === undefined) this.#finish.resolve();
    else this.#close(this.#socket);
    await this.done.catch(() => {});
  }

  #close(socket: Socket): void {
    if (this.#closing) return;
    this.#closing = true;
    socket.close();
  }
}
