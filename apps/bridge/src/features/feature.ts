import type { Computed, InsightEntry, TopicName, TopicValue } from '@pitwall/contracts';
import type { CarId } from '@pitwall/domain';
import type { Calculator, CalculatorId, ConfigKey, ConfigValue, History, IncrementalCalculator, Job, QuickCalculator } from '@pitwall/engine';

declare const bindingBrand: unique symbol;

/** The runtime shapes of a binding; the publisher reads these fields. */
type BindingShape =
  /** The output of a calculator, optionally narrowed by the subscription's params. */
  | { topic: TopicName; from: CalculatorId; select?: (out: unknown, params: object) => unknown }
  /** One of the append-only history lists. */
  | { topic: TopicName; fromHistory: keyof History }
  /** The active insights. */
  | { topic: TopicName; fromInsights: true }
  /** The results of the job with this id, as `Computed` values. */
  | { topic: TopicName; fromJob: CalculatorId };

/** Where a topic's value comes from. Opaque: only `bindState`, `bindHistory`, `bindInsights` and `bindJob` make one. */
export type TopicBinding = BindingShape & { readonly [bindingBrand]: true };

// The helpers are the only place that vouches for a binding's types, hence the cast to the brand.
const binding = (shape: BindingShape): TopicBinding => shape as TopicBinding;

/**
 * Binds a topic to a calculator's output. Without `select` the output must be the topic's value; with it,
 * `select` maps the output to the value (or `undefined` for no data) and validates `params`, which is client input.
 */
export function bindState<T extends TopicName, Out extends TopicValue<T>>(
  topic: T,
  calc: QuickCalculator<Out> | IncrementalCalculator<unknown, Out>,
): TopicBinding;
export function bindState<T extends TopicName, Out>(
  topic: T,
  calc: QuickCalculator<Out> | IncrementalCalculator<unknown, Out>,
  select: (out: Out, params: object) => TopicValue<T> | undefined,
): TopicBinding;
export function bindState(
  topic: TopicName,
  calc: Calculator,
  select?: (out: never, params: object) => unknown,
): TopicBinding {
  return binding({ topic, from: calc.id, ...(select !== undefined && { select: select as (out: unknown, params: object) => unknown }) });
}

/**
 * The `select` of a per-car topic whose calculator output is keyed by car id: the entry `params.carId` names. `params`
 * is client input, so `carId` must be an own integer property naming a car the output has; anything else is `undefined`.
 */
export function selectCar<V>(out: Readonly<Record<CarId, V>>, params: object): V | undefined {
  if (!Object.hasOwn(params, 'carId')) return undefined;
  const { carId } = params as { carId: unknown };
  return typeof carId === 'number' && Number.isInteger(carId) && Object.hasOwn(out, carId) ? out[carId as CarId] : undefined;
}

/** Binds a topic to a history list whose records are the topic's value. */
export const bindHistory = <T extends TopicName, L extends keyof History>(
  topic: T,
  list: History[L][number] extends TopicValue<T> ? L : never,
): TopicBinding => binding({ topic, fromHistory: list });

/** Binds a topic to the insight entries; the topic's value must be `InsightEntry`. */
export const bindInsights = <T extends TopicName>(
  topic: InsightEntry extends TopicValue<T> ? T : never,
): TopicBinding => binding({ topic, fromInsights: true });

/**
 * Binds a topic to a job's results. Each result arrives as `{ computedFor, value }`, so `Computed<Out>` must be the
 * topic's value. The job must also be listed in the feature's `jobs`.
 */
export const bindJob = <T extends TopicName, Out>(
  topic: Computed<Out> extends TopicValue<T> ? T : never,
  job: Job<unknown, Out>,
): TopicBinding => binding({ topic, fromJob: job.id });

/** A folder under `features/` with a `register.ts` whose default export is a feature. */
export type Feature = {
  name: string;
  calculators: Calculator[];
  topics: TopicBinding[];
  /** Expensive computations that run in a worker; `bindJob` publishes their results. */
  jobs?: Job<unknown, unknown>[];
  /** Thresholds and other values its calculators read with `read(view)`; `<data dir>/config.json` may override them. Keys are unique across features. */
  config?: ConfigKey<Record<string, ConfigValue>>[];
};

export const defineFeature = (feature: Feature): Feature => feature;
