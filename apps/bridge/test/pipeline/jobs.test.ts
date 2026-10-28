// Jobs as part of features (groundwork task 7, review F2): a feature declares a job; the pipeline registers the quick
// calculator `job:<id>` for it (the job's reads and trigger, `compute` = `prepare`), hands its output to one JobRunner
// per pipeline, and publishes the result to the job's topic as `{ computedFor, value }`.
//
// The topic is `session.info`, a real state topic that these test features alone bind; the binding helper is widened
// to it because no contract topic carries a `Computed` value yet. Results come from real worker threads, so tests wait
// on the messages with a bounded `vi.waitFor`. The one thing that must not happen is waited out with a short sleep.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Computed, ServerMessage, TopicName } from '@pitwall/contracts';
import type { FeedId } from '@pitwall/domain';
import { createRng, type Cadence, type Dependency, type Job, type QuickCalculator } from '@pitwall/engine';
import { ScenarioBuilder, packetBytes } from '../../../../packages/engine/test/builders/index.ts';
import { bindJob, bindState, defineFeature, type Feature, type TopicBinding } from '../../src/features/feature.ts';
import { TopicHub } from '../../src/hub/topic-hub.ts';
import { jobSeed } from '../../src/jobs/job-runner.ts';
import { createLogger } from '../../src/log.ts';
import { FeedPipeline } from '../../src/pipeline/feed-pipeline.ts';
import type { AddRngInput } from '../jobs/fixtures/add-rng.ts';
import { ManualSource } from '../helpers/manual-source.ts';
import type { PreparedPacket } from '../helpers/array-source.ts';

const F = 'test' as FeedId;
const G = 'other' as FeedId;
const TOPIC: TopicName = 'session.info';
const WAIT = { timeout: 10_000 };

/** `bindJob` for a topic that does not (yet) carry `Computed<Out>`: the type check is what `typed-job-bindings.test.ts` covers. */
const bindTestJob = bindJob as unknown as (topic: TopicName, job: Job<unknown, unknown>) => TopicBinding;

/** What the job's `prepare` saw: the player's lap and the frame it ran in. */
type Seen = { lap: number; frameId: number };

/** A job whose worker resolves to `base + rng.next()`, declared in a feature of its own that binds it to `TOPIC`. */
function addRng(o: { trigger?: Cadence; reads?: Dependency[]; input?: Partial<AddRngInput> } = {}) {
  const prepared: Seen[] = [];
  const job: Job<AddRngInput, number> = {
    kind: 'job',
    id: 'add-rng',
    reads: o.reads ?? ['timing'],
    trigger: o.trigger ?? 'frame',
    prepare: ({ state }) => {
      prepared.push({ lap: state.cars[state.playerCar]!.timing.lap, frameId: state.lastFrameId });
      return { base: 1000, ...o.input };
    },
    module: new URL('../jobs/fixtures/add-rng.ts', import.meta.url),
  };
  const feature = defineFeature({ name: 'add-rng', calculators: [], topics: [bindTestJob(TOPIC, job)], jobs: [job] });
  return { job, feature, prepared };
}

/** A calculator that counts its runs; `topics` decides whether anything subscribes it. */
function probe(id: string, reads: Dependency[], cadence: Cadence, bound = false) {
  const counter = { runs: 0 };
  const calc: QuickCalculator<number> = { kind: 'quick', id, reads, cadence, compute: () => ++counter.runs };
  const feature = defineFeature({
    name: id,
    calculators: [calc],
    topics: bound ? [bindState('cars.overview', calc, () => undefined)] : [],
  });
  return { counter, feature };
}

const prepared = (builder: ScenarioBuilder): PreparedPacket[] =>
  builder.packets().map(({ packet, receivedAtMs }) => ({ bytes: packetBytes(packet), receivedAtMs }));
/** Two chunks of one session: `a` frames, then `b` more. */
function session(uid: bigint, a: number, b: number): [PreparedPacket[], PreparedPacket[]] {
  const builder = new ScenarioBuilder({ sessionUid: uid, cars: 2 }).frames(a, () => {});
  const first = builder.packets().length;
  builder.frames(b, () => {});
  const all = prepared(builder);
  return [all.slice(0, first), all.slice(first)];
}
const shifted = (packets: PreparedPacket[], ms: number): PreparedPacket[] => packets.map((p) => ({ ...p, receivedAtMs: p.receivedAtMs + ms }));

const pipelines: FeedPipeline[] = [];
afterEach(async () => {
  await Promise.all(pipelines.splice(0).map((p) => p.stop()));
});

