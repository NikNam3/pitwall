// One feed end to end (spec 4): PacketSource → decode → SessionTracker → SessionProcessor → TopicHub,
// with the feed's health, its session files and its storage alongside.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { toSessionTime, type FeedId, type SessionTime } from '@pitwall/domain';
import { CalculatorRegistry, SessionTracker, type FrameMetrics, type InsightChange, type TrackerEvent } from '@pitwall/engine';
import { decode } from '@pitwall/protocol';
import { effectiveConfig, sessionConfigPath, type FeatureConfig } from '../feature-config.ts';
import type { Feature } from '../features/feature.ts';
import { feedStatusOf } from '../features/feed-status/feed-status.ts';
import type { TopicHub } from '../hub/topic-hub.ts';
import type { PacketSource, RawPacket } from '../input/packet-source.ts';
import { FeedJobs } from '../jobs/feed-jobs.ts';
import type { JobResult } from '../jobs/job-runner.ts';
import type { Logger } from '../log.ts';
import type { Db } from '../storage/db.ts';
import { SessionFile, sessionRecordingName } from '../storage/session-files.ts';
import { FeedAlerts, type WriteFailure } from './feed-alerts.ts';
import { demandOf } from './demand.ts';
import type { CalcStats } from '../dev/calc-stats.ts';
import { FeedMonitor } from './feed-monitor.ts';
import { sessionClock, type SessionClock } from './session-clock.ts';
import { SessionProcessor } from './session-processor.ts';
import { SessionStorage } from './session-storage.ts';
import { TopicPublisher } from './topic-publisher.ts';

export type FeedPipelineOptions = {
  feedId: FeedId;
  source: PacketSource;
  hub: TopicHub;
  /**
   * The calculators, jobs and topic bindings. Feed and write-failure insights reach clients only through an
   * `insights` binding. Every job needs a `bindJob` binding and every bound job a feature that lists it, else the
   * constructor throws `JobDeclarationError`.
   */
  features: readonly Feature[];
  log: Logger;
  /**
   * The effective calculator config (see `loadFeatureConfig`), fixed for the pipeline's run; unset means the defaults
   * of the declared keys. Each session file gets a copy as `<file>.config.json`.
   */
  config?: FeatureConfig;
  /**
   * The database; with `recordingsDir` also one `.pwrec.gz` per session. `sourcePath` is the recording being
   * processed: its start dates the sessions, so a replay stores the same times on every run, and its absolute path
   * is stored as the sessions' recording (`reprocess` reads them from there).
   */
  storage?: { db: Db; recordingsDir?: string; sourcePath?: string };
  /** Where debug dumps go; without it none are written. */
  dumpsDir?: string;
  /** Names the session files and dates live sessions. Default `Date.now`. */
  wallClock?: () => number;
  /**
   * Live only: re-evaluates the feed's health every `everyMs`, at `clock()` (the source's receive clock), so a
   * silent feed turns stale without a packet arriving. Replays leave it out and stay clock-free.
   */
  staleCheck?: { clock: () => number; everyMs: number };
  /** Dev mode: times every calculator run. */
  calcStats?: CalcStats;
  /** Live only: whether realism mode is on for the next session; read when a session starts and fixed for it. Replays use the config's value. */
  realismNextSession?: () => boolean;
};

type SessionStarted = Extract<TrackerEvent, { type: 'sessionStarted' }>;

/**
 * Runs one feed: every datagram updates the feed's health, the tracker splits the stream into sessions and frames,
 * and each session runs in its own `SessionProcessor`. Nothing a datagram does throws out of the pipeline:
 * decode errors are counted, write failures become insights, bugs are logged.
 */
export class FeedPipeline {
  /** Settles once the source is done, the last session has ended and its file is closed; rejects with a source failure. */
  readonly done: Promise<void>;
  readonly #o: FeedPipelineOptions;
  readonly #feedId: FeedId;
  readonly #log: Logger;
  readonly #config: FeatureConfig;
  readonly #registry: CalculatorRegistry;
  readonly #demand: ReturnType<typeof demandOf>;
  readonly #publisher: TopicPublisher;
  readonly #jobs: FeedJobs;
  readonly #tracker: SessionTracker;
  readonly #monitor = new FeedMonitor();
  readonly #alerts: FeedAlerts;
  readonly #wallClock: () => number;
  readonly #sessionClock: SessionClock;
  readonly #done: PromiseWithResolvers<void> = Promise.withResolvers();
  /** Session files still closing; each leaves the set once closed. */
  readonly #closing = new Set<Promise<void>>();
  #session: SessionProcessor | undefined;
  /** The last session that ended, file closed; it stays evaluable for late subscribers until the next session starts. */
  #ended: SessionProcessor | undefined;
  #lastReceivedAtMs = 0;
  #staleTimer: NodeJS.Timeout | undefined;
  #started = false;

