// A live-like source: packets arrive when the test pushes them, and it finishes only when stopped.
import type { FeedId } from '@pitwall/domain';
import type { PacketSource, RawPacket } from '../../src/input/packet-source.ts';

export class ManualSource implements PacketSource {
  readonly feedId: FeedId;
  readonly done: Promise<void>;
  #resolve!: () => void;
  #onPacket: ((p: RawPacket) => void) | undefined;
  #stopped = false;

  constructor(feedId: FeedId) {
    this.feedId = feedId;
    this.done = new Promise((resolve) => { this.#resolve = resolve; });
  }

  start(on: (p: RawPacket) => void): void {
    this.#onPacket = on;
  }

  push(bytes: Uint8Array, receivedAtMs: number): void {
    if (!this.#stopped) this.#onPacket?.({ feedId: this.feedId, bytes, receivedAtMs });
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    this.#resolve();
  }
}
