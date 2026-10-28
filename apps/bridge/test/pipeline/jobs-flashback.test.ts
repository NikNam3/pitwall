// A flashback drops the job runs under way (final review, item 8): their input was a timeline the game has discarded,
// so a result computed before the flashback must never reach a topic afterwards.
import { describe, expect, it } from 'vitest';
import type { ServerMessage, TopicName } from '@pitwall/contracts';
import type { FeedId } from '@pitwall/domain';
import type { Job } from '@pitwall/engine';
import { ScenarioBuilder, packetBytes } from '../../../../packages/engine/test/builders/index.ts';
import { bindJob, defineFeature, type TopicBinding } from '../../src/features/feature.ts';
import { TopicHub } from '../../src/hub/topic-hub.ts';
import { createLogger } from '../../src/log.ts';
import { FeedPipeline } from '../../src/pipeline/feed-pipeline.ts';
import type { AddRngInput } from '../jobs/fixtures/add-rng.ts';
import { ManualSource } from '../helpers/manual-source.ts';

const F = 'test' as FeedId;
const TOPIC: TopicName = 'session.info';
/** `bindJob` for a topic that does not carry `Computed<Out>`; `typed-job-bindings.test.ts` covers the type check. */
const bindTestJob = bindJob as unknown as (topic: TopicName, job: Job<unknown, unknown>) => TopicBinding;

type Timed = ReturnType<ScenarioBuilder['packets']>;
const toPrepared = (packets: Timed) => packets.map(({ packet, receivedAtMs }) => ({ bytes: packetBytes(packet), receivedAtMs }));

/** Frames 0..59, then the game rewinds to frame 30: `frameIdentifier` goes back while `overallFrameIdentifier` rises. */
function flashback() {
  const original = new ScenarioBuilder({ sessionUid: 77n, cars: 2 }).session().participants().frames(60, () => {});
  const continuation = new ScenarioBuilder({ sessionUid: 77n, cars: 2 }).session().participants().frames(80, () => {}).packets()
    .filter((p) => p.packet.header.frameIdentifier > 30 && p.packet.header.frameIdentifier < 80);
  const rewound = continuation.map(({ packet, receivedAtMs }) => ({
    packet: { ...packet, header: { ...packet.header, overallFrameIdentifier: packet.header.frameIdentifier + 29 } },
    receivedAtMs: receivedAtMs + 29 * 16,
  }));
  return { before: toPrepared(original.packets()), after: toPrepared(rewound) };
}

describe('FeedPipeline: a flashback and the job runs under way', () => {
  it('a result of a run triggered before the flashback is dropped', async () => {
    let prepared = 0;
    const job: Job<AddRngInput, number> = {
      kind: 'job', id: 'add-rng', reads: ['timing'], trigger: 'frame',
      prepare: () => { prepared++; return { base: 1000, sleepMs: 400 }; },
      module: new URL('../jobs/fixtures/add-rng.ts', import.meta.url),
    };
    const feature = defineFeature({ name: 'add-rng', calculators: [], topics: [bindTestJob(TOPIC, job as Job<unknown, unknown>)], jobs: [job as Job<unknown, unknown>] });
    let pipeline: FeedPipeline | undefined = undefined;
    const hub = new TopicHub({ now: () => 0, onDemandChange: () => pipeline?.demandChanged() });
    const inbox: ServerMessage[] = [];
    hub.addClient('c', { send: (m) => inbox.push(m), bufferedAmount: () => 0 });
    const source = new ManualSource(F);
    pipeline = new FeedPipeline({ feedId: F, source, hub, features: [feature], log: createLogger({ level: 'silent' }) });
    pipeline.start();
    const push = (chunk: Array<{ bytes: Uint8Array; receivedAtMs: number }>) => chunk.forEach((p) => source.push(p.bytes, p.receivedAtMs));
    const { before, after } = flashback();

    hub.subscribe({ clientId: 'c', id: 'j', topic: TOPIC, params: {}, feedId: F });
    push(before);
    expect(prepared).toBeGreaterThan(0); // a run is under way in a worker
    hub.unsubscribe('c', 'j'); // nothing triggers again: the run from before the flashback is the only one
    push(after); // the flashback
    hub.subscribe({ clientId: 'c', id: 'k', topic: TOPIC, params: {}, feedId: F });

    await new Promise((resolve) => setTimeout(resolve, 900)); // longer than the run; waiting out an absence
    const values = inbox.filter((m) => (m.type === 'update' || m.type === 'snapshot') && 'value' in m && m.value !== undefined);
    expect(values).toEqual([]);
    await pipeline.stop();
  });
});
