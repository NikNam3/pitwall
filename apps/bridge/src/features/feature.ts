import type { TopicName } from '@pitwall/contracts';
import type { Calculator, CalculatorId, History } from '@pitwall/engine';

/** Where a topic's value comes from. */
export type TopicBinding =
  /** The output of a calculator, optionally narrowed by the subscription's params. */
  | { topic: TopicName; from: CalculatorId; select?: (out: unknown, params: object) => unknown }
  /** One of the append-only history lists. */
  | { topic: TopicName; fromHistory: keyof History }
  /** The active insights. */
  | { topic: TopicName; fromInsights: true };

/** A folder under `features/` with a `register.ts` whose default export is a feature. */
export type Feature = {
  name: string;
  calculators: Calculator[];
  topics: TopicBinding[];
};

export const defineFeature = (feature: Feature): Feature => feature;
