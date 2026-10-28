import type { FeedId } from '@pitwall/domain';

/** One UDP datagram of one feed, exactly as received (or as recorded). */
export interface RawPacket {
  readonly feedId: FeedId;
  /** Shell-side diagnostics time in ms; never read by the engine. */
  readonly receivedAtMs: number;
  readonly bytes: Uint8Array;
}

/**
 * Where the raw datagrams of one feed come from.
 * `onPacket` is never called after `stop()`, not even when `stop()` is called from inside `onPacket`.
 */
export interface PacketSource {
  readonly feedId: FeedId;
  /** Starts delivering packets to `onPacket`. Calling it twice is a bug and throws. */
  start(onPacket: (packet: RawPacket) => void): void;
  /** Stops delivering and resolves once `done` has settled (also when it settled with an error). */
  stop(): Promise<void>;
  /**
   * Resolves when the source has finished delivering (end of input, or after `stop()`).
   * Rejects on a fatal error; an unobserved rejection never crashes the process.
   */
  readonly done: Promise<void>;
}
