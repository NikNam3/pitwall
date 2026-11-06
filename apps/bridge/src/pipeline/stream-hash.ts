// A fingerprint of everything a client would receive while a recording is replayed: equal hashes, equal streams.
import { createHash, type Hash } from 'node:crypto';
import { encodeMessage, TOPICS, type ServerMessage, type TopicName } from '@pitwall/contracts';
import { feedId, MAX_CARS } from '@pitwall/domain';
import type { Feature } from '../features/feature.ts';
import { FEATURES } from '../features/index.generated.ts';
import { TopicHub } from '../hub/topic-hub.ts';
import type { PacketSource, RawPacket } from '../input/packet-source.ts';
import { PwrecSource } from '../input/pwrec-source.ts';
import { createLogger } from '../log.ts';
import { effectiveConfig, recordingConfig } from '../feature-config.ts';
import { recordingTrack, TRACKS_DIR } from '../track-files/load.ts';
import { recordingDecisions } from './decision-sidecars.ts';
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

/** The topics a feature binds with a `select` (a calculator's with one, or any `bindLive`): only their value depends on the params. */
const selectedTopicsOf = (features: readonly Feature[]): ReadonlySet<TopicName> =>
  new Set(
    features.flatMap((feature) =>
      feature.topics.flatMap((binding) => (('from' in binding && binding.select !== undefined) || 'fromLive' in binding ? [binding.topic] : [])),
    ),
  );

/** The topics bound to a job's results. */
const jobTopicsOf = (features: readonly Feature[]): ReadonlySet<TopicName> =>
  new Set(features.flatMap((feature) => feature.topics.flatMap((binding) => ('fromJob' in binding ? [binding.topic] : []))));

/**
 * The hash (sha256, hex) of the messages one client receives, one `encodeMessage` line each, in their order. A job
 * topic's messages stay out: its results come from worker threads and arrive whenever a worker finishes, so the same
 * recording may deliver them at other points of the stream.
 */
export class StreamHash {
  readonly #jobTopics: ReadonlySet<TopicName>;
  readonly #hash: Hash = createHash('sha256');

  constructor(jobTopics: ReadonlySet<TopicName>) {
    this.#jobTopics = jobTopics;
  }

  /** One message the client received, with the topic of its subscription. */
  add(topic: TopicName, message: ServerMessage): void {
    if (!this.#jobTopics.has(topic)) this.#hash.update(`${encodeMessage(message)}\n`);
  }

  /** sha256, hex, of every message added so far that is no job topic's. */
  digest(): string {
    return this.#hash.digest('hex');
  }
}

/**
 * Replays `recordingPath` as fast as possible through the real pipeline, with the hub's clock on the record times,
 * and hashes through `StreamHash` every message one client subscribed to every feed topic receives. A topic bound with a
 * `select` (every `bindLive` topic too) is subscribed once per car with `paramsFor(car)`, so every car's value enters the hash (the player may drive
 * any car, and the analyses publish per car); a topic without one sends every subscriber the same value, so once is enough.
 * Global topics stay out: the bridge shell publishes them, not the replay.
 *
 * Job topics are subscribed too, so their jobs run as in a session with a client, but `StreamHash` leaves their
 * messages out. `features` replaces the registered features (default `FEATURES`). The recording's config, track, priors
 * and decisions sidecars apply, as in a replay.
 */
export async function topicStreamHash(recordingPath: string, { features = FEATURES }: { features?: readonly Feature[] } = {}): Promise<string> {
  const id = feedId('hash');
  let nowMs = 0;
  const hub = new TopicHub({ now: () => nowMs });
  const hash = new StreamHash(jobTopicsOf(features));
  /** The topic of each subscription id of the hash client. */
  const topicOf = new Map<string, TopicName>();
  hub.addClient('hash', { send: (message) => hash.add(subscriptionTopic(topicOf, message), message), bufferedAmount: () => 0 });
  const subscribe = (subscriptionId: string, topic: TopicName, carId: number) => {
    topicOf.set(subscriptionId, topic);
    hub.subscribe({ clientId: 'hash', id: subscriptionId, topic, params: paramsFor(carId), feedId: id });
  };
  const selected = selectedTopicsOf(features);
  for (const topic of Object.keys(TOPICS) as TopicName[]) {
    if (TOPICS[topic].scope !== 'feed') continue;
    if (!selected.has(topic)) subscribe(topic, topic, 0);
    else for (let carId = 0; carId < MAX_CARS; carId++) subscribe(`${topic}:${carId}`, topic, carId);
  }
  const source = new ObservedSource(new PwrecSource({ feedId: id, path: recordingPath, mode: 'asFastAsPossible' }), {
    before: (packet) => {
      nowMs = packet.receivedAtMs;
    },
    after: () => hub.tick(),
  });
  const log = createLogger({ level: 'silent' });
  const pipeline = new FeedPipeline({
    feedId: id,
    source,
    hub,
    features,
    config: recordingConfig(recordingPath, features, effectiveConfig(features)),
    tracks: (trackId) => recordingTrack(recordingPath, trackId, TRACKS_DIR, log),
    recorded: recordingDecisions(recordingPath, log),
    log,
  });
  pipeline.start();
  await pipeline.done;
  hub.tick();
  return hash.digest();
}

/** The topic of the subscription `message` is for; the hub sends the hash client nothing else. */
function subscriptionTopic(topicOf: ReadonlyMap<string, TopicName>, message: ServerMessage): TopicName {
  const topic = 'id' in message && message.id !== undefined ? topicOf.get(message.id) : undefined;
  if (topic === undefined) throw new Error(`the hash client received a message of no subscription: ${encodeMessage(message)}`);
  return topic;
}
