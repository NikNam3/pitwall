import type { DecodeError } from '@pitwall/protocol';
import type { FeedMetricsView, FrameMetrics } from '@pitwall/engine';
import { FEED_WINDOW_MS } from '../features/feed-status/feed-status.ts';

/** Packets per second count the packets of the last second. */
const RATE_WINDOW_MS = 1000;

type FrameSample = { atMs: number; framesClosed: number; incompleteFrames: number };

/** Index of the first of `items` (ascending by `timeOf`) whose time is above `limit`; `items.length` if none is. */
function firstAfter<T>(items: readonly T[], limit: number, timeOf: (item: T) => number): number {
  let lo = 0;
  let hi = items.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (timeOf(items[mid] as T) > limit) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

const itself = (t: number): number => t;
const sampleTime = (s: FrameSample): number => s.atMs;

/**
 * Measures a feed's health over receive time (spec 8.3): packet rate, silence, frame loss and wrong-format packets.
 * Times are the packets' `receivedAtMs` and must not go back.
 */
export class FeedMonitor {
  readonly #windowMs: number;
  /** Receive times of the last second of packets, oldest first. */
  #packetTimes: number[] = [];
  /** Frame counters over the window, oldest first; the first sample is the window's baseline. */
  #samples: FrameSample[] = [];
  #decodeErrors = 0;
  #wrongFormat: { format: number; atMs: number } | undefined;

  constructor(opts: { windowMs?: number } = {}) {
    this.#windowMs = opts.windowMs ?? FEED_WINDOW_MS;
  }

  onPacket(receivedAtMs: number): void {
    this.#packetTimes.push(receivedAtMs);
    this.#packetTimes.splice(0, firstAfter(this.#packetTimes, receivedAtMs - RATE_WINDOW_MS, itself));
  }

  onDecodeError(error: DecodeError, receivedAtMs: number): void {
    this.#decodeErrors++;
    if (error.kind === 'wrongFormat') this.#wrongFormat = { format: error.format, atMs: receivedAtMs };
  }

  /** Records the tracker's frame counters at `atMs`, for the loss share. */
  sample(m: FrameMetrics, atMs: number): void {
    this.#samples.push({ atMs, framesClosed: m.framesClosed, incompleteFrames: m.incompleteFrames });
    // Keep the newest sample at or before the window start: it is the baseline the loss is counted from.
    const baseline = firstAfter(this.#samples, atMs - this.#windowMs, sampleTime) - 1;
    if (baseline > 0) this.#samples.splice(0, baseline);
  }

  view(m: FrameMetrics, nowMs: number): FeedMetricsView {
    const last = this.#packetTimes.at(-1);
    const wrongFormat = this.#wrongFormat !== undefined && nowMs - this.#wrongFormat.atMs < this.#windowMs ? this.#wrongFormat.format : undefined;
    return {
      ...m,
      decodeErrors: m.decodeErrors + this.#decodeErrors,
      packetsPerSecond: this.#packetTimes.length - firstAfter(this.#packetTimes, nowMs - RATE_WINDOW_MS, itself),
      connected: last !== undefined,
      msSinceLastPacket: last === undefined ? 0 : nowMs - last,
      lossPercent: this.#lossPercent(m, nowMs),
      ...(wrongFormat !== undefined && { wrongFormat }),
    };
  }

  /** Incomplete over closed frames since the newest sample at or before the window start (or since the start). */
  #lossPercent(m: FrameMetrics, nowMs: number): number {
    const baseline = this.#samples[firstAfter(this.#samples, nowMs - this.#windowMs, sampleTime) - 1];
    const closed = m.framesClosed - (baseline?.framesClosed ?? 0);
    const incomplete = m.incompleteFrames - (baseline?.incompleteFrames ?? 0);
    return closed > 0 ? (incomplete / closed) * 100 : 0;
  }
}
