// Jobs and their bindings must match (groundwork task 7, fix round 1): a job runs only for a subscriber of its topic,
// so a job no `bindJob` binds is never needed, and a binding to an undeclared job has nothing to run. Both are
// rejected when the pipeline is built; demand never counts a job's trigger as an always-on calculator.
import { describe, expect, it } from 'vitest';
import type { TopicName } from '@pitwall/contracts';
import type { FeedId } from '@pitwall/domain';
import { CalculatorRegistry, type Job } from '@pitwall/engine';
import { bindJob, defineFeature, type Feature, type TopicBinding } from '../../src/features/feature.ts';
import { TopicHub } from '../../src/hub/topic-hub.ts';
import { FeedJobs, JobDeclarationError, jobCalculatorId } from '../../src/jobs/feed-jobs.ts';
import { createLogger } from '../../src/log.ts';
import { demandOf } from '../../src/pipeline/demand.ts';
import { FeedPipeline } from '../../src/pipeline/feed-pipeline.ts';
import { ManualSource } from '../helpers/manual-source.ts';

const F = 'test' as FeedId;
const TOPIC: TopicName = 'session.info';
const bindTestJob = bindJob as unknown as (topic: TopicName, job: Job<unknown, unknown>) => TopicBinding;

const job = (id: string): Job<number, number> => ({
  kind: 'job',
  id,
  reads: ['timing'],
  trigger: 'frame',
  prepare: () => 1,
  module: new URL('../jobs/fixtures/add-rng.ts', import.meta.url),
});

const pipeline = (features: Feature[]) =>
  new FeedPipeline({ feedId: F, source: new ManualSource(F), hub: new TopicHub({ now: () => 0 }), features, log: createLogger({ level: 'silent' }) });

const declarationError = (build: () => unknown): JobDeclarationError => {
  try {
    build();
  } catch (error) {
    if (error instanceof JobDeclarationError) return error;
    throw error;
  }
  throw new Error('expected a JobDeclarationError');
};

describe('job declarations', () => {
  it('a job in `jobs` that no bindJob binds is rejected when the pipeline is built, naming the job', () => {
    const unbound = defineFeature({ name: 'unbound', calculators: [], topics: [], jobs: [job('lonely')] });
    const error = declarationError(() => pipeline([unbound]));
    expect(error).toMatchObject({ reason: 'unbound', jobId: 'lonely' });
    expect(error.message).toContain('"lonely"');
  });

  it('a bindJob whose job no feature lists in `jobs` is rejected when the pipeline is built, naming the job', () => {
    const undeclared = defineFeature({ name: 'undeclared', calculators: [], topics: [bindTestJob(TOPIC, job('ghost'))] });
    const error = declarationError(() => pipeline([undeclared]));
    expect(error).toMatchObject({ reason: 'undeclared', jobId: 'ghost' });
    expect(error.message).toContain('"ghost"');
  });

  it('a job declared in one feature and bound in another is fine', () => {
    const declares = defineFeature({ name: 'declares', calculators: [], topics: [], jobs: [job('shared')] });
    const binds = defineFeature({ name: 'binds', calculators: [], topics: [bindTestJob(TOPIC, job('shared'))] });
    expect(() => pipeline([declares, binds])).not.toThrow();
  });

  it('FeedJobs itself checks the declarations', () => {
    const unbound = defineFeature({ name: 'unbound', calculators: [], topics: [], jobs: [job('lonely')] });
    expect(declarationError(() => new FeedJobs([unbound], () => {}))).toMatchObject({ reason: 'unbound', jobId: 'lonely' });
  });
});

describe('demand and job triggers', () => {
  it('a declared job\'s trigger is never needed just because nothing binds it', () => {
    const lonely = job('lonely');
    const feature = defineFeature({ name: 'unbound', calculators: [], topics: [], jobs: [lonely] });
    const trigger = { kind: 'quick' as const, id: jobCalculatorId('lonely'), reads: lonely.reads, cadence: lonely.trigger, compute: () => 1 };
    const demand = demandOf([feature], CalculatorRegistry.build([trigger]));
    expect(demand(new Set())).toEqual([]);
    expect(demand(new Set<TopicName>([TOPIC, 'laps']))).toEqual([]);
  });

  it('a bound job\'s trigger is needed only while its topic is subscribed', () => {
    const bound = job('bound');
    const feature = defineFeature({ name: 'bound', calculators: [], topics: [bindTestJob(TOPIC, bound)], jobs: [bound] });
    const registry = CalculatorRegistry.build(new FeedJobs([feature], () => {}).calculators);
    const demand = demandOf([feature], registry);
    expect(demand(new Set<TopicName>(['laps']))).toEqual([]);
    expect(demand(new Set<TopicName>([TOPIC]))).toEqual(['job:bound']);
  });
});
