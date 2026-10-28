// A fingerprint of everything a client would receive while a recording is replayed: equal hashes, equal streams.
import { createHash } from 'node:crypto';
import { encodeMessage, TOPICS, type TopicName } from '@pitwall/contracts';
import { feedId, MAX_CARS } from '@pitwall/domain';
import type { Feature } from '../features/feature.ts';
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

/** The topics whose value depends on the `carId` param. */
const PER_CAR_TOPICS: ReadonlySet<TopicName> = new Set(['car.detail', 'car.telemetry']);

/** The topics bound to a job's results. */
const jobTopicsOf = (features: readonly Feature[]): ReadonlySet<TopicName> =>
  new Set(features.flatMap((feature) => feature.topics.flatMap((binding) => ('fromJob' in binding ? [binding.topic] : []))));

/**
 * Replays `recordingPath` as fast as possible through the real pipeline, with the hub's clock on the record times,
 * and hashes (sha256, hex) every message one client subscribed to every topic receives. Per-car topics are subscribed
 * once per car, so the player's own data enters the hash whichever car they drive; the other topics ignore `carId`.
 *
 * Job topics stay out: their results come from worker threads and arrive whenever a worker finishes, so the same
 * recording may deliver them at other points of the stream. They are not subscribed, so their jobs do not run.
 * `features` replaces the registered features (default `FEATURES`).
 */
export async function topicStreamHash(recordingPath: string, { features = FEATURES }: { features?: readonly Feature[] } = {}): Promise<string> {
  const id = feedId('hash');
  let nowMs = 0;
  const hub = new TopicHub({ now: () => nowMs });
  const hash = createHash('sha256');
  hub.addClient('hash', { send: (message) => hash.update(`${encodeMessage(message)}\n`), bufferedAmount: () => 0 });
  const subscribe = (subscriptionId: string, topic: TopicName, carId: number) =>
    hub.subscribe({ clientId: 'hash', id: subscriptionId, topic, params: { carId }, feedId: id });
  const jobTopics = jobTopicsOf(features);
  for (const topic of Object.keys(TOPICS) as TopicName[]) {
    if (jobTopics.has(topic)) continue;
    if (!PER_CAR_TOPICS.has(topic)) subscribe(topic, topic, 0);
    else for (let carId = 0; carId < MAX_CARS; carId++) subscribe(`${topic}:${carId}`, topic, carId);
  }
  const source = new ObservedSource(new PwrecSource({ feedId: id, path: recordingPath, mode: 'asFastAsPossible' }), {
    before: (packet) => {
      nowMs = packet.receivedAtMs;
    },
    after: () => hub.tick(),
  });
  const pipeline = new FeedPipeline({ feedId: id, source, hub, features, log: createLogger({ level: 'silent' }) });
  pipeline.start();
  await pipeline.done;
  hub.tick();
  return hash.digest('hex');
}
