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
import { effectiveConfig, recordingConfig } from '../feature-config.ts';
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
 * The params of the subscription for car `carId`: every key a feature's `select` reads, naming that car (`carId`, the
 * lap board's `referenceCarId`), and the gapper's leader-average reference. A `select` ignores the keys it does not read.
 */
const paramsFor = (carId: number) => ({ carId, referenceCarId: carId, reference: { kind: 'leaderAverage' } });

/** The topics a feature binds with a `select`: only their value depends on the params. */
const selectedTopicsOf = (features: readonly Feature[]): ReadonlySet<TopicName> =>
  new Set(features.flatMap((feature) => feature.topics.flatMap((binding) => ('from' in binding && binding.select !== undefined ? [binding.topic] : []))));

/** The topics bound to a job's results. */
const jobTopicsOf = (features: readonly Feature[]): ReadonlySet<TopicName> =>
  new Set(features.flatMap((feature) => feature.topics.flatMap((binding) => ('fromJob' in binding ? [binding.topic] : []))));

/**
 * Replays `recordingPath` as fast as possible through the real pipeline, with the hub's clock on the record times,
 * and hashes (sha256, hex) every message one client subscribed to every feed topic receives. A topic bound with a
 * `select` is subscribed once per car with `paramsFor(car)`, so every car's value enters the hash (the player may drive
 * any car, and the analyses publish per car); a topic without one sends every subscriber the same value, so once is enough.
 * Global topics stay out: the bridge shell publishes them, not the replay.
 *
 * Job topics stay out: their results come from worker threads and arrive whenever a worker finishes, so the same
 * recording may deliver them at other points of the stream. They are not subscribed, so their jobs do not run.
 * `features` replaces the registered features (default `FEATURES`). The recording's config sidecar applies, as in a replay.
 */
export async function topicStreamHash(recordingPath: string, { features = FEATURES }: { features?: readonly Feature[] } = {}): Promise<string> {
  const id = feedId('hash');
  let nowMs = 0;
  const hub = new TopicHub({ now: () => nowMs });
  const hash = createHash('sha256');
  hub.addClient('hash', { send: (message) => hash.update(`${encodeMessage(message)}\n`), bufferedAmount: () => 0 });
  const subscribe = (subscriptionId: string, topic: TopicName, carId: number) =>
    hub.subscribe({ clientId: 'hash', id: subscriptionId, topic, params: paramsFor(carId), feedId: id });
  const jobTopics = jobTopicsOf(features);
  const selected = selectedTopicsOf(features);
  for (const topic of Object.keys(TOPICS) as TopicName[]) {
    if (TOPICS[topic].scope !== 'feed' || jobTopics.has(topic)) continue;
    if (!selected.has(topic)) subscribe(topic, topic, 0);
    else for (let carId = 0; carId < MAX_CARS; carId++) subscribe(`${topic}:${carId}`, topic, carId);
  }
  const source = new ObservedSource(new PwrecSource({ feedId: id, path: recordingPath, mode: 'asFastAsPossible' }), {
    before: (packet) => {
      nowMs = packet.receivedAtMs;
    },
    after: () => hub.tick(),
  });
  const pipeline = new FeedPipeline({ feedId: id, source, hub, features, config: recordingConfig(recordingPath, features, effectiveConfig(features)), log: createLogger({ level: 'silent' }) });
  pipeline.start();
  await pipeline.done;
  hub.tick();
  return hash.digest('hex');
}
