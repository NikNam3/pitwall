// The work target of the live-state topics (C55 `bindLive`; the acceptance slowness diagnosis, section A): car.detail and
// car.telemetry copied every car on every frame through two calculators (`cars.state`, `cars.dynamics`), which the
// scheduler then froze. Bound with `bindLive`, they copy one car's slot per value the hub sends and nothing per frame.
// Counted, not timed (a slow path is fixed to a tested target, never to a timeout): on the 20-car full-lap race segment,
// with every car slot subscribed to both topics, the hub's clock on the record times and a flush after every packet
// (as `topicStreamHash` runs it), the selects copy at most one car's part per value sent, and no unit runs for them.
import { beforeAll, describe, expect, it } from 'vitest';
import type { ServerMessage, TopicName } from '@pitwall/contracts';
import { MAX_CARS, type FeedId } from '@pitwall/domain';
import { bindLive, defineFeature, type Feature } from '../../src/features/feature.ts';
import carDetail from '../../src/features/car-detail/register.ts';
import carTelemetry from '../../src/features/car-telemetry/register.ts';
import { createCalcStats, type CalcStat } from '../../src/dev/calc-stats.ts';
import { TopicHub } from '../../src/hub/topic-hub.ts';
import type { PacketSource, RawPacket } from '../../src/input/packet-source.ts';
import { PwrecSource } from '../../src/input/pwrec-source.ts';
import { createLogger } from '../../src/log.ts';
import { FeedPipeline } from '../../src/pipeline/feed-pipeline.ts';
import { segmentPath } from '../fixtures/replay.ts';

const F = 'work' as FeedId;
const SEGMENT = segmentPath('race-zandvoort-full-lap.pwrec.gz');
const TOPICS = ['car.detail', 'car.telemetry'] as const;
type LiveTopic = (typeof TOPICS)[number];

/** The budget: a select copies at most one car's part (its slot, or its motion and dynamics) per value the hub sends. */
const COPIES_PER_VALUE_SENT = 1;

/** The select a bindLive binding holds (`{ topic, fromLive }`), as `bindLive` was given it. */
type LiveSelect = (live: unknown, params: object) => unknown;
const liveSelectOf = (feature: Feature, topic: TopicName): LiveSelect =>
  (feature.topics.find((b) => b.topic === topic) as unknown as { fromLive: LiveSelect }).fromLive;

/** `feature` with its bindLive select wrapped by a counter of the car parts it copies (the calls that return a value). */
function counting(feature: Feature, topic: LiveTopic, copies: Record<LiveTopic, number>): Feature {
  const select = liveSelectOf(feature, topic);
  return defineFeature({
    ...feature,
    topics: [bindLive(topic, ((live: unknown, params: object) => {
      const value = select(live, params);
      if (value !== undefined) copies[topic]++;
      return value;
    }) as never)],
  });
}

/** Sets the hub's clock to each packet's record time before the pipeline takes it, and flushes the hub after. */
class ClockedSource implements PacketSource {
  readonly #inner: PacketSource;
  readonly #hooks: { before: (packet: RawPacket) => void; after: () => void };
  constructor(inner: PacketSource, hooks: { before: (packet: RawPacket) => void; after: () => void }) {
    this.#inner = inner;
    this.#hooks = hooks;
  }
  get feedId() { return this.#inner.feedId; }
  get done() { return this.#inner.done; }
  start(onPacket: (packet: RawPacket) => void): void {
    this.#inner.start((packet) => { this.#hooks.before(packet); onPacket(packet); this.#hooks.after(); });
  }
  stop(): Promise<void> { return this.#inner.stop(); }
}

let copies: Record<LiveTopic, number>;
let sent: Record<LiveTopic, number>;
/** The values sent per subscription id (`<topic>:<carId>`). */
let sentPer: Map<string, number>;
let stats: CalcStat[];

beforeAll(async () => {
  copies = { 'car.detail': 0, 'car.telemetry': 0 };
  sent = { 'car.detail': 0, 'car.telemetry': 0 };
  sentPer = new Map();
  let nowMs = 0;
  const hub = new TopicHub({ now: () => nowMs });
  const topicOf = new Map<string, LiveTopic>();
  hub.addClient('c', {
    send: (m: ServerMessage) => {
      if ((m.type !== 'snapshot' && m.type !== 'update') || !('value' in m)) return;
      sent[topicOf.get(m.id)!]++;
      sentPer.set(m.id, (sentPer.get(m.id) ?? 0) + 1);
    },
    bufferedAmount: () => 0,
  });
  for (const topic of TOPICS) {
    for (let carId = 0; carId < MAX_CARS; carId++) {
      topicOf.set(`${topic}:${carId}`, topic);
      hub.subscribe({ clientId: 'c', id: `${topic}:${carId}`, topic, params: { carId }, feedId: F });
    }
  }
  const calcStats = createCalcStats(() => 0);
  const source = new ClockedSource(new PwrecSource({ feedId: F, path: SEGMENT, mode: 'asFastAsPossible' }), {
    before: (packet) => { nowMs = packet.receivedAtMs; },
    after: () => hub.tick(),
  });
  const features = [counting(carDetail, 'car.detail', copies), counting(carTelemetry, 'car.telemetry', copies)];
  const pipeline = new FeedPipeline({ feedId: F, source, hub, features, log: createLogger({ level: 'silent' }), calcStats });
  pipeline.start();
  await pipeline.done;
  stats = calcStats.snapshot();
});

describe('the live-state topics on a 20-car race lap, every car subscribed', () => {
  it('every subscription gets values all lap long', () => {
    for (const topic of TOPICS) {
      for (let carId = 0; carId < MAX_CARS; carId++) expect(sentPer.get(`${topic}:${carId}`) ?? 0, `${topic} car ${carId}`).toBeGreaterThan(100);
    }
  });

  it(`the selects copy at most ${COPIES_PER_VALUE_SENT} car part per value sent (subscribed cars x flushes), nothing per frame`, () => {
    for (const topic of TOPICS) {
      expect(copies[topic], topic).toBeGreaterThan(0);
      expect(copies[topic], topic).toBeLessThanOrEqual(COPIES_PER_VALUE_SENT * sent[topic]);
    }
  });

  it('the scheduler runs no unit for them: no cars.state, no cars.dynamics, nothing at all', () => {
    const ran = stats.map((s) => s.id);
    expect(ran).not.toContain('cars.state');
    expect(ran).not.toContain('cars.dynamics');
    expect(ran).toEqual([]);
  });
});