/** One hub with the demand callback wired to the pipelines, as `serve` does, and one client that records what it gets. */
function world() {
  let t = 0;
  const running = new Map<FeedId, FeedPipeline>();
  const hub = new TopicHub({ now: () => (t += 1000), onDemandChange: (feedId) => running.get(feedId)?.demandChanged() });
  const inbox: ServerMessage[] = [];
  hub.addClient('c', { send: (m) => inbox.push(m), bufferedAmount: () => 0 });
  const logs: Array<Record<string, unknown>> = [];
  const log = createLogger({ level: 'debug', destination: { write: (line: string) => { logs.push(JSON.parse(line)); } } });

  const feed = (feedId: FeedId, features: Feature[]) => {
    const source = new ManualSource(feedId);
    const pipeline = new FeedPipeline({ feedId, source, hub, features, log });
    running.set(feedId, pipeline);
    pipelines.push(pipeline);
    pipeline.start();
    return { pipeline, push: (chunk: PreparedPacket[]) => chunk.forEach((p) => source.push(p.bytes, p.receivedAtMs)) };
  };
  const subscribe = (id: string, feedId: FeedId, topic: TopicName = TOPIC) => hub.subscribe({ clientId: 'c', id, topic, params: {}, feedId });
  const of = (id: string) => inbox.filter((m) => 'id' in m && m.id === id);
  /** The `Computed` values the client received on subscription `id`. */
  const valuesOf = (id: string) =>
    of(id).flatMap((m) => ((m.type === 'update' || m.type === 'snapshot') && m.value !== undefined ? [m.value as Computed<number>] : []));
  return { hub, feed, subscribe, of, valuesOf, logs };
}

/** What the fixture worker resolves to for a result computed for `computedFor` by a runner seeded `0`. */
const expectedValue = (base: number, computedFor: { lap: number; frameId: number }) => base + createRng(jobSeed(0, 'add-rng', computedFor)).next();

describe('FeedPipeline: a job declared in a feature', () => {
  it('a subscription triggers it, and the client gets { computedFor, value } computed with the seeded rng', async () => {
    const { feature, prepared: seen } = addRng();
    const w = world();
    const feed = w.feed(F, [feature]);
    w.subscribe('j', F);
    feed.push(session(77n, 20, 0)[0]);

    await vi.waitFor(() => expect(w.valuesOf('j').length).toBeGreaterThan(0), WAIT);
    const result = w.valuesOf('j').at(-1)!;
    expect(Object.keys(result).sort()).toEqual(['computedFor', 'value']);
    // The synchronous burst of frames leaves one run: the newest trigger supersedes the others.
    expect(seen.length).toBeGreaterThan(1);
    expect(seen.at(-1)!.lap).toBeGreaterThanOrEqual(1);
    expect(result.computedFor).toEqual(seen.at(-1));
    expect(result.value).toBe(expectedValue(1000, result.computedFor));
  });

  it('is triggered on its cadence, through the quick calculator job:<id> that has the job\'s reads', async () => {
    const trigger: Cadence = { hz: 2 };
    const { feature, prepared: seen } = addRng({ trigger, reads: ['timing'] });
    const twin = probe('twin', ['timing'], trigger); // no binding references it, so it runs on every due frame
    const w = world();
    const feed = w.feed(F, [feature, twin.feature]);
    w.subscribe('j', F);
    feed.push(session(77n, 150, 0)[0]);

    expect(twin.counter.runs).toBeGreaterThan(1);
    expect(seen.length).toBe(twin.counter.runs);
    expect(seen.length).toBeLessThan(150);
    await vi.waitFor(() => expect(w.valuesOf('j').length).toBeGreaterThan(0), WAIT);
  });

  it('what the job reads runs for it, and only while the job is needed', async () => {
    const dependency = probe('dependency', ['timing'], 'frame', true); // bound to cars.overview, so on demand
    const { feature, prepared: seen } = addRng({ reads: [{ calculator: 'dependency' }] });
    const w = world();
    const feed = w.feed(F, [dependency.feature, feature]);
    const [one, two] = session(77n, 10, 10);

    feed.push(one);
    expect(seen).toHaveLength(0);
    expect(dependency.counter.runs).toBe(0);

    w.subscribe('j', F);
    feed.push(two);
    expect(dependency.counter.runs).toBeGreaterThan(0);
    expect(seen.length).toBe(dependency.counter.runs);
    await vi.waitFor(() => expect(w.valuesOf('j').length).toBeGreaterThan(0), WAIT);
  });
});

