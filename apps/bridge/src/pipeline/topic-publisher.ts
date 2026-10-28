// Turns what one frame produced into hub messages, following the features' topic bindings (spec 3.3, 8).
import type { TopicName } from '@pitwall/contracts';
import type { FeedId } from '@pitwall/domain';
import type { DeepReadonly, History, HistoryDelta, InsightChange, SchedulerResult } from '@pitwall/engine';
import type { Feature, TopicBinding } from '../features/feature.ts';
import type { TopicHub } from '../hub/topic-hub.ts';

type StateBinding = Extract<TopicBinding, { from: string }>;
type HistoryBinding = Extract<TopicBinding, { fromHistory: keyof History }>;

/** Publishes one feed's calculator outputs, history appends and insight changes to the topics bound to them. */
export class TopicPublisher {
  readonly #feedId: FeedId;
  readonly #hub: TopicHub;
  readonly #state: StateBinding[] = [];
  readonly #history: HistoryBinding[] = [];
  readonly #insights: TopicName[] = [];

  constructor(feedId: FeedId, hub: TopicHub, features: readonly Feature[]) {
    this.#feedId = feedId;
    this.#hub = hub;
    for (const binding of features.flatMap((feature) => feature.topics)) {
      if ('from' in binding) this.#state.push(binding);
      else if ('fromHistory' in binding) this.#history.push(binding);
      else this.#insights.push(binding.topic);
    }
  }

  /**
   * Topics of calculators that ran get their new output; topics of calculators that threw are marked `errored`
   * until the calculator runs again (publishing a value sets the topic back to `ok`).
   */
  publishOutputs(result: SchedulerResult): void {
    const ran = new Set(result.ran);
    const failed = new Set(result.errors.map((e) => e.id));
    for (const { topic, from, select } of this.#state) {
      if (ran.has(from)) {
        const out = result.outputs.get(from);
        this.#hub.publishState(this.#feedId, topic, select ? (params) => select(out, params) : () => out);
      } else if (failed.has(from)) {
        this.#hub.setStatus(this.#feedId, topic, 'errored');
      }
    }
  }

  /** Appends what the history lists gained; after a flashback (truncated delta) the lists are sent again whole. */
  publishHistory(history: DeepReadonly<History>, delta: HistoryDelta): void {
    for (const { topic, fromHistory: list } of this.#history) {
      const entries = history[list];
      if (delta.truncated) this.#hub.resetAppend(this.#feedId, topic, entries.slice());
      else if (delta.after[list] > delta.before[list]) {
        this.#hub.publishAppend(this.#feedId, topic, entries.slice(delta.before[list], delta.after[list]));
      }
    }
  }

  publishInsights(changes: readonly InsightChange[]): void {
    for (const topic of this.#insights) this.#hub.publishAppend(this.#feedId, topic, [...changes]);
  }
}
