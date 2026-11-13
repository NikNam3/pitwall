// Turns what one frame produced into hub messages, following the features' topic bindings (spec 3.3, 8).
import type { Computed, MachineSpans, TopicName } from '@pitwall/contracts';
import type { FeedId, MachineId } from '@pitwall/domain';
import type { HistoryDelta, InsightChange, Projection, ProjectedList, SchedulerResult } from '@pitwall/engine/readers';
import type { Feature, LiveView, TopicBinding } from '../features/feature.ts';
import type { TopicHub, ValueFor } from '../hub/topic-hub.ts';
import { jobCalculatorId } from '../jobs/feed-jobs.ts';
import type { JobResult } from '../jobs/job-runner.ts';
import type { Logger } from '../log.ts';

type StateBinding = Extract<TopicBinding, { from: string }>;
type HistoryBinding = Extract<TopicBinding, { fromHistory: ProjectedList }>;
type JobBinding = Extract<TopicBinding, { fromJob: string }>;
type LiveBinding = Extract<TopicBinding, { fromLive: unknown }>;
type SituationBinding = Extract<TopicBinding, { fromSituation: MachineId }>;

/** A sub-machine's open spans as they are now (C20), from the view's situation, copied, since the engine changes its state in place. */
export type SpansOf = (machine: MachineId) => MachineSpans;

/** A situation topic's value holds no open span; no value (its `spansOf` threw) is not such a value. */
const hasNoSpan = (value: unknown): boolean => value !== undefined && (value as MachineSpans).open.length === 0;

/** A topic that could not be published: a feature's `select` threw, or the hub did. The topic is marked `errored`. */
export type PublishError = { topic: TopicName; error: unknown };

/**
 * Which pass of the session produced an insight change: the frame `frameId`'s, or with `between` a pass after that frame
 * and before the next (a demand change). The feed's own changes have none: no flashback undoes them.
 */
export type InsightOrigin = { frameId: number; between?: true };