describe('FeedPipeline: a job is demand driven', () => {
  it('without a subscriber it never runs, whatever else is subscribed', async () => {
    const { feature, prepared: seen } = addRng();
    const w = world();
    const feed = w.feed(F, [feature]);
    w.subscribe('l', F, 'laps');
    w.subscribe('o', F, 'cars.overview');
    w.subscribe('elsewhere', G); // the job's topic, but on another feed
    feed.push(session(77n, 30, 0)[0]);
    expect(seen).toHaveLength(0);
    expect(w.valuesOf('l')).toEqual([]);
  });

  it('subscribing mid-session starts it on the next frames, unsubscribing stops it', async () => {
    const { feature, prepared: seen } = addRng();
    const w = world();
    const feed = w.feed(F, [feature]);
    const [one, two] = session(77n, 10, 10);
    const three = session(77n, 20, 10)[1];

    feed.push(one);
    expect(seen).toHaveLength(0);

    w.subscribe('j', F);
    feed.push(two);
    expect(seen.length).toBeGreaterThan(0);

    w.hub.unsubscribe('c', 'j');
    const stopped = seen.length;
    feed.push(three);
    expect(seen).toHaveLength(stopped);
  });
});

describe('FeedPipeline: a job that fails', () => {
  it('marks the topic errored and logs the error', async () => {
    const { feature } = addRng({ input: { fail: true } });
    const w = world();
    const feed = w.feed(F, [feature]);
    w.subscribe('j', F);
    feed.push(session(77n, 10, 0)[0]);

    await vi.waitFor(() => expect(w.of('j').at(-1)).toEqual({ type: 'topicStatus', id: 'j', status: 'errored' }), WAIT);
    expect(w.valuesOf('j')).toEqual([]);
    expect(w.logs.some((l) => l['level'] === 50 && JSON.stringify(l).includes('boom from add-rng'))).toBe(true);
  });
});

describe('FeedPipeline: the lifetime of a job run', () => {
  it('a result that arrives after its session ended is dropped', async () => {
    const { feature, prepared: seen } = addRng({ input: { sleepMs: 400 } });
    const w = world();
    const feed = w.feed(F, [feature]);
    w.subscribe('j', F);
    feed.push(session(77n, 10, 0)[0]);
    expect(seen.length).toBeGreaterThan(0); // a run is under way in a worker

    w.hub.unsubscribe('c', 'j'); // nothing triggers again; the run of session 77 is the only one
    feed.push(shifted(session(78n, 10, 0)[0], 60_000)); // session 77 ends, session 78 starts
    w.subscribe('k', F); // a fresh subscriber of session 78 must not be handed session 77's result

    await new Promise((resolve) => setTimeout(resolve, 900)); // longer than the run; waiting out an absence
    expect(w.valuesOf('k')).toEqual([]);
    expect(w.valuesOf('j')).toEqual([]);
  });

  it('stopping the pipeline closes the runner: a run under way delivers nothing', async () => {
    const { feature, prepared: seen } = addRng({ input: { sleepMs: 300 } });
    const w = world();
    const feed = w.feed(F, [feature]);
    w.subscribe('j', F);
    feed.push(session(77n, 10, 0)[0]);
    expect(seen.length).toBeGreaterThan(0);

    await feed.pipeline.stop();
    await new Promise((resolve) => setTimeout(resolve, 700)); // longer than the run; waiting out an absence
    expect(w.valuesOf('j')).toEqual([]);
  });

  it('each pipeline has its own runner: two feeds with the same job get their own results', async () => {
    const forF = addRng({ input: { base: 1000 } });
    const forG = addRng({ input: { base: 2000 } });
    const w = world();
    const feedF = w.feed(F, [forF.feature]);
    const feedG = w.feed(G, [forG.feature]);
    w.subscribe('a', F);
    feedF.push(session(77n, 10, 0)[0]);
    feedG.push(session(88n, 10, 0)[0]);
    expect(forF.prepared.length).toBeGreaterThan(0);
    expect(forG.prepared).toHaveLength(0); // nobody asked for the job on feed G

    w.subscribe('b', G);
    feedG.push(session(88n, 10, 10)[1]);
    await vi.waitFor(() => expect(w.valuesOf('a').length > 0 && w.valuesOf('b').length > 0).toBe(true), WAIT);
    const a = w.valuesOf('a').at(-1)!;
    const b = w.valuesOf('b').at(-1)!;
    expect(a.value).toBe(expectedValue(1000, a.computedFor));
    expect(b.value).toBe(expectedValue(2000, b.computedFor));
  });
});