  constructor(opts: FeedPipelineOptions) {
    this.#o = opts;
    this.#feedId = opts.feedId;
    this.#log = opts.log;
    // Fixed for the run; changing the config from the UI at runtime comes later (it needs a new sidecar per change).
    this.#config = effectiveConfig(opts.features, opts.config);
    this.#jobs = new FeedJobs(opts.features, (result) =>
      this.#guarded('job result', () => this.#onJobResult(result)),
    );
    this.#registry = CalculatorRegistry.build([...opts.features.flatMap((feature) => feature.calculators), ...this.#jobs.calculators]);
    this.#demand = demandOf(opts.features, this.#registry);
    this.#publisher = new TopicPublisher({ feedId: opts.feedId, hub: opts.hub, features: opts.features, log: opts.log });
    this.#tracker = new SessionTracker({ feedId: opts.feedId });
    this.#alerts = new FeedAlerts(opts.feedId);
    this.#wallClock = opts.wallClock ?? Date.now;
    this.#sessionClock = sessionClock({ sourcePath: opts.storage?.sourcePath, wallClock: this.#wallClock, log: opts.log });
    this.done = this.#done.promise;
    this.done.catch(() => {});
  }

  start(): void {
    if (this.#started) throw new Error('FeedPipeline: already started');
    this.#started = true;
    const { source, staleCheck } = this.#o;
    source.start((packet) => this.#onPacket(packet));
    if (staleCheck !== undefined) {
      this.#staleTimer = setInterval(() => this.#guarded('stale check', () => this.#checkFeed(staleCheck.clock())), staleCheck.everyMs);
    }
    this.#finish().then(this.#done.resolve, this.#done.reject);
  }

  /**
   * The hub's subscriptions changed (wire `TopicHub`'s `onDemandChange` to it): the running session takes the new set
   * of needed calculators and evaluates the newly needed ones at once (ruling R9); a later session reads the set when
   * it starts. Once a session has ended, it still answers until the next one starts, so a subscriber that arrives
   * after a replay has finished gets the final values. Harmless before any session.
   */
  demandChanged(): void {
    this.#guarded('demand change', () => (this.#session ?? this.#ended)?.demandChanged());
  }

  /** Stops the source and resolves once `done` has settled; the feed's job runner is closed by then. */
  async stop(): Promise<void> {
    if (!this.#started) {
      this.#started = true;
      this.#done.resolve();
    }
    await this.#o.source.stop();
    await this.done.catch(() => {});
  }

  async #finish(): Promise<void> {
    let failure: { error: unknown } | undefined;
    try {
      await this.#o.source.done;
    } catch (error) {
      failure = { error };
      this.#log.error({ feedId: this.#feedId, err: error }, 'packet source failed');
    }
    clearInterval(this.#staleTimer);
    this.#guarded('stream end', () => {
      for (const event of this.#tracker.end()) this.#handle(event, this.#lastReceivedAtMs);
    });
    await this.#jobs.close();
    await Promise.all(this.#closing);
    if (failure !== undefined) throw failure.error;
  }

  #onPacket({ receivedAtMs, bytes }: RawPacket): void {
    this.#lastReceivedAtMs = receivedAtMs;
    this.#monitor.onPacket(receivedAtMs);
    this.#guarded('datagram', () => {
      const decoded = decode(bytes);
      if (decoded.ok) {
        for (const event of this.#tracker.push(decoded.packet, receivedAtMs)) this.#handle(event, receivedAtMs);
      } else {
        this.#monitor.onDecodeError(decoded.error, receivedAtMs);
        this.#log.debug({ feedId: this.#feedId, error: decoded.error }, 'datagram not decoded');
      }
      this.#session?.record(receivedAtMs, bytes);
      const metrics = this.#tracker.metrics;
      this.#monitor.sample(metrics, receivedAtMs);
      this.#checkFeed(receivedAtMs, metrics);
    });
  }

  #handle(event: TrackerEvent, receivedAtMs: number): void {
    switch (event.type) {
      case 'sessionStarted':
        this.#startSession(event);
        return;
      case 'frame':
        this.#session?.push(event.frame);
        return;
      case 'sessionEnded':
        this.#endSession(receivedAtMs);
        return;
    }
  }

  /** A new session: every topic of the feed starts over, apart from the feed's own insights that still hold. */
  #startSession(event: SessionStarted): void {
    const { feedId, hub, log, dumpsDir } = this.#o;
    this.#ended = undefined;
    this.#alerts.clearWriteFailures(this.#sessionTime());
    hub.resetFeed(feedId);
    this.#publishInsights(this.#alerts.active.map((insight) => ({ type: 'raised', insight })));
    const startedAt = this.#sessionClock(event.receivedAtMs);
    const db = this.#o.storage?.db;
    const storage = db && new SessionStorage(db, { log, onError: (error) => this.#writeFailed('storage', error) });
    const config = this.#sessionConfig();
    const file = this.#openSessionFile(event, startedAt, config);
    // A session processed from a recording points at that recording (so `reprocess` finds it), a live one at its own file.
    const sourcePath = this.#o.storage?.sourcePath;
    const pwrecPath = sourcePath !== undefined ? resolve(sourcePath) : (file?.path ?? null);
    this.#session = new SessionProcessor({
      feedId,
      sessionUid: event.sessionUid,
      session: event.session,
      startedAt,
      pwrecPath,
      registry: this.#registry,
      needed: () => this.#demand(hub.subscribedTopics(feedId)),
      publisher: this.#publisher,
      jobs: this.#jobs,
      log,
      config,
      feedView: () => this.#monitor.view(this.#tracker.metrics, this.#lastReceivedAtMs),
      ...(storage && { storage }),
      ...(file && { file }),
      ...(dumpsDir !== undefined && { dumpsDir }),
      ...(this.#o.calcStats && { calcStats: this.#o.calcStats }),
    });
  }

  /** The run's config with `realism.enabled` taken from the live hook, if any; fixed for the whole session. */
  #sessionConfig(): FeatureConfig {
    const { realismNextSession } = this.#o;
    if (realismNextSession === undefined) return this.#config;
    return { ...this.#config, realism: { ...this.#config.realism, enabled: realismNextSession() } };
  }

  #openSessionFile(event: SessionStarted, startedAt: string, config: FeatureConfig): SessionFile | undefined {
    const dir = this.#o.storage?.recordingsDir;
    if (dir === undefined) return undefined;
    const file = new SessionFile({
      dir,
      name: sessionRecordingName(this.#wallClock(), event.sessionUid),
      meta: { recorderVersion: 'pitwall-bridge', startedAt, listenPort: 0 },
      originMs: event.receivedAtMs,
      onError: (error) => this.#writeFailed('pwrec', error),
    });
    this.#writeConfigSidecar(file.path, config);
    return file;
  }

  /** The config the session runs with, next to its file, so a replay reproduces its alarms. A failure is a write failure of the session file. */
  #writeConfigSidecar(sessionFilePath: string, config: FeatureConfig): void {
    try {
      writeFileSync(sessionConfigPath(sessionFilePath), `${JSON.stringify(config, null, 2)}\n`);
    } catch (error) {
      this.#writeFailed('pwrec', error);
    }
  }

  #endSession(receivedAtMs: number): void {
    const session = this.#session;
    if (session === undefined) return;
    this.#session = undefined;
    this.#ended = session;
    this.#jobs.sessionEnded();
    const closing = session.end(receivedAtMs).finally(() => this.#closing.delete(closing));
    this.#closing.add(closing);
  }

  /** Publishes `feed.status` and the feed-health insights as they stand at `nowMs`. */
  #checkFeed(nowMs: number, metrics: FrameMetrics = this.#tracker.metrics): void {
    const view = this.#monitor.view(metrics, nowMs);
    const status = feedStatusOf(this.#feedId, view);
    // The pre-session producer: the feed is watched before any session exists, so the pipeline publishes it per
    // datagram. Inside a session the `feed-status` feature also publishes the same value per frame. Two producers
    // by decision, until a feed-level binding kind replaces this one (sub-project 2).
    this.#o.hub.publishState(this.#feedId, 'feed.status', () => status);
    this.#publishInsights(this.#alerts.feedChanged(view, metrics.lastSessionTime ?? toSessionTime(0)));
  }

  /** A result only ever arrives for the running session: `#endSession` drops the runs of an ended one. */
  #onJobResult(result: JobResult): void {
    const { jobId, computedFor } = result;
    if ('error' in result) this.#log.error({ feedId: this.#feedId, jobId, computedFor, error: result.error }, 'job failed, topic marked errored');
    for (const { topic, error } of this.#publisher.publishJobResult(result)) {
      this.#log.error({ feedId: this.#feedId, jobId, topic, err: error }, 'job result not published, marked errored');
    }
  }

  #writeFailed(failure: WriteFailure, error: unknown): void {
    this.#log.error({ feedId: this.#feedId, failure, err: error }, 'write failed, off for the rest of the session');
    this.#publishInsights(this.#alerts.writeFailed(failure, error, this.#sessionTime()));
  }

  /** The feed's own insights; outside a frame, a topic that fails to take them is only logged. */
  #publishInsights(changes: readonly InsightChange[]): void {
    for (const { topic, error } of this.#publisher.publishInsights(changes)) {
      this.#log.error({ feedId: this.#feedId, topic, err: error }, 'topic not published, marked errored');
    }
  }

  /** Feed-level insights are stamped with the newest session time seen, 0 before any. */
  #sessionTime(): SessionTime {
    return this.#tracker.metrics.lastSessionTime ?? toSessionTime(0);
  }

  /** Bugs are logged, never thrown into the source's callback or a timer. */
  #guarded(what: string, work: () => void): void {
    try {
      work();
    } catch (err) {
      this.#log.error({ feedId: this.#feedId, err }, `${what} processing failed`);
    }
  }
}
