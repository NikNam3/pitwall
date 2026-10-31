// Job topics stay out of the determinism hash (groundwork task 7): their results come from worker threads and arrive
// whenever the worker finishes, so the same recording may deliver them at different points of the stream.
//
// Observed with a job whose input differs on every run (a counter that outlives the runs). The hash replay subscribes
// the job's topic like every feed topic, so the job runs: its `prepare` is called on each session change, with another
// base on every replay, and a worker starts on it to compute `base + rng`. The test records every `prepare` call, so it
// proves the job ran in both replays (review 7 R7-2). What it cannot see is a delivered result: within a replay as fast
// as possible, each newer trigger terminates the running worker and the session's end the last, before any worker
// finishes (probed on five segments up to the 5 s race segment). The positive control binds the same counter to the
// same topic as a plain calculator, which must change the hash. `topicStreamHash` takes the features to replay as an
// option.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SessionInfo, TopicName } from '@pitwall/contracts';
import type { Job, QuickCalculator } from '@pitwall/engine';
import { bindJob, bindState, defineFeature, type TopicBinding } from '../../src/features/feature.ts';
import { topicStreamHash } from '../../src/pipeline/stream-hash.ts';
import type { AddRngInput } from '../jobs/fixtures/add-rng.ts';

// Both behaviours need only a session change: the counter and the job's trigger run on it. So the replays use the
// shortest segment (the end of a qualifying session, about 10 ms a replay); the 5 s race segment took about 250 ms a
// replay, four of them, and over 5 s under the full suite's load. The first test fails if this segment ever stops
// running the job.
const SEGMENT = join(import.meta.dirname, '../../../../fixtures/segments/qualifying-singapore-end.pwrec.gz');
const TOPIC: TopicName = 'session.info';
const bindTestJob = bindJob as unknown as (topic: TopicName, job: Job<unknown, unknown>) => TopicBinding;

/** Counts across runs of the hash, so every run of the job gets another input. */
let runs = 0;

/** A feature with the job; every base its `prepare` hands the worker goes to `prepared`. */
const jobFeature = (prepared: number[]) => {
  const job: Job<AddRngInput, number> = {
    kind: 'job',
    id: 'add-rng',
    reads: ['session'],
    trigger: 'sessionChange',
    prepare: () => {
      const base = ++runs;
      prepared.push(base);
      return { base };
    },
    module: new URL('../jobs/fixtures/add-rng.ts', import.meta.url),
  };
  return defineFeature({ name: 'hash-job', calculators: [], topics: [bindTestJob(TOPIC, job)], jobs: [job] });
};

/** The same job, whose `prepare` throws: its topic goes `errored`, a message no working job's topic sends. */
const failingJobFeature = () => {
  const job: Job<AddRngInput, number> = {
    kind: 'job',
    id: 'add-rng',
    reads: ['session'],
    trigger: 'sessionChange',
    prepare: () => {
      throw new Error('prepare fails');
    },
    module: new URL('../jobs/fixtures/add-rng.ts', import.meta.url),
  };
  return defineFeature({ name: 'hash-job', calculators: [], topics: [bindTestJob(TOPIC, job)], jobs: [job] });
};

const counterFeature = () => {
  const counter: QuickCalculator<number> = { kind: 'quick', id: 'hash-counter', reads: ['session'], cadence: 'sessionChange', compute: () => ++runs };
  return defineFeature({ name: 'hash-counter', calculators: [counter], topics: [bindState(TOPIC, counter, (n) => n as unknown as SessionInfo)] });
};

describe('topicStreamHash and job topics', () => {
  it('a job topic stays out of the hash: two replays hash the same although the job runs in both, on other inputs', async () => {
    const preparedA: number[] = [];
    const preparedB: number[] = [];
    const a = await topicStreamHash(SEGMENT, { features: [jobFeature(preparedA)] });
    const b = await topicStreamHash(SEGMENT, { features: [jobFeature(preparedB)] });
    // The job ran in each replay (on bases the counter never repeats).
    expect(preparedA).not.toEqual([]);
    expect(preparedB).not.toEqual([]);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(b).toBe(a);
  });

  it('the replay hashes through the job filter: an errored job topic hashes as a working one (review 8 R8-1)', async () => {
    // The status messages of the job's topic differ (errored against ok); only the filter makes the two hashes equal.
    const working = await topicStreamHash(SEGMENT, { features: [jobFeature([])] });
    const failing = await topicStreamHash(SEGMENT, { features: [failingJobFeature()] });
    expect(failing).toBe(working);
  });

  it('control: the same changing value on a plain state topic does change the hash', async () => {
    const a = await topicStreamHash(SEGMENT, { features: [counterFeature()] });
    const b = await topicStreamHash(SEGMENT, { features: [counterFeature()] });
    expect(b).not.toBe(a);
  });
});
