// The demand rule (spec 7.3, rulings R13 and final review): a calculator is always needed when it raises insights, or
// when nothing references it (no binding, no other calculator). Everything else is needed through a subscribed topic.
import { describe, expect, it } from 'vitest';
import type { TopicName } from '@pitwall/contracts';
import { CalculatorRegistry, type Job, type QuickCalculator } from '@pitwall/engine';
import { bindJob, bindState, defineFeature, type Feature, type TopicBinding } from '../../src/features/feature.ts';
import { FeedJobs, jobCalculatorId } from '../../src/jobs/feed-jobs.ts';
import { demandOf } from '../../src/pipeline/demand.ts';

const bindTestJob = bindJob as unknown as (topic: TopicName, job: Job<unknown, unknown>) => TopicBinding;

const calc = (id: string, reads: QuickCalculator<number>['reads'] = ['timing'], extra: Partial<QuickCalculator<number>> = {}): QuickCalculator<number> =>
  ({ kind: 'quick', id, reads, cadence: 'frame', compute: () => 1, ...extra });

const feature = (calculators: QuickCalculator<number>[], topics: TopicBinding[], jobs?: Job<unknown, unknown>[]): Feature =>
  defineFeature({ name: 'test', calculators, topics, ...(jobs && { jobs }) });

/** The needed ids as a sorted set: order and repeats do not matter, the scheduler takes a set. */
const needed = (demand: ReturnType<typeof demandOf>, ...topics: TopicName[]) => [...new Set(demand(new Set(topics)))].sort();

describe('demandOf', () => {
  it('A -> B -> topic: A is needed only through B, and B only while the topic is subscribed', () => {
    const a = calc('a');
    const b = calc('b', [{ calculator: 'a' }]);
    const features = [feature([a, b], [bindState('cars.overview', b, () => undefined)])];
    const demand = demandOf(features, CalculatorRegistry.build([a, b]));
    expect(needed(demand)).toEqual([]);
    expect(needed(demand, 'laps')).toEqual([]);
    expect(needed(demand, 'cars.overview')).toEqual(['b']);
  });

  it('a bound calculator with an insights hook is always needed, with or without a subscriber', () => {
    const alarm = calc('alarm', ['timing'], { insights: () => [] });
    const plain = calc('plain');
    const features = [feature([alarm, plain], [bindState('session.info', alarm, () => undefined), bindState('cars.overview', plain, () => undefined)])];
    const demand = demandOf(features, CalculatorRegistry.build([alarm, plain]));
    expect(needed(demand)).toEqual(['alarm']);
    expect(needed(demand, 'session.info')).toEqual(['alarm']);
  });

  it('an intermediate calculator with an insights hook is always needed, although its reader is not', () => {
    const alarm = calc('alarm', ['timing'], { insights: () => [] });
    const reader = calc('reader', [{ calculator: 'alarm' }]);
    const features = [feature([alarm, reader], [bindState('cars.overview', reader, () => undefined)])];
    const demand = demandOf(features, CalculatorRegistry.build([alarm, reader]));
    expect(needed(demand)).toEqual(['alarm']);
    expect(needed(demand, 'cars.overview')).toEqual(['alarm', 'reader']);
  });

  it('a leaf nothing references is always needed', () => {
    const leaf = calc('leaf');
    const bound = calc('bound');
    const features = [feature([leaf, bound], [bindState('cars.overview', bound, () => undefined)])];
    const demand = demandOf(features, CalculatorRegistry.build([leaf, bound]));
    expect(needed(demand)).toEqual(['leaf']);
    expect(needed(demand, 'cars.overview')).toEqual(['bound', 'leaf']);
  });

  it('two topics bound to one calculator: either subscription needs it, neither does not', () => {
    const shared = calc('shared');
    const features = [feature([shared], [bindState('session.info', shared, () => undefined), bindState('cars.overview', shared, () => undefined)])];
    const demand = demandOf(features, CalculatorRegistry.build([shared]));
    expect(needed(demand)).toEqual([]);
    expect(needed(demand, 'session.info')).toEqual(['shared']);
    expect(needed(demand, 'cars.overview')).toEqual(['shared']);
    expect(needed(demand, 'session.info', 'cars.overview')).toEqual(['shared']);
  });

  it('a job trigger is needed only while the job\'s topic is subscribed', () => {
    const job: Job<number, number> = {
      kind: 'job', id: 'sim', reads: ['timing'], trigger: 'frame', prepare: () => 1,
      module: new URL('../jobs/fixtures/add-rng.ts', import.meta.url),
    };
    const features = [feature([], [bindTestJob('session.info', job as Job<unknown, unknown>)], [job as Job<unknown, unknown>])];
    const demand = demandOf(features, CalculatorRegistry.build(new FeedJobs(features, () => {}).calculators));
    expect(needed(demand)).toEqual([]);
    expect(needed(demand, 'cars.overview')).toEqual([]);
    expect(needed(demand, 'session.info')).toEqual([jobCalculatorId('sim')]);
  });
});
