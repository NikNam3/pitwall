import type { Computed, InsightEntry, TopicName, TopicValue } from '@pitwall/contracts';
import type { CarId, MachineId, OpenSpan, Span } from '@pitwall/domain';
import type {
  Calculator,
  CalculatorId,
  ConfigKey,
  ConfigValue,
  DeepReadonly,
  IncrementalCalculator,
  Job,
  LiveState,
  ProjectedList,
  ProjectionState,
  QuickCalculator,
} from '@pitwall/engine/readers';

declare const bindingBrand: unique symbol;

/** The live state as a `bindLive` select reads it (C39's `live`): the current values only, read-only. */
export type LiveView = DeepReadonly<LiveState>;

/** A `bindLive` select: the topic value for `params` (client input), or `undefined` for no data. */
export type LiveSelect<V> = (live: LiveView, params: object) => V | undefined;

/** The runtime shapes of a binding; the publisher reads these fields. */
type BindingShape =
  /** The output of a calculator, optionally narrowed by the subscription's params. */
  | { topic: TopicName; from: CalculatorId; select?: (out: unknown, params: object) => unknown }
  /** One of the projection's lists. */
  | { topic: TopicName; fromHistory: ProjectedList }
  /** The active insights. */
  | { topic: TopicName; fromInsights: true }
  /** The results of the job with this id, as `Computed` values. */
  | { topic: TopicName; fromJob: CalculatorId }
  /** A part of the feed's live state, read when the hub sends a value. */
  | { topic: TopicName; fromLive: LiveSelect<unknown> }
  /** A sub-machine's spans: its open spans in the situation and its closed spans in the projection (C20). */
  | { topic: TopicName; fromSituation: MachineId };

/**
 * Where a topic's value comes from. Opaque: only `bindState`, `bindHistory`, `bindSituation`, `bindInsights`, `bindJob` and
 * `bindLive` make one (C55).
 */
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

/** Binds a topic to a list of the projection whose records are the topic's value. */
export const bindHistory = <T extends TopicName, L extends ProjectedList>(
  topic: T,
  list: ProjectionState[L][number] extends TopicValue<T> ? L : never,
): TopicBinding => binding({ topic, fromHistory: list });

/** A sub-machine's spans as a topic carries them (C54): the open ones and the closed ones, as they are. */
export type MachineSpans = { open: OpenSpan[]; closed: Span[] };

/**
 * Binds a core topic to a sub-machine's spans (C54, C55): its open spans (`view.situation`) and its closed spans (the
 * projection's `spans[machine]`). The topic's value must be `MachineSpans`.
 */
export const bindSituation = <T extends TopicName>(
  topic: MachineSpans extends TopicValue<T> ? T : never,
  machine: MachineId,
): TopicBinding => binding({ topic, fromSituation: machine });

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

/**
 * Binds a core topic to a part of the live state (C55), with no calculator between. The hub reads it from the feed's
 * current live state whenever it sends a subscription a value (at most `maxHz`), never per frame. `select` copies what
 * it returns, since the engine changes its state in place, and validates `params`, which is client input.
 */
export const bindLive = <T extends TopicName>(topic: T, select: LiveSelect<TopicValue<T>>): TopicBinding =>
  binding({ topic, fromLive: select });

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
