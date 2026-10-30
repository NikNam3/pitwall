// A clock reset (Task FR ruling) restarts the calculators and drops the job runs under way, as a flashback does: what
// they hold came from the formation lap, whose history the engine has dropped. It is no flashback to the engineer.
import { describe, expect, it } from 'vitest';
import type { ServerMessage, TopicName } from '@pitwall/contracts';
import type { FeedId } from '@pitwall/domain';
import type { IncrementalCalculator, Job, QuickCalculator } from '@pitwall/engine';
import { ScenarioBuilder, packetBytes } from '../../../../packages/engine/test/builders/index.ts';
import { bindInsights, bindJob, defineFeature, type Feature, type TopicBinding } from '../../src/features/feature.ts';
import { TopicHub } from '../../src/hub/topic-hub.ts';
import { createLogger } from '../../src/log.ts';
import { FeedPipeline } from '../../src/pipeline/feed-pipeline.ts';
import type { AddRngInput } from '../jobs/fixtures/add-rng.ts';
import { ManualSource } from '../helpers/manual-source.ts';

const F = 'test' as FeedId;
const STEP_MS = 50;
const FTLP = { code: 'FTLP', vehicleIdx: 0, lapTime: 80 } as const;
/** `bindJob` for a topic that does not carry `Computed<Out>`; `typed-job-bindings.test.ts` covers the type check. */
const bindTestJob = bindJob as unknown as (topic: TopicName, job: Job<unknown, unknown>) => TopicBinding;

type Timed = ReturnType<ScenarioBuilder['packets']>;
type Prepared = Array<{ bytes: Uint8Array; receivedAtMs: number }>;
const toPrepared = (packets: Timed): Prepared => packets.map(({ packet, receivedAtMs }) => ({ bytes: packetBytes(packet), receivedAtMs }));

/**
 * Formation frames 0..59 (0 to 2.95 s, a fastest lap at frame 40, 2 s), then the race on its own clock from 0: frame ids
 * go on from 60 and no FLBK comes.
 */
function clockReset(): { before: Prepared; after: Prepared } {
  const formation = new ScenarioBuilder({ sessionUid: 77n, cars: 2, stepMs: STEP_MS }).session().participants().frames(40, () => {}).event(FTLP).frames(20, () => {});
  const race = new ScenarioBuilder({ sessionUid: 77n, cars: 2, stepMs: STEP_MS }).session().participants().frames(20, () => {}).packets();
  const continued = race.map(({ packet, receivedAtMs }) => ({
    packet: { ...packet, header: { ...packet.header, frameIdentifier: packet.header.frameIdentifier + 60, overallFrameIdentifier: packet.header.overallFrameIdentifier + 60 } },
    receivedAtMs: receivedAtMs + 60 * STEP_MS,
  }));
  return { before: toPrepared(formation.packets()), after: toPrepared(continued) };
}

/** A pipeline of `features` on a manual source, and one client that records what it receives. */
function setup(features: Feature[]) {
  let pipeline: FeedPipeline | undefined = undefined;
  const hub = new TopicHub({ now: () => 0, onDemandChange: () => pipeline?.demandChanged() });
  const inbox: ServerMessage[] = [];
  hub.addClient('c', { send: (m) => inbox.push(m), bufferedAmount: () => 0 });
  const source = new ManualSource(F);
  pipeline = new FeedPipeline({ feedId: F, source, hub, features, log: createLogger({ level: 'silent' }) });
  pipeline.start();
  const push = (chunk: Prepared) => chunk.forEach((p) => source.push(p.bytes, p.receivedAtMs));
  return { hub, pipeline, inbox, push };
}

/** The session times in `times` that lie more than 1 s below the one before: the steps after a clock reset. */
const fellBack = (times: number[]): number[] => times.filter((t, i) => i > 0 && t < times[i - 1]! - 1000);

