// Which calculators a feed needs right now (spec 7.3): the ones behind subscribed topics, the ones no binding
// references (they exist for insights), and, via the scheduler, what those read.
import type { TopicName } from '@pitwall/contracts';
import type { CalculatorId, CalculatorRegistry } from '@pitwall/engine';
import type { Feature, TopicBinding } from '../features/feature.ts';

/** The calculator a binding takes its value from, if it has one. A new binding kind that reads a calculator says so here. */
function referencedCalculator(binding: TopicBinding): CalculatorId | undefined {
  return 'from' in binding ? binding.from : undefined;
}

/**
 * The calculators to run for a set of subscribed topics. Fixed by the features: the bindings are read once, and
 * the returned function is cheap enough to call on every demand change.
 */
export function demandOf(features: readonly Feature[], registry: CalculatorRegistry): (subscribed: ReadonlySet<TopicName>) => CalculatorId[] {
  const bindings = features.flatMap((feature) => feature.topics);
  const referenced = new Set(bindings.flatMap((binding) => referencedCalculator(binding) ?? []));
  const unreferenced = registry.order.map((calc) => calc.id).filter((id) => !referenced.has(id));
  return (subscribed) => [
    ...unreferenced,
    ...bindings.flatMap((binding) => (subscribed.has(binding.topic) ? (referencedCalculator(binding) ?? []) : [])),
  ];
}
