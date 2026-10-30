// Job topics stay out of the determinism hash (groundwork task 7): their results come from worker threads and arrive
// whenever the worker finishes, so the same recording may deliver them at different points of the stream.
//
// Observed with a job whose input differs on every run (a counter that outlives the runs): were its result hashed,
// two hashes of the same recording would differ. The positive control binds the same counter to the same topic as
// a plain calculator, which must change the hash. `topicStreamHash` takes the features to replay as an option.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SessionInfo, TopicName } from '@pitwall/contracts';
import type { Job, QuickCalculator } from '@pitwall/engine';
import { bindJob, bindState, defineFeature, type TopicBinding } from '../../src/features/feature.ts';
import { topicStreamHash } from '../../src/pipeline/stream-hash.ts';
import type { AddRngInput } from '../jobs/fixtures/add-rng.ts';

const SEGMENT = join(import.meta.dirname, '../../../../fixtures/segments/race-zandvoort-lap10.pwrec.gz');
const TOPIC: TopicName = 'session.info';
const bindTestJob = bindJob as unknown as (topic: TopicName, job: Job<unknown, unknown>) => TopicBinding;

/** Counts across runs of the hash, so every run of the job gets another input. */
let runs = 0;

const jobFeature = () => {
  const job: Job<AddRngInput, number> = {
    kind: 'job',
    id: 'add-rng',
    reads: ['session'],
    trigger: 'sessionChange',
    prepare: () => ({ base: ++runs }),
    module: new URL('../jobs/fixtures/add-rng.ts', import.meta.url),
  };
  return defineFeature({ name: 'hash-job', calculators: [], topics: [bindTestJob(TOPIC, job)], jobs: [job] });
};

const counterFeature = () => {
  const counter: QuickCalculator<number> = { kind: 'quick', id: 'hash-counter', reads: ['session'], cadence: 'sessionChange', compute: () => ++runs };
  return defineFeature({ name: 'hash-counter', calculators: [counter], topics: [bindState(TOPIC, counter, (n) => n as unknown as SessionInfo)] });
};

describe('topicStreamHash and job topics', () => {
  it('a job topic\'s values do not enter the hash: two replays hash the same although the job computes other values', async () => {
    const a = await topicStreamHash(SEGMENT, { features: [jobFeature()] });
    const b = await topicStreamHash(SEGMENT, { features: [jobFeature()] });
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(b).toBe(a);
  });

  it('control: the same changing value on a plain state topic does change the hash', async () => {
    const a = await topicStreamHash(SEGMENT, { features: [counterFeature()] });
    const b = await topicStreamHash(SEGMENT, { features: [counterFeature()] });
    expect(b).not.toBe(a);
  });
});
