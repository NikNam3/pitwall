// Core topics of the live state (C55 `bindLive`, C54, C39): the hub reads a bindLive topic's value from its feed's
// current live state when it flushes a subscription, at most `maxHz` and only for the subscribed params, never per
// frame. The select copies what it returns, so a value sent never changes afterwards; a rewind needs nothing, because
// the runner restores the live state (C27, C33). Each feed's binding reads its own feed's state (C1a).
import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import type { ServerMessage, TopicName, TopicValue } from '@pitwall/contracts';
import type { FeedId } from '@pitwall/domain';
import type { QuickCalculator } from '@pitwall/engine';
import { ScenarioBuilder, packetBytes } from '../../../../packages/engine/test/builders/index.ts';
import { bindLive, defineFeature, type Feature } from '../../src/features/feature.ts';
import carDetail from '../../src/features/car-detail/register.ts';
import carTelemetry from '../../src/features/car-telemetry/register.ts';
import { TopicHub } from '../../src/hub/topic-hub.ts';
import { createLogger } from '../../src/log.ts';
import { FeedPipeline } from '../../src/pipeline/feed-pipeline.ts';
import { ArraySource, type PreparedPacket } from '../helpers/array-source.ts';
import { ManualSource } from '../helpers/manual-source.ts';

const A = 'feed-a' as FeedId;
const B = 'feed-b' as FeedId;
type Telemetry = TopicValue<'car.telemetry'>;
type Timed = ReturnType<ScenarioBuilder['packets']>;
const toPrepared = (packets: Timed): PreparedPacket[] => packets.map(({ packet, receivedAtMs }) => ({ bytes: packetBytes(packet), receivedAtMs }));

/** Two cars; on frame i car 0 drives at `base + i` km/h and car 1 at `base + 100 + i`, so every frame changes both. */
const scenario = (frames: number, base = 100, uid = 77n) =>
  new ScenarioBuilder({ sessionUid: uid, cars: 2 }).session().participants().frames(frames, (d, i) => {
    d.telemetry.carTelemetryData[0]!.speed = base + i;
    d.telemetry.carTelemetryData[1]!.speed = base + 100 + i;
  });

/** Frames 0..59, then the game rewinds to frame 30 and plays 31..79 (`overallFrameIdentifier` keeps rising). */
const withFlashback = (): PreparedPacket[] => {
  const continuation = scenario(80).packets().filter((p) => p.packet.header.frameIdentifier > 30 && p.packet.header.frameIdentifier < 80);
  const rewound = continuation.map(({ packet, receivedAtMs }) => ({
    packet: { ...packet, header: { ...packet.header, overallFrameIdentifier: packet.header.frameIdentifier + 29 } },
    receivedAtMs: receivedAtMs + 29 * 16,
  }));
  return [...toPrepared(scenario(60).packets()), ...toPrepared(rewound)];
};

/** The select a bindLive binding holds (`{ topic, fromLive }`), as `bindLive` was given it. */
type LiveSelect = (live: unknown, params: object) => unknown;
const liveSelectOf = (feature: Feature, topic: TopicName): LiveSelect =>
  (feature.topics.find((b) => b.topic === topic) as unknown as { fromLive: LiveSelect }).fromLive;

/** `feature` with its bindLive topic's select wrapped: every call is recorded with its params. */
function counted(feature: Feature, topic: 'car.detail' | 'car.telemetry') {
  const select = liveSelectOf(feature, topic);
  const calls: object[] = [];
  const wrapped = defineFeature({
    ...feature,
    topics: [bindLive(topic, ((live: unknown, params: object) => {
      calls.push(params);
      return select(live, params);
    }) as never)],
  });
  return { feature: wrapped, calls };
}

/** What the engine's live state shows for car 1 after each frame: a calculator that always runs (it raises insights). */
function liveProbe() {
  const seen: number[] = [];
  const probe: QuickCalculator<number> = {
    kind: 'quick', id: 'probe.live', reads: ['dynamics'], cadence: 'frame',
    compute: ({ live }) => {
      const dynamics = live.cars[1]!.dynamics;
      const speed = dynamics.known ? dynamics.value.speedKmh : -1;
      seen.push(speed);
      return speed;
    },
    insights: () => [],
  };
  return { feature: defineFeature({ name: 'probe-live', calculators: [probe], topics: [] }), seen };
}

