// Replays prepared packets synchronously.
import type { FeedId } from '@pitwall/domain';
import type { PacketSource, RawPacket } from '../../src/input/packet-source.ts';

export type PreparedPacket = { bytes: Uint8Array; receivedAtMs: number };

export class ArraySource implements PacketSource {
  readonly feedId: FeedId;
  readonly done: Promise<void>;
  readonly #packets: readonly PreparedPacket[];
  #resolve!: () => void;

  constructor(feedId: FeedId, packets: readonly PreparedPacket[]) {
    this.feedId = feedId;
    this.#packets = packets;
    this.done = new Promise((resolve) => { this.#resolve = resolve; });
  }

  start(on: (p: RawPacket) => void): void {
    for (const p of this.#packets) on({ feedId: this.feedId, ...p });
    this.#resolve();
  }

  async stop(): Promise<void> {
    this.#resolve();
  }
}
