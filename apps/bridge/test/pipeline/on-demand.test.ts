// Calculators run on demand (spec 7.3, review F1): the ones a subscribed topic is bound to, the ones no binding
// references (they exist for insights), and what those read. Observed by counting the test calculators' runs.
import { describe, expect, it } from 'vitest';
import type { FeedId } from '@pitwall/domain';
import type { IncrementalCalculator, QuickCalculator } from '@pitwall/engine';
import { ScenarioBuilder, packetBytes } from '../../../../packages/engine/test/builders/index.ts';
import { bindState, defineFeature, type Feature } from '../../src/features/feature.ts';
import { TopicHub } from '../../src/hub/topic-hub.ts';
import { createLogger } from '../../src/log.ts';
import { FeedPipeline } from '../../src/pipeline/feed-pipeline.ts';
import { ArraySource, type PreparedPacket } from '../helpers/array-source.ts';
import { ManualSource } from '../helpers/manual-source.ts';

const F = 'test' as FeedId;
const OTHER = 'other' as FeedId;
const FTLP = { code: 'FTLP', vehicleIdx: 0, lapTime: 80 } as const;

type Timed = ReturnType<ScenarioBuilder['packets']>;
const toPrepared = (packets: Timed): PreparedPacket[] => packets.map(({ packet, receivedAtMs }) => ({ bytes: packetBytes(packet), receivedAtMs }));
const shifted = (packets: PreparedPacket[], ms: number): PreparedPacket[] => packets.map((p) => ({ ...p, receivedAtMs: p.receivedAtMs + ms }));

/** One session as three chunks of ten frames each; the fastest-lap event falls into the first. */
function session(uid: bigint): [PreparedPacket[], PreparedPacket[], PreparedPacket[]] {
  const builder = new ScenarioBuilder({ sessionUid: uid, cars: 2 });
  builder.frames(5, () => {}).event(FTLP).frames(5, () => {});
  const first = builder.packets().length;
  builder.frames(10, () => {});
  const second = builder.packets().length;
  builder.frames(10, () => {});
  const all = toPrepared(builder.packets());
  return [all.slice(0, first), all.slice(first, second), all.slice(second)];
}

/**
 * Three calculators, counted:
 * - `probe.base` feeds `session.info` (a binding references it),
 * - `probe.derived` feeds `cars.overview` and reads `probe.base`,
 * - `probe.free` is referenced by no binding.
 * All three read `feed`, so each runs on every frame it is needed.
 */
function probes() {
  const runs = { base: 0, derived: 0, free: 0 };
  const base: QuickCalculator<number> = { kind: 'quick', id: 'probe.base', reads: ['feed'], cadence: 'frame', compute: () => ++runs.base };
  const derived: QuickCalculator<number> = {
    kind: 'quick', id: 'probe.derived', reads: [{ calculator: 'probe.base' }], cadence: 'frame', compute: () => ++runs.derived,
  };
  const free: QuickCalculator<number> = { kind: 'quick', id: 'probe.free', reads: ['feed'], cadence: 'frame', compute: () => ++runs.free };
  const features: Feature[] = [
    defineFeature({ name: 'probe-base', calculators: [base], topics: [bindState('session.info', base, () => undefined)] }),
    defineFeature({ name: 'probe-derived', calculators: [derived], topics: [bindState('cars.overview', derived, () => undefined)] }),
    defineFeature({ name: 'probe-free', calculators: [free], topics: [] }),
  ];
  return { runs, features };
}

/** The hub's one callback is wired to the pipeline, as `serve` and `processRecording` do. */
function setup(source: ManualSource | ArraySource, features: Feature[]) {
  let t = 0;
  const hub = new TopicHub({ now: () => (t += 1000), onDemandChange: (feedId) => { if (feedId === F) pipeline.demandChanged(); } });
  for (const clientId of ['c', 'd']) hub.addClient(clientId, { send: () => {}, bufferedAmount: () => 0 });
  const pipeline = new FeedPipeline({ feedId: F, source, hub, features, log: createLogger({ level: 'silent' }) });
  const subscribe = (clientId: string, id: string, topic: Parameters<TopicHub['subscribe']>[0]['topic'], feedId = F) =>
    hub.subscribe({ clientId, id, topic, params: {}, feedId });
  return { hub, pipeline, subscribe };
}