describe('FeedPipeline: a clock reset restarts the calculators', () => {
  it('an incremental calculator starts again from init on the reset frame', async () => {
    const inits: number[] = [];
    const runs: number[] = [];
    const events: IncrementalCalculator<number, number> = {
      kind: 'incremental', id: 'probe.events', reads: ['events'], cadence: 'frame',
      init: ({ state }) => { inits.push(state.sessionTime); runs.push(state.sessionTime); return state.history.events.length; },
      update: (n, delta, { state }) => { runs.push(state.sessionTime); return n + delta.after.events - delta.before.events; },
      output: (n) => n,
    };
    const { pipeline, push } = setup([defineFeature({ name: 'probe-events', calculators: [events], topics: [] })]);
    const { before, after } = clockReset();
    push(before);
    push(after);
    await pipeline.stop();
    expect(fellBack(runs)).toEqual([0]);
    expect(inits).toEqual([runs[0], 0]); // on its first run and on the reset frame only
  });
  it('a calculator compares its first output after the reset with none from before it', async () => {
    const seen: Array<{ at: number; prev: number | undefined }> = [];
    const clock: QuickCalculator<number> = {
      kind: 'quick', id: 'probe.clock', reads: ['timing'], cadence: 'frame',
      compute: ({ state }) => state.sessionTime,
      insights: (_out, prev, { state }) => { seen.push({ at: state.sessionTime, prev }); return []; },
    };
    const { pipeline, push } = setup([defineFeature({ name: 'probe-clock', calculators: [clock], topics: [] })]);
    const { before, after } = clockReset();
    push(before);
    push(after);
    await pipeline.stop();
    const firstAfter = seen.find((s, i) => i > 0 && s.at < seen[i - 1]!.at - 1000);
    expect(firstAfter).toEqual({ at: 0, prev: undefined });
  });
  it('a result of a job run triggered before the reset is dropped', async () => {
    let prepared = 0;
    const job: Job<AddRngInput, number> = {
      kind: 'job', id: 'add-rng', reads: ['timing'], trigger: 'frame',
      prepare: () => { prepared++; return { base: 1000, sleepMs: 400 }; },
      module: new URL('../jobs/fixtures/add-rng.ts', import.meta.url),
    };
    const topic: TopicName = 'session.info';
    const feature = defineFeature({ name: 'add-rng', calculators: [], topics: [bindTestJob(topic, job as Job<unknown, unknown>)], jobs: [job as Job<unknown, unknown>] });
    const { hub, pipeline, inbox, push } = setup([feature]);
    const { before, after } = clockReset();

    hub.subscribe({ clientId: 'c', id: 'j', topic, params: {}, feedId: F });
    push(before);
    expect(prepared).toBeGreaterThan(0); // a run is under way in a worker
    hub.unsubscribe('c', 'j'); // nothing triggers again: the run from before the reset is the only one
    push(after); // the reset
    hub.subscribe({ clientId: 'c', id: 'k', topic, params: {}, feedId: F });

    await new Promise((resolve) => setTimeout(resolve, 900)); // longer than the run; waiting out an absence
    const values = inbox.filter((m) => (m.type === 'update' || m.type === 'snapshot') && 'value' in m && m.value !== undefined);
    expect(values).toEqual([]);
    await pipeline.stop();
  });
  it('a clock reset raises no session.flashback insight', async () => {
    const { hub, pipeline, inbox, push } = setup([defineFeature({ name: 'insights', calculators: [], topics: [bindInsights('insights')] })]);
    hub.subscribe({ clientId: 'c', id: 'i', topic: 'insights', params: {}, feedId: F });
    const { before, after } = clockReset();
    push(before);
    push(after);
    await pipeline.stop();
    const kinds = inbox.flatMap((m) => ('entries' in m ? ((m.entries ?? []) as Array<{ type: string; insight?: { kind: string } }>) : []))
      .flatMap((e) => (e.type === 'raised' && e.insight ? [e.insight.kind] : []));
    expect(kinds.filter((k) => k === 'session.flashback')).toEqual([]);
  });
});
