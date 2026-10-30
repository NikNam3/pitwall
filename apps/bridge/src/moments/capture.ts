// Named moments (spec 9.1): the topic values a client would hold at one point of a recording.
import { TOPICS, type MomentValues, type ServerMessage, type TopicName } from '@pitwall/contracts';
import { carId, feedId, MAX_CARS, type CarId } from '@pitwall/domain';
import { effectiveConfig, recordingConfig } from '../feature-config.ts';
import { FEATURES } from '../features/index.generated.ts';
import { TopicHub } from '../hub/topic-hub.ts';
import type { PacketSource, RawPacket } from '../input/packet-source.ts';
import { PwrecSource } from '../input/pwrec-source.ts';
import { createLogger } from '../log.ts';
import { FeedPipeline } from '../pipeline/feed-pipeline.ts';

export type { MomentValues };

/** Topics bound to a job: their results arrive from worker threads at arbitrary points, so a moment leaves them out. */
const JOB_TOPICS: ReadonlySet<TopicName> = new Set(
  FEATURES.flatMap((feature) => feature.topics.flatMap((binding) => ('fromJob' in binding ? [binding.topic] : []))),
);

/** Every car id a moment may hold. */
const ALL_CARS: readonly CarId[] = Array.from({ length: MAX_CARS }, (_, i) => carId(i));

/** The params a moment captures `topic` with, given the car ids it may hold: its `momentParams`, or `{}` alone. */
const paramsFor = (topic: TopicName, carIds: readonly CarId[]): object[] => {
  const { momentParams } = TOPICS[topic] as { momentParams?: (carIds: readonly CarId[]) => object[] };
  return momentParams?.(carIds) ?? [{}];
};

/** JSON with sorted object keys, so params that are equal give the same subscription id. */
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_k, v: unknown) =>
    typeof v === 'object' && v !== null && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : v,
  );

const subscriptionId = (topic: TopicName, params: object): string => `${topic}:${canonical(params)}`;

/** Hands packets on (with hooks around each) until one lies past `untilMs` (receive time from the first record), then stops the inner source. */
class StopAfterSource implements PacketSource {
  readonly #inner: PacketSource;
  readonly #untilMs: number;
  readonly #hooks: { before: (offsetMs: number) => void; after: () => void };
  #firstMs: number | undefined;

  constructor(inner: PacketSource, untilMs: number, hooks: { before: (offsetMs: number) => void; after: () => void }) {
    this.#inner = inner;
    this.#untilMs = untilMs;
    this.#hooks = hooks;
  }

  get feedId() {
    return this.#inner.feedId;
  }

  get done(): Promise<void> {
    return this.#inner.done;
  }

  start(onPacket: (packet: RawPacket) => void): void {
    this.#inner.start((packet) => {
      this.#firstMs ??= packet.receivedAtMs;
      const offsetMs = packet.receivedAtMs - this.#firstMs;
      if (offsetMs > this.#untilMs) {
        void this.#inner.stop();
        return;
      }
      this.#hooks.before(offsetMs);
      onPacket(packet);
      this.#hooks.after();
    });
  }

  stop(): Promise<void> {
    return this.#inner.stop();
  }
}

/**
 * Replays `segmentPath` through the real pipeline up to the records `atMs` after its first one (receive time) and
 * returns what one client subscribed to every feed topic holds then: each topic with the params its `momentParams` gives
 * for the active cars (`car.detail` `active`), in that order, or with `{}` when it has none. The hub's clock is the recorded time, so its throttle sees the recording's
 * pace and the run needs no real waiting. Deterministic: the same segment and `atMs` give the same JSON.
 */
export async function captureMoment(segmentPath: string, atMs: number): Promise<MomentValues> {
  const id = feedId('moment');
  let nowMs = 0;
  const hub = new TopicHub({ now: () => nowMs });
  const values = new Map<string, unknown>();
  const lists = new Map<string, unknown[]>();
  const send = (m: ServerMessage): void => {
    if (m.type === 'snapshot') {
      if (m.entries !== undefined) lists.set(m.id, [...m.entries]);
      else values.set(m.id, m.value);
    } else if (m.type === 'update') values.set(m.id, m.value);
    else if (m.type === 'append') lists.set(m.id, [...(lists.get(m.id) ?? []), ...m.entries]);
  };
  hub.addClient('moment', { send, bufferedAmount: () => 0 });

  const topics = (Object.keys(TOPICS) as TopicName[]).filter((topic) => TOPICS[topic].scope === 'feed' && !JOB_TOPICS.has(topic));
  for (const topic of topics) {
    for (const params of paramsFor(topic, ALL_CARS)) hub.subscribe({ clientId: 'moment', id: subscriptionId(topic, params), topic, params, feedId: id });
  }

  const source = new StopAfterSource(new PwrecSource({ feedId: id, path: segmentPath, mode: 'asFastAsPossible' }), atMs, {
    before: (offsetMs) => {
      nowMs = offsetMs;
    },
    after: () => hub.tick(),
  });
  const pipeline = new FeedPipeline({
    feedId: id,
    source,
    hub,
    features: FEATURES,
    config: recordingConfig(segmentPath, FEATURES, effectiveConfig(FEATURES)),
    log: createLogger({ level: 'silent' }),
  });
  pipeline.start();
  await pipeline.done;
  nowMs += 60_000; // every throttled value is due now
  hub.tick();

  const isActive = (car: CarId): boolean =>
    (values.get(subscriptionId('car.detail', { carId: car })) as { active?: boolean } | undefined)?.active === true;
  const active = ALL_CARS.filter(isActive);
  const moment: MomentValues = [];
  for (const topic of topics) {
    for (const params of paramsFor(topic, active)) {
      const key = subscriptionId(topic, params);
      if (TOPICS[topic].mode === 'append') moment.push({ topic, params, entries: lists.get(key) ?? [] });
      else if (values.has(key)) moment.push({ topic, params, value: values.get(key) });
    }
  }
  return moment;
}