/** One hub with the clock `now`, one client; `inbox` keeps each message as sent and a deep copy taken when it was sent. */
function client(now: () => number) {
  const hub = new TopicHub({ now });
  const inbox: Array<{ message: ServerMessage; asSent: ServerMessage }> = [];
  hub.addClient('c', { send: (message) => inbox.push({ message, asSent: structuredClone(message) }), bufferedAmount: () => 0 });
  const subscribe = (id: string, topic: TopicName, params: object, feedId: FeedId = A) => hub.subscribe({ clientId: 'c', id, topic, params, feedId });
  /** The values received on subscription `id`, from snapshots and updates, in order. */
  const values = (id: string) =>
    inbox.flatMap(({ message: m }) => ((m.type === 'snapshot' || m.type === 'update') && m.id === id && 'value' in m ? [m.value] : []));
  const statuses = (id: string) => inbox.flatMap(({ message: m }) => (m.type === 'topicStatus' && m.id === id ? [m.status] : []));
  return { hub, inbox, subscribe, values, statuses };
}

const speedOf = (value: unknown): number => {
  const { dynamics } = value as Telemetry;
  return dynamics.known ? dynamics.value.speedKmh : -1;
};

const silent = createLogger({ level: 'silent' });

describe('bindLive: read at flush', () => {
  it('a bindLive topic is read only when the hub sends a value, and only for the subscribed params', async () => {
    let now = 0;
    const c = client(() => now);
    const telemetry = counted(carTelemetry, 'car.telemetry');
    const detail = counted(carDetail, 'car.detail');
    const probe = liveProbe();
    const source = new ManualSource(A);
    c.subscribe('tel', 'car.telemetry', { carId: 1 });
    const pipeline = new FeedPipeline({ feedId: A, source, hub: c.hub, features: [telemetry.feature, detail.feature, probe.feature], log: silent });
    pipeline.start();
    const packets = toPrepared(scenario(30).packets());
    // The hub's clock stands still: after the first value the throttle (60 Hz) holds every later frame back.
    for (const p of packets.slice(0, Math.floor(packets.length / 2))) source.push(p.bytes, p.receivedAtMs);
    expect(c.values('tel')).toHaveLength(1);
    expect(telemetry.calls).toEqual([{ carId: 1 }]);
    // The flush reads the live state as it is at that moment: the newest applied frame's car 1.
    now += 1000;
    c.hub.tick();
    const first = probe.seen[0]!;
    const middle = probe.seen.at(-1)!;
    expect(middle).not.toBe(first);
    expect(c.values('tel').map(speedOf)).toEqual([first, middle]);
    expect(telemetry.calls).toEqual([{ carId: 1 }, { carId: 1 }]);
    for (const p of packets.slice(Math.floor(packets.length / 2))) source.push(p.bytes, p.receivedAtMs);
    const last = probe.seen.at(-1)!;
    expect(last).not.toBe(middle);
    now += 1000;
    c.hub.tick();
    expect(c.values('tel').map(speedOf)).toEqual([first, middle, last]);
    expect(telemetry.calls).toEqual([{ carId: 1 }, { carId: 1 }, { carId: 1 }]);
    // car.detail has no subscriber: its select never runs
    expect(detail.calls).toEqual([]);
    await pipeline.stop();
  });

  it('a value sent earlier never changes afterwards, while the live state moves on every frame', async () => {
    let now = 0;
    const c = client(() => (now += 1000)); // every flush is due: one value per frame
    c.subscribe('tel', 'car.telemetry', { carId: 0 });
    c.subscribe('detail', 'car.detail', { carId: 1 });
    const pipeline = new FeedPipeline({ feedId: A, source: new ArraySource(A, toPrepared(scenario(30).packets())), hub: c.hub, features: [carTelemetry, carDetail], log: silent });
    pipeline.start();
    await pipeline.done;
    const speeds = c.values('tel').map(speedOf);
    expect(speeds.length).toBeGreaterThan(10);
    expect(new Set(speeds).size).toBe(speeds.length);
    expect(c.values('detail').length).toBeGreaterThan(10);
    for (const { message, asSent } of c.inbox) expect(message).toEqual(asSent);
  });

  it('after a flashback the next value is read from the restored live state: the client gets what a run without the undone frames sends', async () => {
    const run = async (packets: PreparedPacket[]) => {
      let now = 0;
      const c = client(() => (now += 1000));
      c.subscribe('tel', 'car.telemetry', { carId: 0 });
      const pipeline = new FeedPipeline({ feedId: A, source: new ArraySource(A, packets), hub: c.hub, features: [carTelemetry], log: silent });
      pipeline.start();
      await pipeline.done;
      return c.values('tel');
    };
    const rewound = await run(withFlashback());
    const straight = await run(toPrepared(scenario(80).packets()));
    const speeds = rewound.map(speedOf);
    // the one fall in the speeds is the rewind: from frame 59's car (159 km/h) to the restored timeline's
    const fall = speeds.findIndex((speed, i) => i > 0 && speed < speeds[i - 1]!);
    expect(fall).toBeGreaterThan(0);
    expect(speeds[fall - 1]).toBe(159);
    expect(speeds.slice(fall).every((speed, i) => i === 0 || speed > speeds[fall + i - 1]!)).toBe(true);
    const from = straight.findIndex((value) => speedOf(value) === speeds[fall]);
    expect(from).toBeGreaterThan(0);
    expect(rewound.slice(fall)).toEqual(straight.slice(from));
  });

  it('a subscriber that arrives after the session ended gets the last frame\'s car at once', async () => {
    let now = 0;
    const c = client(() => (now += 1000));
    const probe = liveProbe();
    const pipeline = new FeedPipeline({ feedId: A, source: new ArraySource(A, toPrepared(scenario(30).packets())), hub: c.hub, features: [carTelemetry, probe.feature], log: silent });
    pipeline.start();
    await pipeline.done;
    c.subscribe('late', 'car.telemetry', { carId: 1 });
    expect(c.inbox.map(({ message }) => message).filter((m) => 'id' in m && m.id === 'late')).toEqual([
      { type: 'snapshot', id: 'late', value: expect.objectContaining({ motion: expect.any(Object) }) },
    ]);
    expect(c.values('late').map(speedOf)).toEqual([probe.seen.at(-1)]);
  });

  it('each feed\'s binding reads its own feed\'s live state (C1a)', async () => {
    let now = 0;
    const c = client(() => (now += 1000));
    c.subscribe('a', 'car.telemetry', { carId: 0 }, A);
    c.subscribe('b', 'car.telemetry', { carId: 0 }, B);
    const a = new FeedPipeline({ feedId: A, source: new ArraySource(A, toPrepared(scenario(30, 100, 77n).packets())), hub: c.hub, features: [carTelemetry], log: silent });
    const b = new FeedPipeline({ feedId: B, source: new ArraySource(B, toPrepared(scenario(30, 500, 78n).packets())), hub: c.hub, features: [carTelemetry], log: silent });
    a.start();
    b.start();
    await Promise.all([a.done, b.done]);
    expect(c.values('a').map(speedOf).at(-1)).toBe(129);
    expect(c.values('b').map(speedOf).at(-1)).toBe(529);
    expect(c.values('a').map(speedOf).every((speed) => speed >= 100 && speed < 130)).toBe(true);
    expect(c.values('b').map(speedOf).every((speed) => speed >= 500 && speed < 530)).toBe(true);
  });

  it('a throwing select marks only its own topic errored and is logged; the other topics still publish', async () => {
    let now = 0;
    const c = client(() => (now += 1000));
    c.subscribe('tel', 'car.telemetry', { carId: 0 });
    c.subscribe('detail', 'car.detail', { carId: 0 });
    const boom = defineFeature({ name: 'boom', calculators: [], topics: [bindLive('car.telemetry', () => { throw new Error('select failed'); })] });
    const logs: Array<Record<string, unknown>> = [];
    const log = createLogger({ level: 'debug', destination: new Writable({ write(chunk, _e, cb) { logs.push(JSON.parse(String(chunk))); cb(); } }) });
    const pipeline = new FeedPipeline({ feedId: A, source: new ArraySource(A, toPrepared(scenario(30).packets())), hub: c.hub, features: [boom, carDetail], log });
    pipeline.start();
    await pipeline.done;
    expect(c.values('tel')).toEqual([]);
    expect(c.statuses('tel').at(-1)).toBe('errored');
    expect(c.values('detail').length).toBeGreaterThan(10);
    expect(logs.some((l) => l['level'] === 50 && l['topic'] === 'car.telemetry' && JSON.stringify(l).includes('select failed'))).toBe(true);
  });
});
