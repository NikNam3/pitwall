// Named moments (spec 9.1): the topic values a client would hold at one point of a recording.
import { canonicalJson, TOPICS, type MachineSpans, type MomentValues, type ServerMessage, type TopicName } from '@pitwall/contracts';
import { carId, feedId, MAX_CARS, type CarId } from '@pitwall/domain';
import { effectiveConfig, recordingConfig } from '../feature-config.ts';
import { FEATURES } from '../features/index.generated.ts';
import { TopicHub } from '../hub/topic-hub.ts';
import type { PacketSource, RawPacket } from '../input/packet-source.ts';
import { PwrecSource } from '../input/pwrec-source.ts';
import { createLogger } from '../log.ts';
import { recordingDecisions } from '../pipeline/decision-sidecars.ts';
import { FeedPipeline } from '../pipeline/feed-pipeline.ts';
import { recordingProfiles } from '../pipeline/profile-sidecar.ts';
import { recordingTrack, TRACKS_DIR } from '../track-files/load.ts';

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

const subscriptionId = (topic: TopicName, params: object): string => `${topic}:${canonicalJson(params)}`;

/**
 * Hands packets on (with hooks around each) until one lies past `untilMs` (receive time from the first record) or the
 * segment ends, then calls `stop` (the pipeline's). A moment is a point inside its session: the session is cut there,
 * not ended, so its topics keep what they held.
 */
class StopAfterSource implements PacketSource {
  readonly #inner: PacketSource;
  readonly #untilMs: number;
  readonly #hooks: { before: (offsetMs: number) => void; after: () => void; stop: () => Promise<void> };
  readonly done: Promise<void>;
  #firstMs: number | undefined;

  constructor(inner: PacketSource, untilMs: number, hooks: { before: (offsetMs: number) => void; after: () => void; stop: () => Promise<void> }) {
    this.#inner = inner;
    this.#untilMs = untilMs;
    this.#hooks = hooks;
    // Not awaited: the pipeline's stop waits for the pipeline, which waits for this.
    this.done = inner.done.then(() => {
      void hooks.stop();
    });
  }

  get feedId() {
    return this.#inner.feedId;
  }

  start(onPacket: (packet: RawPacket) => void): void {
    this.#inner.start((packet) => {
      this.#firstMs ??= packet.receivedAtMs;
      const offsetMs = packet.receivedAtMs - this.#firstMs;
      if (offsetMs > this.#untilMs) {
        void this.#hooks.stop();
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
 * for the cars in the session (car-status's open spans in `situation.carStatus` that are not `absent`, C43), in that
 * order, or with `{}` when it has none. The hub's clock is the recorded time, so its throttle sees the recording's
 * pace and the run needs no real waiting. The run takes the recording's priors and decisions sidecars, as a replay does
 * (C38, C76). Deterministic: the same segment, sidecars and `atMs` give the same JSON.
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
    stop: (): Promise<void> => pipeline.stop(),
  });
  const log = createLogger({ level: 'silent' });
  const pipeline = new FeedPipeline({
    feedId: id,
    source,
    hub,
    features: FEATURES,
    config: recordingConfig(segmentPath, FEATURES, effectiveConfig(FEATURES)),
    tracks: (trackId) => recordingTrack(segmentPath, trackId, TRACKS_DIR, log),
    // The recording's priors, decisions and profiles sidecars, as a replay reads them (C38, C62c, C76).
    recorded: recordingDecisions(segmentPath, log),
    recordedProfiles: recordingProfiles(segmentPath, log),
    log,
  });
  pipeline.start();
  await pipeline.done;
  nowMs += 60_000; // every throttled value is due now
  hub.tick();

  const carStatus = values.get(subscriptionId('situation.carStatus', {})) as MachineSpans | undefined;
  const inSession = new Set((carStatus?.open ?? []).flatMap((span) => (span.kind !== 'absent' && span.carId !== undefined ? [span.carId] : [])));
  const active = ALL_CARS.filter((car) => inSession.has(car));
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
