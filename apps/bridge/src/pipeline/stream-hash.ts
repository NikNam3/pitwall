// A fingerprint of everything a client would receive while a recording is replayed: equal hashes, equal streams.
import { createHash } from 'node:crypto';
import { encodeMessage, TOPICS, type TopicName } from '@pitwall/contracts';
import { feedId } from '@pitwall/domain';
import { FEATURES } from '../features/index.generated.ts';
import { TopicHub } from '../hub/topic-hub.ts';
import type { PacketSource, RawPacket } from '../input/packet-source.ts';
import { PwrecSource } from '../input/pwrec-source.ts';
import { createLogger } from '../log.ts';
import { FeedPipeline } from './feed-pipeline.ts';

/** Hands every packet on, then calls `after` with it: the hook that runs the hub's clock and ticks per packet. */
class ObservedSource implements PacketSource {
  readonly #inner: PacketSource;
  readonly #before: (packet: RawPacket) => void;
  readonly #after: () => void;

  constructor(inner: PacketSource, hooks: { before: (packet: RawPacket) => void; after: () => void }) {
    this.#inner = inner;
    this.#before = hooks.before;
    this.#after = hooks.after;
  }

  get feedId() {
    return this.#inner.feedId;
  }

  get done(): Promise<void> {
    return this.#inner.done;
  }

  start(onPacket: (packet: RawPacket) => void): void {
    this.#inner.start((packet) => {
      this.#before(packet);
      onPacket(packet);
      this.#after();
    });
  }

  stop(): Promise<void> {
    return this.#inner.stop();
  }
}

/**
 * Replays `recordingPath` as fast as possible through the real pipeline, with the hub's clock on the record times,
 * and hashes (sha256, hex) every message one client subscribed to every topic receives. Per-car topics follow car 0;
 * the other topics ignore the `carId` param.
 */
export async function topicStreamHash(recordingPath: string): Promise<string> {
  const id = feedId('hash');
  let nowMs = 0;
  const hub = new TopicHub({ now: () => nowMs });
  const hash = createHash('sha256');
  hub.addClient('hash', { send: (message) => hash.update(`${encodeMessage(message)}\n`), bufferedAmount: () => 0 });
  for (const topic of Object.keys(TOPICS) as TopicName[]) {
    hub.subscribe({ clientId: 'hash', id: topic, topic, params: { carId: 0 }, feedId: id });
  }
  const source = new ObservedSource(new PwrecSource({ feedId: id, path: recordingPath, mode: 'asFastAsPossible' }), {
    before: (packet) => {
      nowMs = packet.receivedAtMs;
    },
    after: () => hub.tick(),
  });
  const pipeline = new FeedPipeline({ feedId: id, source, hub, features: FEATURES, log: createLogger({ level: 'silent' }) });
  pipeline.start();
  await pipeline.done;
  hub.tick();
  return hash.digest('hex');
}
