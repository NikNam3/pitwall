// Which calculators a feed needs right now (spec 7.3, C49): the ones behind subscribed topics, the ones that raise
// insights, the ones nothing references, in a served session every job's trigger, and, via the scheduler, what those read.
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
    case 'fromLive' in binding:
    case 'fromSituation' in binding:
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
 * `jobsAlways` (C49, a session the bridge serves): every job's trigger is needed too, subscribed or not; the scheduler
 * adds what it reads. Without it (a run that serves no UI) a job's trigger is needed only for a subscriber of its topic.
 *
 * Fixed by the features: the bindings are read once, and the returned function is cheap enough to call on every
 * demand change.
 */
export function demandOf(
  features: readonly Feature[],
  registry: CalculatorRegistry,
  opts: { jobsAlways?: boolean } = {},
): (subscribed: ReadonlySet<TopicName>) => CalculatorId[] {
  const bindings = features.flatMap((feature) => feature.topics);
  // A job's trigger counts as referenced even without a binding: it is needed through its topic or, `jobsAlways`, always.
  const jobTriggers = features.flatMap((feature) => feature.jobs ?? []).map((job) => jobCalculatorId(job.id));
  const referenced = new Set([...jobTriggers, ...bindings.flatMap((binding) => referencedCalculator(binding) ?? [])]);
  const always = [
    ...registry.order
      .filter((calc) => calc.insights !== undefined || (!referenced.has(calc.id) && registry.dependentsOf(calc.id).length === 0))
      .map((calc) => calc.id),
    ...(opts.jobsAlways === true ? jobTriggers : []),
  ];
  return (subscribed) => [
    ...always,
    ...bindings.flatMap((binding) => (subscribed.has(binding.topic) ? (referencedCalculator(binding) ?? []) : [])),
  ];
}
