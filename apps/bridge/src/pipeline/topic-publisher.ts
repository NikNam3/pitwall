// Turns what one frame produced into hub messages, following the features' topic bindings (spec 3.3, 8).
import type { Computed, TopicName } from '@pitwall/contracts';
import type { FeedId } from '@pitwall/domain';
import type { DeepReadonly, History, HistoryDelta, InsightChange, SchedulerResult } from '@pitwall/engine';
import type { Feature, TopicBinding } from '../features/feature.ts';
import type { TopicHub, ValueFor } from '../hub/topic-hub.ts';
import { jobCalculatorId } from '../jobs/feed-jobs.ts';
import type { JobResult } from '../jobs/job-runner.ts';
import type { Logger } from '../log.ts';

type StateBinding = Extract<TopicBinding, { from: string }>;
type HistoryBinding = Extract<TopicBinding, { fromHistory: keyof History }>;
type JobBinding = Extract<TopicBinding, { fromJob: string }>;

/** A topic that could not be published: a feature's `select` threw, or the hub did. The topic is marked `errored`. */
export type PublishError = { topic: TopicName; error: unknown };

/**
 * Publishes one feed's calculator outputs, history appends, insight changes and job results to the topics bound to them.
 * Every binding is contained: a failing one is marked `errored` and never stops the others.
 *
 * The `publish*` methods return the failures caught while they ran, so the caller can report them with its own
 * context (the frame). A `select` the hub only evaluates later (throttled, on `tick()` or a new subscription) is
 * caught there too and logged here, once per topic until the topic publishes again.
 */
export class TopicPublisher {
  readonly #feedId: FeedId;
  readonly #hub: TopicHub;
  readonly #log: Logger;
  readonly #state: StateBinding[] = [];
  readonly #history: HistoryBinding[] = [];
  readonly #insights: TopicName[] = [];
  readonly #jobs: JobBinding[] = [];
  /** Topics whose failure is already reported; a topic leaves the set when its `select` succeeds again. */
  readonly #failing = new Set<TopicName>();
  /** Set while a `publish*` call runs: its failures go back to the caller instead of the log. */
  #caught: PublishError[] | undefined;

  constructor(opts: { feedId: FeedId; hub: TopicHub; features: readonly Feature[]; log: Logger }) {
    this.#feedId = opts.feedId;
    this.#hub = opts.hub;
    this.#log = opts.log;
    for (const binding of opts.features.flatMap((feature) => feature.topics)) {
      if ('from' in binding) this.#state.push(binding);
      else if ('fromHistory' in binding) this.#history.push(binding);
      else if ('fromInsights' in binding) this.#insights.push(binding.topic);
      else if ('fromJob' in binding) this.#jobs.push(binding);
      else throw new Error(`unknown topic binding ${JSON.stringify(binding satisfies never)}`);
    }
  }

  /**
   * Topics of calculators that ran get their new output; topics of calculators that threw are marked `errored`
   * until the calculator runs again (publishing a value sets the topic back to `ok`). A job whose trigger
   * calculator (its `prepare`) threw marks its topics `errored` too; their values come from `publishJobResult`.
   */
  publishOutputs(result: SchedulerResult): PublishError[] {
    const ran = new Set(result.ran);
    const failed = new Set(result.errors.map((e) => e.id));
    return this.#collecting(() => {
      for (const binding of this.#state) {
        const { topic, from } = binding;
        if (ran.has(from)) {
          const valueFor = this.#valueFor(binding, result.outputs.get(from));
          this.#guarded(topic, () => this.#hub.publishState(this.#feedId, topic, valueFor));
        } else if (failed.has(from)) {
          this.#guarded(topic, () => this.#hub.setStatus(this.#feedId, topic, 'errored'));
        }
      }
      for (const { topic, fromJob } of this.#jobs) {
        if (failed.has(jobCalculatorId(fromJob))) this.#guarded(topic, () => this.#hub.setStatus(this.#feedId, topic, 'errored'));
      }
    });
  }

  /** A job's result: its topics get `{ computedFor, value }`, or are marked `errored` when the job failed. */
  publishJobResult(result: JobResult): PublishError[] {
    return this.#collecting(() => {
      for (const { topic, fromJob } of this.#jobs) {
        if (fromJob !== result.jobId) continue;
        if ('error' in result) {
          this.#guarded(topic, () => this.#hub.setStatus(this.#feedId, topic, 'errored'));
        } else {
          const computed: Computed<unknown> = { computedFor: result.computedFor, value: result.value };
          this.#guarded(topic, () => this.#hub.publishState(this.#feedId, topic, () => computed));
        }
      }
    });
  }

  /** Appends what the history lists gained; after a flashback (truncated delta) the lists are sent again whole. */
  publishHistory(history: DeepReadonly<History>, delta: HistoryDelta): PublishError[] {
    return this.#collecting(() => {
      for (const { topic, fromHistory: list } of this.#history) {
        const entries = history[list];
        if (delta.truncated) this.#guarded(topic, () => this.#hub.resetAppend(this.#feedId, topic, entries.slice()));
        else if (delta.after[list] > delta.before[list]) {
          this.#guarded(topic, () => this.#hub.publishAppend(this.#feedId, topic, entries.slice(delta.before[list], delta.after[list])));
        }
      }
    });
  }

  publishInsights(changes: readonly InsightChange[]): PublishError[] {
    return this.#collecting(() => {
      for (const topic of this.#insights) this.#guarded(topic, () => this.#hub.publishAppend(this.#feedId, topic, [...changes]));
    });
  }

  #collecting(publish: () => void): PublishError[] {
    const caught: PublishError[] = [];
    this.#caught = caught;
    try {
      publish();
    } finally {
      this.#caught = undefined;
    }
    return caught;
  }

  #guarded(topic: TopicName, publish: () => void): void {
    try {
      publish();
    } catch (error) {
      this.#failed(topic, error);
    }
  }

  /**
   * What the hub asks for a subscription's value. It never throws, wherever the hub calls it: a throwing `select`
   * reports once per output and gives `undefined`, and the topic stays `errored` (clients keep their last value)
   * until a later output selects without throwing.
   */
  #valueFor({ topic, select }: StateBinding, out: unknown): ValueFor {
    if (select === undefined) return () => out;
    let reported = false;
    return (params) => {
      try {
        const value = select(out, params);
        this.#failing.delete(topic);
        return value;
      } catch (error) {
        // Set first: marking the topic errored asks this function again.
        if (!reported) {
          reported = true;
          this.#failed(topic, error);
        }
        return undefined;
      }
    };
  }

  #failed(topic: TopicName, error: unknown): void {
    if (this.#caught !== undefined) this.#caught.push({ topic, error });
    else if (!this.#failing.has(topic)) this.#log.error({ feedId: this.#feedId, topic, err: error }, 'topic failed, marked errored');
    this.#failing.add(topic);
    this.#hub.setStatus(this.#feedId, topic, 'errored');
  }
}
