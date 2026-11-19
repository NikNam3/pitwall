// C49 (jobs always): in a session the bridge serves (`servesUi: true`, as `serve` builds every feed), a job and the
// units it reads run on their trigger throughout the session, whether a topic is subscribed or not; a job topic
// subscribed anew gets the job's latest result at once, marked with the frame it was computed for (`computedFor`).
//
// The topic is `session.info`, which these test features alone bind (as in `jobs.test.ts`). Results come from real
// worker threads. Without a subscriber nothing shows when a result has arrived, so the tests poll with fresh
// subscriptions, each of which must not start a run of its own (`seen` stays). What must not happen is waited out with a
// short sleep.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Computed, ServerMessage, TopicName } from '@pitwall/contracts';
import type { FeedId } from '@pitwall/domain';
import { createRng, type Cadence, type Dependency, type Job, type QuickCalculator } from '@pitwall/engine';
import { ScenarioBuilder, packetBytes } from '../../../../packages/engine/test/builders/index.ts';
import { bindJob, bindState, defineFeature, type Feature, type TopicBinding } from '../../src/features/feature.ts';
import { TopicHub } from '../../src/hub/topic-hub.ts';
import type { PacketSource, RawPacket } from '../../src/input/packet-source.ts';
import { jobSeed } from '../../src/jobs/job-runner.ts';
import { createLogger } from '../../src/log.ts';
import { FeedPipeline } from '../../src/pipeline/feed-pipeline.ts';
import type { AddRngInput } from '../jobs/fixtures/add-rng.ts';
import type { PreparedPacket } from '../helpers/array-source.ts';

const F = 'test' as FeedId;
const TOPIC: TopicName = 'session.info';
const WAIT = { timeout: 10_000 };
/** A job that runs on each Session packet: exactly one run per chunk below that carries one. */
const ON_SESSION: Cadence = { onChange: ['session'] };

/** `bindJob` for a topic that does not carry `Computed<Out>`: `typed-job-bindings.test.ts` covers the type check. */
const bindTestJob = bindJob as unknown as (topic: TopicName, job: Job<unknown, unknown>) => TopicBinding;

type Seen = { lap: number; frameId: number };

/** The job of `jobs.test.ts`: its worker resolves to `base + rng.next()`; `base()` is read at each `prepare`. */
function addRng(o: { trigger?: Cadence; reads?: Dependency[]; input?: Partial<AddRngInput>; base?: () => number } = {}) {
  const prepared: Seen[] = [];
  const job: Job<AddRngInput, number> = {
    kind: 'job',
    id: 'add-rng',
    reads: o.reads ?? ['timing'],
    trigger: o.trigger ?? ON_SESSION,
    prepare: ({ live }) => {
      prepared.push({ lap: live.cars[live.playerCar]!.timing.lap, frameId: live.lastFrameId });
      return { base: o.base?.() ?? 1000, ...o.input };
    },
    module: new URL('../jobs/fixtures/add-rng.ts', import.meta.url),
  };
  const feature = defineFeature({ name: 'add-rng', calculators: [], topics: [bindTestJob(TOPIC, job as Job<unknown, unknown>)], jobs: [job as Job<unknown, unknown>] });
  return { feature, prepared };
}

/** A calculator bound to `cars.overview` (so on demand) that counts its runs. */
function dependency() {
  const counter = { runs: 0 };
  const calc: QuickCalculator<number> = { kind: 'quick', id: 'dependency', reads: ['timing'], cadence: 'frame', compute: () => ++counter.runs };
  return { counter, feature: defineFeature({ name: 'dependency', calculators: [calc], topics: [bindState('cars.overview', calc, () => undefined)] }) };
}

/** A live-like source whose input can end (`end()`, the end of input, not a stop): the session then ends as at its end. */
class EndableSource implements PacketSource {
  readonly feedId: FeedId;
  readonly done: Promise<void>;
  #resolve!: () => void;
  #onPacket: ((p: RawPacket) => void) | undefined;
  #ended = false;

