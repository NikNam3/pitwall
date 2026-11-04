// The publishing cost of the situation topics (ruling 3 of Task 23; C49, C55 `bindSituation`). Counted, not timed (a
// slow path is fixed to a tested target, never to a timeout): on the 20-car full-lap race segment, with every situation
// topic but one subscribed, the hub's clock on the record times and a flush after every packet (as `topicStreamHash`
// runs it), the publisher hands the hub at most one value per frame for each subscribed topic (frames x subscribed
// topics in all), nothing for the topic no one subscribed, and the scheduler runs no unit for them. A value carries the
// machine's open spans only (contracts 0f4caa8): closed-span lists resent at 4 Hz reached 181-205 kB/s.
import { beforeAll, describe, expect, it } from 'vitest';
import type { ServerMessage, TopicName } from '@pitwall/contracts';
import { SPAN_DECLARATIONS, type FeedId, type MachineId } from '@pitwall/domain';
import { createCalcStats, type CalcStat } from '../../../src/dev/calc-stats.ts';
import { FEATURES } from '../../../src/features/index.generated.ts';
import { TopicHub, type ValueFor } from '../../../src/hub/topic-hub.ts';
import type { PacketSource, RawPacket } from '../../../src/input/packet-source.ts';
import { PwrecSource } from '../../../src/input/pwrec-source.ts';
import { createLogger } from '../../../src/log.ts';
import { FeedPipeline } from '../../../src/pipeline/feed-pipeline.ts';
import { segmentPath, trackFile } from '../../fixtures/replay.ts';

const F = 'work' as FeedId;
const SEGMENT = segmentPath('race-zandvoort-full-lap.pwrec.gz');

/** The budget: at most one value handed to the hub per frame for each subscribed situation topic. */
const PUBLISHES_PER_FRAME = 1;

const topicOf = (machine: MachineId): TopicName => `situation.${machine.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())}` as TopicName;
const SITUATION_TOPICS = SPAN_DECLARATIONS.map((d) => topicOf(d.machine));
/** The one situation topic no one subscribes to; zone-flags has spans all race long. */
const UNSUBSCRIBED = topicOf('zone-flags');
const SUBSCRIBED = SITUATION_TOPICS.filter((topic) => topic !== UNSUBSCRIBED);
/** The shared and race sub-machines (C17): each has spans in a race, so its topic gets values. */
const RACE_MACHINES: readonly MachineId[] = [
  'clock', 'weekend-phase', 'car-location', 'car-status', 'car-flags', 'warnings', 'lap-validity',
  'session-phase-race', 'race-control-race', 'car-activity-race', 'penalties', 'compound-rule',
];

/** A hub that counts, per situation topic, the values a publisher hands it and the times it evaluates one. */
class CountingHub extends TopicHub {
  readonly published = new Map<TopicName, number>();
  readonly evaluated = new Map<TopicName, number>();
  override publishState(feedId: FeedId | undefined, topic: TopicName, valueFor: ValueFor): void {
    if (!topic.startsWith('situation.')) return super.publishState(feedId, topic, valueFor);
    this.published.set(topic, (this.published.get(topic) ?? 0) + 1);
    super.publishState(feedId, topic, (params) => {
      this.evaluated.set(topic, (this.evaluated.get(topic) ?? 0) + 1);
      return valueFor(params);
    });
  }
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

let hub: CountingHub;
let frames: number;
/** The values sent per subscription (its id is the topic's name). */
let sent: Map<string, number>;
/** Per situation topic, the keys its values had and the spans in them that had ended (none may). */
let keys: Map<string, Set<string>>;
let ended: number;
let stats: CalcStat[];

beforeAll(async () => {
  frames = (await trackFile(SEGMENT)).frames;
  sent = new Map();
  keys = new Map();
  ended = 0;
  let nowMs = 0;
  hub = new CountingHub({ now: () => nowMs });
  hub.addClient('c', {
    send: (m: ServerMessage) => {
      if ((m.type !== 'snapshot' && m.type !== 'update') || !('value' in m)) return;
      sent.set(m.id, (sent.get(m.id) ?? 0) + 1);
      const value = m.value as Record<string, unknown>;
      const seen = keys.get(m.id) ?? new Set<string>();
      for (const key of Object.keys(value)) seen.add(key);
      keys.set(m.id, seen);
      const open = Array.isArray(value['open']) ? (value['open'] as object[]) : [];
      ended += open.filter((span) => 'end' in span || 'endFrame' in span).length;
    },
    bufferedAmount: () => 0,
  });
  for (const topic of SUBSCRIBED) hub.subscribe({ clientId: 'c', id: topic, topic, params: {}, feedId: F });
  const situations = FEATURES.find((f) => f.name === 'situations');
  if (situations === undefined) throw new Error('no feature "situations" in the generated feature index');
  const calcStats = createCalcStats(() => 0);
  const source = new ClockedSource(new PwrecSource({ feedId: F, path: SEGMENT, mode: 'asFastAsPossible' }), {
    before: (packet) => { nowMs = packet.receivedAtMs; },
    after: () => hub.tick(),
  });
  const pipeline = new FeedPipeline({ feedId: F, source, hub, features: [situations], log: createLogger({ level: 'silent' }), calcStats });
  pipeline.start();
  await pipeline.done;
  stats = calcStats.snapshot();
});

describe('the situation topics on a 20-car race lap, every topic but one subscribed', () => {
  it('the topic of every shared and race sub-machine gets values all lap long', () => {
    expect(frames).toBeGreaterThan(1000);
    for (const machine of RACE_MACHINES) {
      const topic = topicOf(machine);
      if (topic !== UNSUBSCRIBED) expect(sent.get(topic) ?? 0, topic).toBeGreaterThan(0);
    }
  });

  it(`the publisher hands the hub at most ${PUBLISHES_PER_FRAME} value per frame per subscribed topic (frames x subscribed topics)`, () => {
    let total = 0;
    for (const topic of SUBSCRIBED) {
      const published = hub.published.get(topic) ?? 0;
      expect(published, topic).toBeLessThanOrEqual(PUBLISHES_PER_FRAME * frames);
      total += published;
    }
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThanOrEqual(PUBLISHES_PER_FRAME * frames * SUBSCRIBED.length);
  });

  it('every value sent carries the open spans only: the one key open, no span that has ended', () => {
    expect(keys.size).toBeGreaterThan(0);
    for (const [topic, seen] of keys) expect([...seen], topic).toEqual(['open']);
    expect(ended).toBe(0);
  });

  it('the topic no one subscribed is never published and its value never built', () => {
    expect(hub.published.get(UNSUBSCRIBED) ?? 0).toBe(0);
    expect(hub.evaluated.get(UNSUBSCRIBED) ?? 0).toBe(0);
    expect(sent.get(UNSUBSCRIBED) ?? 0).toBe(0);
  });

  it('the scheduler runs no unit for them', () => {
    expect(stats.map((s) => s.id)).toEqual([]);
  });
});
