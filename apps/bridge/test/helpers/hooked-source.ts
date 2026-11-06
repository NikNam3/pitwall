// A source that hands every packet on with hooks around it: `before` sees the packet (a hub clock on its record time),
// `after` its index once the pipeline took it (a user action between two records of a live run).
import type { PacketSource, RawPacket } from '../../src/input/packet-source.ts';

export type SourceHooks = { before?: (packet: RawPacket) => void; after?: (index: number) => void };

export class HookedSource implements PacketSource {
  readonly #inner: PacketSource;
  readonly #hooks: SourceHooks;

  constructor(inner: PacketSource, hooks: SourceHooks) {
    this.#inner = inner;
    this.#hooks = hooks;
  }

  get feedId() {
    return this.#inner.feedId;
  }

  get done(): Promise<void> {
    return this.#inner.done;
  }

  start(onPacket: (packet: RawPacket) => void): void {
    let index = 0;
    this.#inner.start((packet) => {
      this.#hooks.before?.(packet);
      onPacket(packet);
      this.#hooks.after?.(index++);
    });
  }

  stop(): Promise<void> {
    return this.#inner.stop();
  }
}