async function runAll(packets: PreparedPacket[], features: Feature[], before: (s: ReturnType<typeof setup>) => void = () => {}) {
  const s = setup(new ArraySource(F, packets), features);
  before(s);
  s.pipeline.start();
  await s.pipeline.done;
  return s;
}

const everything = () => session(77n).flat();

describe('FeedPipeline: calculators on demand', () => {
  it('without subscribers only the calculators no binding references run', async () => {
    const { runs, features } = probes();
    await runAll(everything(), features);
    expect(runs.free).toBeGreaterThan(0);
    expect(runs.base).toBe(0);
    expect(runs.derived).toBe(0);
  });

  it('a subscription made before the session starts runs the bound calculator and what it reads', async () => {
    const { runs, features } = probes();
    await runAll(everything(), features, (s) => s.subscribe('c', 'a', 'cars.overview'));
    expect(runs.derived).toBeGreaterThan(0);
    expect(runs.base).toBe(runs.derived);
    expect(runs.free).toBeGreaterThan(0);
  });

  it('a subscription to a topic bound to a read-only dependency runs that one alone', async () => {
    const { runs, features } = probes();
    await runAll(everything(), features, (s) => s.subscribe('c', 'a', 'session.info'));
    expect(runs.base).toBeGreaterThan(0);
    expect(runs.derived).toBe(0);
  });

  it('a subscription to a topic that is not bound to a calculator starts none', async () => {
    const { runs, features } = probes();
    await runAll(everything(), features, (s) => { s.subscribe('c', 'a', 'laps'); s.subscribe('c', 'b', 'insights'); });
    expect(runs.base).toBe(0);
    expect(runs.derived).toBe(0);
    expect(runs.free).toBeGreaterThan(0);
  });

  it('a subscription on another feed starts nothing here', async () => {
    const { runs, features } = probes();
    await runAll(everything(), features, (s) => s.subscribe('c', 'a', 'cars.overview', OTHER));
    expect(runs.derived).toBe(0);
    expect(runs.base).toBe(0);
  });

  it('subscribing mid-session starts the calculator on the next frames, unsubscribing stops it', async () => {
    const { runs, features } = probes();
    const source = new ManualSource(F);
    const { pipeline, hub, subscribe } = setup(source, features);
    const [one, two, three] = session(77n);
    pipeline.start();
    const push = (chunk: PreparedPacket[]) => chunk.forEach((p) => source.push(p.bytes, p.receivedAtMs));

    push(one);
    expect(runs.free).toBeGreaterThan(0);
    expect(runs.derived).toBe(0);

    subscribe('c', 'a', 'cars.overview');
    const freeBefore = runs.free;
    push(two);
    expect(runs.derived).toBeGreaterThan(0);
    expect(runs.base).toBeGreaterThan(0);
    expect(runs.free).toBeGreaterThan(freeBefore);

    hub.unsubscribe('c', 'a');
    const stopped = { ...runs };
    push(three);
    expect(runs.derived).toBe(stopped.derived);
    expect(runs.base).toBe(stopped.base);
    expect(runs.free).toBeGreaterThan(stopped.free);
    await pipeline.stop();
  });

  it('removeClient stops what only that client needed', async () => {
    const { runs, features } = probes();
    const source = new ManualSource(F);
    const { pipeline, hub, subscribe } = setup(source, features);
    const [one, two, three] = session(77n);
    pipeline.start();
    const push = (chunk: PreparedPacket[]) => chunk.forEach((p) => source.push(p.bytes, p.receivedAtMs));

    subscribe('c', 'a', 'cars.overview');
    push(one);
    expect(runs.derived).toBeGreaterThan(0);
    hub.removeClient('c');
    const stopped = runs.derived;
    push(two);
    expect(runs.derived).toBe(stopped);

    hub.addClient('c', { send: () => {}, bufferedAmount: () => 0 });
    subscribe('c', 'a', 'cars.overview');
    push(three);
    expect(runs.derived).toBeGreaterThan(stopped);
    await pipeline.stop();
  });

  it('keeps running while any subscriber of the topic is left', async () => {
    const { runs, features } = probes();
    const source = new ManualSource(F);
    const { pipeline, hub, subscribe } = setup(source, features);
    const [one, two, three] = session(77n);
    pipeline.start();
    const push = (chunk: PreparedPacket[]) => chunk.forEach((p) => source.push(p.bytes, p.receivedAtMs));

    subscribe('c', 'a', 'cars.overview');
    subscribe('d', 'b', 'cars.overview');
    push(one);
    hub.unsubscribe('c', 'a');
    const before = runs.derived;
    push(two);
    expect(runs.derived).toBeGreaterThan(before);
    hub.unsubscribe('d', 'b');
    const stopped = runs.derived;
    push(three);
    expect(runs.derived).toBe(stopped);
    await pipeline.stop();
  });

  it('a demand change before any session exists is harmless, and the first session starts with the current demand', async () => {
    const { runs, features } = probes();
    const source = new ManualSource(F);
    const { pipeline, hub, subscribe } = setup(source, features);
    pipeline.start();
    subscribe('c', 'a', 'cars.overview');
    hub.unsubscribe('c', 'a');
    subscribe('c', 'b', 'session.info');
    session(77n).flat().forEach((p) => source.push(p.bytes, p.receivedAtMs));
    expect(runs.base).toBeGreaterThan(0);
    expect(runs.derived).toBe(0);
    expect(runs.free).toBeGreaterThan(0);
    await pipeline.stop();
  });

  it('each new session starts with the demand of that moment', async () => {
    const { runs, features } = probes();
    const source = new ManualSource(F);
    const { pipeline, hub, subscribe } = setup(source, features);
    const [one1, one2, one3] = session(77n);
    const [two1, two2, two3] = session(78n).map((chunk) => shifted(chunk, 60_000));
    pipeline.start();
    const push = (chunk: PreparedPacket[]) => chunk.forEach((p) => source.push(p.bytes, p.receivedAtMs));

    subscribe('c', 'a', 'cars.overview');
    push([...one1, ...one2, ...one3]);
    expect(runs.derived).toBeGreaterThan(0);
    hub.unsubscribe('c', 'a');
    const afterFirst = { ...runs };

    push(two1!);
    expect(runs.free).toBeGreaterThan(afterFirst.free);
    expect(runs.derived).toBe(afterFirst.derived);

    subscribe('c', 'b', 'cars.overview');
    push([...two2!, ...two3!]);
    expect(runs.derived).toBeGreaterThan(afterFirst.derived);
    await pipeline.stop();
  });

  it('an incremental calculator started late ends with the output of one that ran all along', async () => {
    const eventCount = (subscribeAfterFirstChunk: boolean) => {
      let last: number | undefined;
      const sum: IncrementalCalculator<number, number> = {
        kind: 'incremental', id: 'probe.sum', reads: ['feed'], cadence: 'frame',
        init: ({ state }) => state.history.events.length,
        update: (acc, delta) => acc + (delta.after.events - delta.before.events),
        output: (acc) => (last = acc),
      };
      const features = [defineFeature({ name: 'probe-sum', calculators: [sum], topics: [bindState('cars.overview', sum, () => undefined)] })];
      const source = new ManualSource(F);
      const { pipeline, subscribe } = setup(source, features);
      const [one, two, three] = session(77n);
      pipeline.start();
      const push = (chunk: PreparedPacket[]) => chunk.forEach((p) => source.push(p.bytes, p.receivedAtMs));
      if (!subscribeAfterFirstChunk) subscribe('c', 'a', 'cars.overview');
      push(one);
      if (subscribeAfterFirstChunk) subscribe('c', 'a', 'cars.overview');
      push(two); push(three);
      return pipeline.stop().then(() => last);
    };
    const allAlong = await eventCount(false);
    const late = await eventCount(true);
    expect(allAlong).toBeGreaterThan(0);
    expect(late).toBe(allAlong);
  });
});
