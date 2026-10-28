// Typed job bindings (groundwork task 7). Checked twice, like typed-bindings.test.ts: `pnpm typecheck` compiles this
// file, so the `@ts-expect-error` lines are the compiler tests; vitest runs the same calls.
//
// No contract topic carries a `Computed<…>` value yet, so the positive case ("a topic whose value fits
// `Computed<Out>`") cannot be written against a real topic name. What can be checked: every real topic refuses a job,
// whatever its output, including the output being the topic's own value (it must arrive wrapped in `Computed`).
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { Computed, SessionInfo } from '@pitwall/contracts';
import type { Job } from '@pitwall/engine';
import { bindJob, bindState, defineFeature, type TopicBinding } from '../../src/features/feature.ts';

const workerModule = new URL('./fixtures/none.ts', import.meta.url);
const job = <Out>(id: string): Job<number, Out> => ({ kind: 'job', id, reads: ['timing'], trigger: 'lapCompleted', prepare: () => 1, module: workerModule });

describe('bindJob: Computed<Out> must fit the topic', () => {
  it('an output that is the topic value itself does not compile: it arrives as Computed<Out>', () => {
    // @ts-expect-error Computed<SessionInfo> is not a SessionInfo
    const unwrapped = bindJob('session.info', job<SessionInfo>('j'));
    expect(unwrapped.topic).toBe('session.info');
  });

  it('another output does not compile', () => {
    // @ts-expect-error a number is not the value of session.info
    const wrongOut = bindJob('session.info', job<number>('j'));
    // @ts-expect-error not even Computed<number> is
    const wrongComputed = bindJob('laps', job<Computed<number>>('j'));
    expect([wrongOut.topic, wrongComputed.topic]).toEqual(['session.info', 'laps']);
  });

  it('a topic that does not exist does not compile', () => {
    // @ts-expect-error unknown topic
    const unknownTopic = bindJob('no.such.topic', job<number>('j'));
    expect(unknownTopic.topic).toBe('no.such.topic');
  });

  it('a job and not a calculator is required', () => {
    // @ts-expect-error a quick calculator is not a job
    const notAJob = bindJob('session.info', { id: 'c', kind: 'quick', reads: ['timing'], cadence: 'frame', compute: () => 1 });
    expect(notAJob.topic).toBe('session.info');
  });
});

describe('bindJob and Feature.jobs, as a feature author writes them', () => {
  // The call a job-topic author makes once such a topic exists; widened here because no real topic fits yet.
  const bindWidened = bindJob as unknown as (topic: 'session.info', job: Job<unknown, unknown>) => TopicBinding;

  it('returns an opaque TopicBinding for the topic', () => {
    const binding = bindWidened('session.info', job<number>('j'));
    expectTypeOf(binding).toEqualTypeOf<TopicBinding>();
    expect(binding.topic).toBe('session.info');
  });

  it('a feature lists jobs of any input and output, and their bindings next to the state bindings', () => {
    const feature = defineFeature({
      name: 'with-job',
      calculators: [],
      topics: [bindWidened('session.info', job<number>('j'))],
      jobs: [job<number>('j'), job<{ a: string }>('k')],
    });
    expect(feature.jobs?.map((j) => j.id)).toEqual(['j', 'k']);
    expect(feature.topics.map((t) => t.topic)).toEqual(['session.info']);
  });

  it('a feature without jobs still compiles: `jobs` is optional', () => {
    const feature = defineFeature({ name: 'plain', calculators: [], topics: [] });
    expect(feature.jobs).toBeUndefined();
  });

  it('a calculator in `jobs` does not compile', () => {
    const feature = defineFeature({
      name: 'calc-as-job',
      calculators: [],
      topics: [],
      // @ts-expect-error `jobs` takes jobs, calculators go to `calculators`
      jobs: [{ id: 'c', kind: 'quick', reads: ['timing'], cadence: 'frame', compute: () => 1 }],
    });
    expect(feature.jobs).toHaveLength(1);
  });

  it('bindState still refuses a job', () => {
    // @ts-expect-error a job is not a calculator
    const wrong = bindState('session.info', job<number>('j'));
    expect(wrong.topic).toBe('session.info');
  });
});
