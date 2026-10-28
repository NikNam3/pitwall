// Which calculators a feed needs right now (spec 7.3): the ones behind subscribed topics, the ones that raise
// insights, the ones nothing references, and, via the scheduler, what those read.
import type { TopicName } from '@pitwall/contracts';
import type { CalculatorId, CalculatorRegistry } from '@pitwall/engine';
import type { Feature, TopicBinding } from '../features/feature.ts';
import { jobCalculatorId } from '../jobs/feed-jobs.ts';

/** The calculator a binding takes its value from, if it has one. A job's topic needs the job's trigger calculator. */
function referencedCalculator(binding: TopicBinding): CalculatorId | undefined {
  switch (true) {
    case 'from' in binding:
      return binding.from;
    case 'fromJob' in binding:
      return jobCalculatorId(binding.fromJob);
    case 'fromHistory' in binding:
    case 'fromInsights' in binding:
      return undefined;
    default:
      throw new Error(`unknown topic binding ${JSON.stringify(binding satisfies never)}`);
  }
}

/**
 * The calculators to run for a set of subscribed topics (spec 7.3). Always: every calculator with an `insights` hook,
 * since alarms must not depend on open screens (ruling R13), and every calculator that nothing references, neither a
 * binding nor another calculator. Besides: the calculators bound to a subscribed topic. The scheduler adds what they
 * read, so an intermediate calculator runs only through what reads it.
 *
 * Fixed by the features: the bindings are read once, and the returned function is cheap enough to call on every
 * demand change.
 */
export function demandOf(features: readonly Feature[], registry: CalculatorRegistry): (subscribed: ReadonlySet<TopicName>) => CalculatorId[] {
  const bindings = features.flatMap((feature) => feature.topics);
  // A job's trigger counts as referenced even without a binding: a job runs only for a subscriber of its topic.
  const jobTriggers = features.flatMap((feature) => feature.jobs ?? []).map((job) => jobCalculatorId(job.id));
  const referenced = new Set([...jobTriggers, ...bindings.flatMap((binding) => referencedCalculator(binding) ?? [])]);
  const always = registry.order
    .filter((calc) => calc.insights !== undefined || (!referenced.has(calc.id) && registry.dependentsOf(calc.id).length === 0))
    .map((calc) => calc.id);
  return (subscribed) => [
    ...always,
    ...bindings.flatMap((binding) => (subscribed.has(binding.topic) ? (referencedCalculator(binding) ?? []) : [])),
  ];
}