  constructor(feedId: FeedId) {
    this.feedId = feedId;
    this.done = new Promise((resolve) => { this.#resolve = resolve; });
  }

  start(on: (p: RawPacket) => void): void {
    this.#onPacket = on;
  }

  push(chunk: readonly PreparedPacket[] | undefined): void {
    if (chunk === undefined) throw new Error('no such chunk');
    for (const p of chunk) if (!this.#ended) this.#onPacket?.({ feedId: this.feedId, bytes: p.bytes, receivedAtMs: p.receivedAtMs });
  }

  end(): void {
    this.#ended = true;
    this.#resolve();
  }

  async stop(): Promise<void> {
    this.end();
  }
}

/**
 * One session of 2 cars in chunks of `sizes` frames; a chunk after the first starts with a Session packet when
 * `session[i]` (the first always carries the session's first one).
 */
function chunks(sizes: readonly number[], session: readonly boolean[] = []): PreparedPacket[][] {
  const builder = new ScenarioBuilder({ sessionUid: 77n, cars: 2 });
  const ends: number[] = [];
  sizes.forEach((n, i) => {
    if (i > 0 && session[i] === true) builder.session();
    builder.frames(n, () => {});
    ends.push(builder.packets().length);
  });
  const all = builder.packets().map(({ packet, receivedAtMs }) => ({ bytes: packetBytes(packet), receivedAtMs }));
  return ends.map((end, i) => all.slice(i === 0 ? 0 : ends[i - 1], end));
}

const pipelines: FeedPipeline[] = [];
afterEach(async () => {
  await Promise.all(pipelines.splice(0).map((p) => p.stop()));
});

/** A hub wired to one served pipeline as `serve` wires it, and one client that records what it gets. */
function served(features: Feature[]) {
  let t = 0;
  let pipeline: FeedPipeline | undefined = undefined;
  const hub = new TopicHub({ now: () => (t += 1000), onDemandChange: (feedId) => { if (feedId === F) pipeline?.demandChanged(); } });
  const inbox: ServerMessage[] = [];
  hub.addClient('c', { send: (m) => inbox.push(m), bufferedAmount: () => 0 });
  const source = new EndableSource(F);
  pipeline = new FeedPipeline({ feedId: F, source, hub, features, log: createLogger({ level: 'silent' }), servesUi: true });
  pipelines.push(pipeline);
  pipeline.start();
  const of = (id: string) => inbox.filter((m) => 'id' in m && m.id === id);
  let polls = 0;
  /** Subscribes anew until the first message of a fresh subscription carries a value; that value. */
  const firstValue = async (): Promise<Computed<number>> =>
    vi.waitFor(() => {
      const id = `poll-${polls++}`;
      hub.subscribe({ clientId: 'c', id, topic: TOPIC, params: {}, feedId: F });
      const first = of(id)[0];
      hub.unsubscribe('c', id);
      if (first === undefined || first.type !== 'snapshot' || first.value === undefined) throw new Error(`no value in ${JSON.stringify(first)}`);
      return first.value as Computed<number>;
    }, WAIT);
  return { hub, pipeline: pipeline as FeedPipeline, source, of, firstValue };
}

/** What the fixture worker resolves to for a result computed for `computedFor` by a runner seeded `0`. */
const expectedValue = (base: number, computedFor: Seen) => base + createRng(jobSeed(0, 'add-rng', computedFor)).next();

describe('FeedPipeline serving the UI: jobs always (C49)', { timeout: 30_000 }, () => {
  it('with no subscriber the job runs on its trigger through the session, and what it reads runs for it', async () => {
    const { feature, prepared: seen } = addRng({ reads: [{ calculator: 'dependency' }] });
    const reads = dependency();
    const w = served([reads.feature, feature]);
    const [one, two, three] = chunks([10, 10, 10], [true, false, true]);

    w.source.push(one);
    expect(seen).toHaveLength(1);
    expect(reads.counter.runs).toBeGreaterThan(0);

    w.source.push(two);
    expect(seen).toHaveLength(1); // no Session packet: no trigger

    w.source.push(three);
    expect(seen).toHaveLength(2);
    // the result is published although nobody subscribed: a fresh subscriber finds it
    const latest = await vi.waitFor(async () => {
      const value = await w.firstValue();
      expect(value.computedFor).toEqual(seen[1]);
      return value;
    }, WAIT);
    expect(latest.value).toBe(expectedValue(1000, latest.computedFor));
    expect(seen).toHaveLength(2); // subscribing started no run
  });

  it('a client subscribing mid-session gets the latest { computedFor, value } in its first message, before any new frame', async () => {
    const { feature, prepared: seen } = addRng();
    const w = served([feature]);
    const [one] = chunks([20]);

    w.source.push(one);
    expect(seen).toHaveLength(1);
    const first = await w.firstValue();
    expect(Object.keys(first).sort()).toEqual(['computedFor', 'value']);
    expect(first.computedFor).toEqual(seen[0]);
    expect(first.value).toBe(expectedValue(1000, first.computedFor));
    expect(seen).toHaveLength(1); // the first message holds the result of the run before it; no frame, no new run

    // A client that stays gets it as its snapshot too.
    w.hub.subscribe({ clientId: 'c', id: 'j', topic: TOPIC, params: {}, feedId: F });
    expect(w.of('j')[0]).toEqual({ type: 'snapshot', id: 'j', value: first });
  });

  it('after the session ends a late subscriber still gets the last result (R9)', async () => {
    const { feature, prepared: seen } = addRng();
    const w = served([feature]);
    const [one] = chunks([20]);

    w.source.push(one);
    const last = await w.firstValue();
    w.source.end(); // the end of input ends the session
    await w.pipeline.done;

    w.hub.subscribe({ clientId: 'c', id: 'late', topic: TOPIC, params: {}, feedId: F });
    expect(w.of('late')[0]).toEqual({ type: 'snapshot', id: 'late', value: last });
    expect(last.computedFor).toEqual(seen.at(-1));
  });

  it('before its first result the topic carries no value', () => {
    const { feature } = addRng({ input: { sleepMs: 400 } });
    const w = served([feature]);
    w.source.push(chunks([10])[0]);
    w.hub.subscribe({ clientId: 'c', id: 'early', topic: TOPIC, params: {}, feedId: F });
    const first = w.of('early')[0];
    expect(first !== undefined && first.type === 'snapshot' ? first.value : undefined).toBeUndefined();
  });
});

/** Frames 0..59, then the game rewinds to frame 30: `frameIdentifier` goes back while `overallFrameIdentifier` rises. */
function flashback(): { before: PreparedPacket[]; after: PreparedPacket[] } {
  const toPrepared = (packets: ReturnType<ScenarioBuilder['packets']>) => packets.map(({ packet, receivedAtMs }) => ({ bytes: packetBytes(packet), receivedAtMs }));
  const original = new ScenarioBuilder({ sessionUid: 77n, cars: 2 }).session().participants().frames(60, () => {});
  const continuation = new ScenarioBuilder({ sessionUid: 77n, cars: 2 }).session().participants().frames(80, () => {}).packets()
    .filter((p) => p.packet.header.frameIdentifier > 30 && p.packet.header.frameIdentifier < 80);
  const rewound = continuation.map(({ packet, receivedAtMs }) => ({
    packet: { ...packet, header: { ...packet.header, overallFrameIdentifier: packet.header.frameIdentifier + 29 } },
    receivedAtMs: receivedAtMs + 29 * 16,
  }));
  return { before: toPrepared(original.packets()), after: toPrepared(rewound) };
}

describe('FeedPipeline serving the UI: a flashback and the job (C30, C49)', { timeout: 30_000 }, () => {
  it('a flashback cancels the run under way and the job is triggered again on the new timeline, with no subscriber', async () => {
    // The input names the timeline: 1000 before the flashback, 5000 after it.
    let base = 1000;
    const { feature, prepared: seen } = addRng({ trigger: 'frame', input: { sleepMs: 400 }, base: () => base });
    const w = served([feature]);
    const { before, after } = flashback();

    w.source.push(before);
    const triggeredBefore = seen.length;
    expect(triggeredBefore).toBeGreaterThan(0); // a run is under way in a worker
    base = 5000;
    w.source.push(after); // the flashback, then frames that trigger the job again
    expect(seen.length).toBeGreaterThan(triggeredBefore);

    const first = await w.firstValue();
    expect(first.value).toBeGreaterThanOrEqual(5000);
    await new Promise((resolve) => setTimeout(resolve, 900)); // longer than a run; waiting out a late stale result
    const later = await w.firstValue();
    expect(later.value).toBeGreaterThanOrEqual(5000);
    expect(later.value).toBe(expectedValue(5000, later.computedFor));
  });
});