/**
 * Publishes one feed's calculator outputs, history appends, insight changes, job results, live state and sub-machine
 * spans to the topics bound to them.
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
  readonly #live: LiveBinding[] = [];
  readonly #situations: Array<SituationBinding & { tag: string }> = [];
  /** The situation topics published in this session: the ones a client may hold a value of. */
  #situationsPublished = new Set<TopicName>();
  /** Topics whose failure is already reported; a topic leaves the set when its `select` succeeds again. */
  readonly #failing = new Set<TopicName>();
  /** Set while a `publish*` call runs: its failures go back to the caller instead of the log. */
  #caught: PublishError[] | undefined;
  /** The insight changes of the session so far with their origin, oldest first: what a resend sends (C32). */
  #insightLog: Array<{ change: InsightChange; origin: InsightOrigin | undefined }> = [];

  constructor(opts: { feedId: FeedId; hub: TopicHub; features: readonly Feature[]; log: Logger }) {
    this.#feedId = opts.feedId;
    this.#hub = opts.hub;
    this.#log = opts.log;
    for (const binding of opts.features.flatMap((feature) => feature.topics)) {
      if ('from' in binding) this.#state.push(binding);
      else if ('fromHistory' in binding) this.#history.push(binding);
      else if ('fromInsights' in binding) this.#insights.push(binding.topic);
      else if ('fromJob' in binding) this.#jobs.push(binding);
      else if ('fromLive' in binding) this.#live.push(binding);
      else if ('fromSituation' in binding) this.#situations.push({ ...binding, tag: `spans:${binding.fromSituation}` });
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
          const out = result.outputs.get(from);
          const { select } = binding;
          const valueFor = select === undefined ? () => out : this.#valueFor(topic, (params) => select(out, params));
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

  /**
   * A job's result: its topics get `{ computedFor, value }`, with a `select` its value for each subscribed params
   * (`undefined`: no data for those params), or are marked `errored` when the job failed.
   */
  publishJobResult(result: JobResult): PublishError[] {
    return this.#collecting(() => {
      for (const { topic, fromJob, select } of this.#jobs) {
        if (fromJob !== result.jobId) continue;
        if ('error' in result) {
          this.#guarded(topic, () => this.#hub.setStatus(this.#feedId, topic, 'errored'));
        } else if (select === undefined) {
          const computed: Computed<unknown> = { computedFor: result.computedFor, value: result.value };
          this.#guarded(topic, () => this.#hub.publishState(this.#feedId, topic, () => computed));
        } else {
          const { computedFor, value: out } = result;
          const valueFor = this.#valueFor(topic, (params) => {
            const value = select(out, params);
            return value === undefined ? undefined : ({ computedFor, value } satisfies Computed<unknown>);
          });
          this.#guarded(topic, () => this.#hub.publishState(this.#feedId, topic, valueFor));
        }
      }
    });
  }

  /**
   * The feed's live state changed (a frame was applied): every `bindLive` topic has a new value. Nothing is copied
   * here: the hub runs the `select` on `live()`, the state at that moment, only when it sends a subscription a value
   * (at once if the throttle allows, else on a later tick; at most `maxHz`, only for subscribed params). `live` reads
   * the runner's current state, so after the session ended a late subscriber still gets the last frame's, and after a
   * flashback the restored one (C27).
   */
  publishLive(live: () => LiveView): PublishError[] {
    return this.#collecting(() => {
      for (const { topic, fromLive: select } of this.#live) {
        const valueFor = this.#valueFor(topic, (params) => select(live(), params));
        this.#guarded(topic, () => this.#hub.publishState(this.#feedId, topic, valueFor));
      }
    });
  }

  /**
   * The situation topics (`bindSituation`, C55) of the machines whose spans changed on a frame (their `spans:<machine>`
   * tag): each has a new value. Only subscribed topics are published (C49), and nothing is copied here: the hub calls
   * `spansOf` when it sends a subscription a value (at once if the throttle allows, else on a later tick; at most
   * `maxHz`). It reads the runner's current state, so after a flashback (`rewound`, every tag set) the restored one: a
   * state topic, recomputed, never resent as a log (C57). Then a topic not published yet in the session whose machine
   * has no open span stays unpublished, as in a run that never received the undone frames (C33).
   */
  publishSituations(spansOf: SpansOf, changed: ReadonlySet<string>, rewound = false): PublishError[] {
    return this.#collecting(() => {
      for (const { topic, fromSituation: machine, tag } of this.#situations) {
        if (!changed.has(tag)) continue;
        if (!this.#hub.isSubscribed(this.#feedId, topic)) continue;
        const valueFor = this.#valueFor(topic, () => spansOf(machine));
        if (rewound && !this.#situationsPublished.has(topic) && hasNoSpan(valueFor({}))) continue;
        this.#situationsPublished.add(topic);
        this.#guarded(topic, () => this.#hub.publishState(this.#feedId, topic, valueFor));
      }
    });
  }

  /**
   * The subscriptions changed (a demand change): a subscribed situation topic not published yet in the session gets its
   * machine's open spans now, so a new subscriber has them at once (C49). One published before needs nothing: the hub reads
   * its value from the current state whenever it sends one.
   */
  publishNewSituations(spansOf: SpansOf): PublishError[] {
    return this.#collecting(() => {
      for (const { topic, fromSituation: machine } of this.#situations) {
        if (this.#situationsPublished.has(topic) || !this.#hub.isSubscribed(this.#feedId, topic)) continue;
        this.#situationsPublished.add(topic);
        const valueFor = this.#valueFor(topic, () => spansOf(machine));
        this.#guarded(topic, () => this.#hub.publishState(this.#feedId, topic, valueFor));
      }
    });
  }

  /** Appends what the history lists gained; after a rewind (`delta.rewound`) the lists are sent again whole. */
  publishHistory(history: Projection, delta: HistoryDelta): PublishError[] {
    return this.#collecting(() => {
      for (const { topic, fromHistory: list } of this.#history) {
        const entries = history[list];
        const before = delta.before[list] ?? 0;
        const after = delta.after[list] ?? 0;
        if (delta.rewound !== undefined) this.#guarded(topic, () => this.#hub.resetAppend(this.#feedId, topic, entries.slice()));
        else if (after > before) {
          this.#guarded(topic, () => this.#hub.publishAppend(this.#feedId, topic, entries.slice(before, after)));
        }
      }
    });
  }

  /** A new session: its insight changes and its published situation topics start over, as the hub's topics do. */
  sessionStarted(): void {
    this.#insightLog = [];
    this.#situationsPublished = new Set();
  }

  /** Appends insight changes to the insights topics; `origin`: the pass of the session that produced them. */
  publishInsights(changes: readonly InsightChange[], origin?: InsightOrigin): PublishError[] {
    for (const change of changes) this.#insightLog.push({ change, origin });
    return this.#collecting(() => {
      for (const topic of this.#insights) this.#guarded(topic, () => this.#hub.publishAppend(this.#feedId, topic, [...changes]));
    });
  }

  /**
   * After a rewind (`delta.rewound`, C30: a flashback, the only rewind) the insights topics are sent again whole. Its
   * target drops the changes of the passes after it, which the undone frames produced (C33); a target frame id of -1 (a
   * flashback to the first snapshot, before the session's first frame) drops every change of a pass.
   */
  resendInsights(target: NonNullable<HistoryDelta['rewound']>): PublishError[] {
    const kept = ({ origin }: { origin: InsightOrigin | undefined }) =>
      origin === undefined || origin.frameId < target.frameId || (origin.frameId === target.frameId && origin.between === undefined);
    this.#insightLog = this.#insightLog.filter(kept);
    const entries = this.#insightLog.map(({ change }) => change);
    return this.#collecting(() => {
      for (const topic of this.#insights) this.#guarded(topic, () => this.#hub.resetAppend(this.#feedId, topic, entries));
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
   * reports once per published value and gives `undefined`, and the topic stays `errored` (clients keep their last
   * value) until a later value selects without throwing.
   */
  #valueFor(topic: TopicName, select: (params: object) => unknown): ValueFor {
    let reported = false;
    return (params) => {
      try {
        const value = select(params);
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
