// Late subscribers (ruling R9, revised): a demand change evaluates the newly needed calculators at once against the
// current state, and the last session stays evaluable after it ended until the next one starts. So a client that
// subscribes after a fast replay has finished, or mid-session between two frames, gets a value straight away.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ServerMessage, TopicName } from '@pitwall/contracts';
import type { FeedId } from '@pitwall/domain';
import type { QuickCalculator } from '@pitwall/engine';
import { ScenarioBuilder, packetBytes } from '../../../../packages/engine/test/builders/index.ts';
import { bindState, defineFeature, type Feature } from '../../src/features/feature.ts';
import { FEATURES } from '../../src/features/index.generated.ts';
import { TopicHub } from '../../src/hub/topic-hub.ts';
import { PwrecSource } from '../../src/input/pwrec-source.ts';
import type { PacketSource } from '../../src/input/packet-source.ts';
import { createLogger } from '../../src/log.ts';
import { FeedPipeline } from '../../src/pipeline/feed-pipeline.ts';
import { ArraySource, type PreparedPacket } from '../helpers/array-source.ts';
import { ManualSource } from '../helpers/manual-source.ts';

const F = 'test' as FeedId;
const SEGMENT = join(import.meta.dirname, '../../../../fixtures/segments/tt-zandvoort-lap1.pwrec.gz');

const packets = (uid: bigint, frames: number): PreparedPacket[] =>
  new ScenarioBuilder({ sessionUid: uid, cars: 2 }).frames(frames, () => {}).packets()
    .map(({ packet, receivedAtMs }) => ({ bytes: packetBytes(packet), receivedAtMs }));

/** `session.info` bound to a counted calculator whose output is the session time it ran at. */
function probe() {
  const runs = { clock: 0, feedReader: 0 };
  const clock: QuickCalculator<number> = {
    kind: 'quick', id: 'probe.clock', reads: ['timing'], cadence: 'frame',
    compute: ({ state }) => { runs.clock++; return state.sessionTime; },
  };
  // Nothing references it, so it always runs; it reads `feed`, so every pass it takes part in runs it.
  const feedReader: QuickCalculator<number> = { kind: 'quick', id: 'probe.feedReader', reads: ['feed'], cadence: 'frame', compute: () => ++runs.feedReader };
  const features: Feature[] = [
    defineFeature({ name: 'probe-clock', calculators: [clock], topics: [bindState('session.info', clock, (out) => ({ at: out }) as never)] }),
    defineFeature({ name: 'probe-feed', calculators: [feedReader], topics: [] }),
  ];
  return { runs, features };
}

/** A hub wired to the pipeline as `serve` does, and one client that records what it receives per subscription. */
function setup(source: PacketSource, features: readonly Feature[]) {
  let t = 0;
  let pipeline: FeedPipeline | undefined = undefined;
  const hub = new TopicHub({ now: () => (t += 1000), onDemandChange: (feedId) => { if (feedId === F) pipeline?.demandChanged(); } });
  const inbox: ServerMessage[] = [];
  hub.addClient('c', { send: (m) => inbox.push(m), bufferedAmount: () => 0 });
  pipeline = new FeedPipeline({ feedId: F, source, hub, features, log: createLogger({ level: 'silent' }) });
  const subscribe = (id: string, topic: TopicName) => hub.subscribe({ clientId: 'c', id, topic, params: {}, feedId: F });
  /** The values received on `id`, from snapshots and updates, in order. */
  const values = (id: string) =>
    inbox.flatMap((m) => ((m.type === 'snapshot' || m.type === 'update') && m.id === id && 'value' in m ? [m.value] : []));
  return { hub, pipeline, subscribe, values, inbox };
}

describe('late subscribers (ruling R9)', () => {
  it('a subscriber that arrives after a fast replay has ended gets the final value, the same as one there all along', async () => {
    const all = packets(77n, 30);

    const along = setup(new ArraySource(F, all), probe().features);
    along.subscribe('s', 'session.info');
    along.pipeline.start();
    await along.pipeline.done;
    along.hub.tick();
    const final = along.values('s').at(-1);
    expect(final).toMatchObject({ at: expect.any(Number) });

    const { runs, features } = probe();
    const late = setup(new ArraySource(F, all), features);
    late.pipeline.start();
    await late.pipeline.done;
    expect(runs.clock).toBe(0);
    late.subscribe('s', 'session.info');
    expect(late.values('s')).toEqual([final]);
    expect(late.inbox.find((m) => 'id' in m && m.id === 's')).toEqual({ type: 'snapshot', id: 's', value: final });
  });

  it('a subscriber that arrives mid-session gets a value at once, without a new frame', async () => {
    const source = new ManualSource(F);
    const { runs, features } = probe();
    const { pipeline, subscribe, values } = setup(source, features);
    pipeline.start();
    const all = packets(77n, 20);
    all.forEach((p) => source.push(p.bytes, p.receivedAtMs));
    expect(runs.clock).toBe(0);

    subscribe('s', 'session.info');
    expect(runs.clock).toBe(1);
    expect(values('s')).toEqual([{ at: expect.any(Number) }]);
    await pipeline.stop();
  });

  it('a demand change that needs no new calculator runs no pass: an unsubscribe or a second subscriber evaluates nothing', async () => {
    const source = new ManualSource(F);
    const { runs, features } = probe();
    const { pipeline, hub, subscribe } = setup(source, features);
    pipeline.start();
    packets(77n, 20).forEach((p) => source.push(p.bytes, p.receivedAtMs));
    subscribe('s', 'session.info');
    const before = { ...runs };
    subscribe('t', 'session.info');
    hub.unsubscribe('c', 's');
    hub.unsubscribe('c', 't');
    expect(runs).toEqual(before);
    await pipeline.stop();
  });

  it('the real features: after a recording has been replayed, a late subscriber gets the final session.info and cars.overview', async () => {
    const late = setup(new PwrecSource({ feedId: F, path: SEGMENT, mode: 'asFastAsPossible' }), FEATURES);
    late.pipeline.start();
    await late.pipeline.done;
    late.subscribe('info', 'session.info');
    late.subscribe('cars', 'cars.overview');
    expect(late.values('info')).toEqual([expect.objectContaining({ sessionUid: '1895827638050388100' })]);
    const cars = late.values('cars');
    expect(cars).toHaveLength(1);
    expect(Array.isArray(cars[0]) && cars[0].length > 0).toBe(true);
  });
});
