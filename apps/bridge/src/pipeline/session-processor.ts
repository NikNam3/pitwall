// One session of a feed: frames → SessionRunner → Scheduler → topics, plus its session file and its storage.
import { sessionUidString, type FeedId, type ParticipantsValues, type SessionTime, type SessionUid } from '@pitwall/domain';
import {
  participantsValuesOf,
  projectionLengths,
  Scheduler,
  SessionRunner,
  situationOf,
  type CalculatorId,
  type CalculatorRegistry,
  type FeedMetricsView,
  type Frame,
  type SchedulerInput,
  type StepResult,
  type WeekendContext,
} from '@pitwall/engine';
import type { TopicName } from '@pitwall/contracts';
import { peekHeader, type SessionPacket } from '@pitwall/protocol';
import type { CalcStats } from '../dev/calc-stats.ts';
import type { FeatureConfig } from '../feature-config.ts';
import type { FeedJobs } from '../jobs/feed-jobs.ts';
import type { Logger } from '../log.ts';
import type { SessionKey, SessionRow } from '../storage/db.ts';
import type { SessionFile } from '../storage/session-files.ts';
import { MAX_DUMPS_PER_SESSION, writeDebugDump } from './debug-dump.ts';
import { sessionRowOf, type SessionStorage } from './session-storage.ts';
import type { PublishError, TopicPublisher } from './topic-publisher.ts';

export type SessionProcessorOptions = {
  feedId: FeedId;
  sessionUid: bigint;
  session: SessionPacket;
  /** ISO 8601, stored with the session. */
  startedAt: string;
  /** The recording that holds the session's datagrams, stored with it; `null` when there is none. */
  pwrecPath: string | null;
  registry: CalculatorRegistry;
  /** The calculators to run now; asked when the runner starts and on every `demandChanged()`. */
  needed: () => Iterable<CalculatorId>;
  publisher: TopicPublisher;
  /** The feed's jobs: those whose trigger calculator ran in a frame are started on its output. */
  jobs?: FeedJobs;
  log: Logger;
  /** The feed's health right now, for the calculators that read `feed`. */
  feedView: () => FeedMetricsView;
  /** The effective calculator config, the same for every frame of the session; `realism.enabled` switches realism mode on. */
  config: FeatureConfig;
  storage?: SessionStorage;
  file?: SessionFile;
  dumpsDir?: string;
  /** Dev mode: times every calculator run (see `createCalcStats`). */
  calcStats?: CalcStats;
};

/**
 * Runs one session (spec 5.4, 7.3). The runner holds the frames until the first Participants packet, which names the
 * player's `DriverKey` and so the weekend context (spec 9.3, C61); this processor supplies that context from storage
 * (`contextFor`). The scheduler is attached to the runner, so a flashback rewinds its bookkeeping with the state
 * (C27). An exception on a frame skips that frame, also among the held frames the runner releases after its identity
 * wait (the rest stay queued for the next call); a topic that fails to publish is marked errored while the other topics
 * go out. Either way the failure is logged and, up to `MAX_DUMPS_PER_SESSION` times, the frame is dumped with its place
 * in the session file (spec 10.1).
 */
export class SessionProcessor {
  readonly sessionUid: bigint;
  readonly #uid: SessionUid;
  /** The session's storage key: the game reuses session uids across weekends. */
  readonly #key: SessionKey;
  readonly #o: SessionProcessorOptions;
  readonly #runner: SessionRunner;
  readonly #scheduler: Scheduler;
  /** The runner applied a frame: its identity wait is over. */
  #started = false;
  #driversStored = false;
  #dumps = 0;
  #lastReceivedAtMs = 0;

  constructor(opts: SessionProcessorOptions) {
    this.#o = opts;
    this.sessionUid = opts.sessionUid;
    this.#uid = sessionUidString(opts.sessionUid);
    this.#key = { sessionUid: this.#uid, weekendId: String(opts.session.weekendLinkIdentifier) };
    const { feedId, sessionUid, session, registry } = opts;
    // `PITWALL_FREEZE_OUTPUTS=1` (the test runs set it) freezes every output, so a unit that changes one after returning it fails.
    const freezeOutputs = process.env.PITWALL_FREEZE_OUTPUTS === '1';
    this.#scheduler = new Scheduler(registry, { freezeOutputs, ...(opts.calcStats && { onCalculatorRun: opts.calcStats.hook }) });
    this.#runner = new SessionRunner(
      { feedId, sessionUid, session, realism: opts.config.realism?.enabled === true },
      { attach: this.#scheduler, contextFor: (participants) => this.#contextFor(participants) },
    );
    opts.storage?.upsertSession(this.#row());
  }

  /** The newest applied frame's time on the engine's race clock (spec 3.3); undefined before the engine runs. */
  get sessionTime(): SessionTime | undefined {
    return this.#started ? this.#runner.state.sessionTime : undefined;
  }

  push(frame: Frame): void {
    // The drivers are stored before the runner asks for the weekend context; a session started by the identity wait's
    // cap still stores them, so later sessions find it in the weekend.
    if (frame.participants !== undefined && !this.#driversStored) this.#storeDrivers(participantsValuesOf(frame, frame.participants).drivers);
    this.#applying(frame, () => this.#runner.apply(frame, this.#onResult));
  }

  /**
   * Keeps a datagram in the session file when it belongs here: the session's own uid, or uid 0 while it is open.
   * It runs after the datagram's frames, so a dump's position is approximate: the datagram before the one that
   * closed the frame.
   */
  record(receivedAtMs: number, bytes: Uint8Array): void {
    this.#lastReceivedAtMs = receivedAtMs;
    const uid = peekHeader(bytes)?.sessionUid;
    if (uid === this.sessionUid || uid === 0n) this.#o.file?.write(receivedAtMs, bytes);
  }

  /**
   * The set of needed calculators changed: the running scheduler takes the new set, and the calculators that became
   * needed are evaluated at once against the current state (ruling R9), so a late subscriber gets a value without
   * waiting for the next frame, or after the session ended. Before the runner starts, nothing to do yet.
   */
  demandChanged(): void {
    if (!this.#started) return;
    const scheduler = this.#scheduler;
    const needed = [...this.#o.needed()];
    const added = scheduler.setNeeded(needed);
    // Job triggers, and what only they read, sit the pass out: a job runs for a frame (`computedFor`), so the next due
    // frame starts it, and an event-cadence trigger is not used up before then.
    const forTopics = scheduler.withDependencies(needed.filter((id) => this.#o.jobs?.isTrigger(id) !== true));
    const only = new Set(added.filter((id) => forTopics.has(id)));
    if (only.size > 0) this.#evaluateNow(only);
  }

  /**
   * The session ended (`sessionEnded`: SEND, a new session, the end of input): runs whatever still waits for
   * Participants, closes every open span (`finish`, so the log is complete), then closes the session file.
   * `demandChanged()` still answers afterwards.
   */
  async end(receivedAtMs: number): Promise<void> {
    this.#applying(undefined, () => this.#runner.finish(this.#onResult));
    await this.#o.file?.close(receivedAtMs);
  }

  /** The player's earlier sessions of the weekend, with every driver in them; none without Participants. */
  #contextFor(participants: ParticipantsValues | undefined): WeekendContext | undefined {
    const driverKey = participants?.drivers.find((d) => d.carId === participants.playerCar)?.driverKey;
    return driverKey && this.#o.storage?.weekendContext(this.#key, driverKey);
  }

  #storeDrivers(drivers: ParticipantsValues['drivers']): void {
    this.#driversStored = true;
    this.#o.storage?.upsertSession(this.#row(drivers));
  }

  /**
   * Runs `work` (the runner applying frames). A step that throws skips its frame (`runner.applying`), which is reported;
   * the frames still queued behind it are applied by the next call.
   */
  #applying(frame: Frame | undefined, work: () => void): void {
    try {
      work();
    } catch (error) {
      const failed = this.#runner.applying ?? frame;
      if (failed === undefined) this.#o.log.error({ feedId: this.#o.feedId, sessionUid: this.#uid, err: error }, 'frame skipped: processing failed');
      else this.#report(failed, 'frame skipped: processing failed', [{ error }]);
    }
  }

  /** The live state as it is now (C39's `live`): what a `bindLive` topic's select reads when the hub sends its value. */
  readonly #live = () => this.#runner.state;

  /** Each frame the runner applied: storage, the scheduler and the topics. */
  readonly #onResult = (result: StepResult, frame: Frame): void => {
    const { feedId, publisher, storage, log } = this.#o;
    const scheduler = this.#scheduler;
    if (!this.#started) {
      this.#started = true;
      scheduler.setNeeded(this.#o.needed());
    }
    try {
      storage?.writeConfirmed(this.#key, result.state.history, result.delta);
      // A session time that fell back with no flashback and no start: the engine keeps its race clock monotonic (spec 3.3); worth knowing.
      if (result.clockFall) log.info({ feedId, sessionUid: this.#uid, clockFall: result.clockFall }, 'session time fell back');
      // A forward jump of over a minute that is no post-session jump (a stall while the garage clock runs ahead): it
      // changes nothing (spec 3.3); worth knowing too.
      if (result.clockJump) log.info({ feedId, sessionUid: this.#uid, clockJump: result.clockJump }, 'session time jumped forward');
      // A flashback is no fact (C27): a diagnostic line, with the game's target and the player's lap there.
      if (result.flashback) log.info({ feedId, sessionUid: this.#uid, flashback: result.flashback }, 'flashback');
      const { rewound } = result.delta;
      const unpublished: PublishError[] = [];
      if (rewound !== undefined) {
        // A flashback (the only rewind, C30) restored the scheduler's bookkeeping with the state (C27), also one to the
        // first snapshot (target frame -1). A run triggered before it would land on the new timeline.
        this.#o.jobs?.flashback();
        unpublished.push(...publisher.resendInsights(rewound));
      }
      this.#o.calcStats?.atSessionTime(result.state.sessionTime);
      const scheduled = scheduler.run(this.#schedulerInput(result.state, result.changed, result.delta));
      // Each topic is published on its own: a failing feature binding never holds back the others.
      unpublished.push(
        ...publisher.publishOutputs(scheduled),
        ...publisher.publishLive(this.#live),
        ...publisher.publishHistory(result.state.history, result.delta),
        ...publisher.publishInsights(scheduled.insights, { frameId: frame.frameId }),
      );
      const { cars, playerCar } = result.state;
      this.#o.jobs?.triggerRan(scheduled, { lap: cars[playerCar]?.timing.lap ?? 0, frameId: frame.frameId });
      for (const correction of result.corrections) log.info({ feedId, sessionUid: this.#uid, correction }, 'lap time corrected');
      if (unpublished.length > 0) this.#report(frame, 'topic not published, marked errored', unpublished);
    } catch (error) {
      this.#report(frame, 'frame skipped: processing failed', [{ error }]);
    }
  };

  /**
   * The scheduler's input for `state` (C39): its live state, situation and projection, the weekend's earlier sessions, the
   * run's config and the feed health; no priors (`{}` until the priors store exists, C62a).
   */
  #schedulerInput(state: StepResult['state'], changed: SchedulerInput['changed'], delta: SchedulerInput['delta']): SchedulerInput {
    return {
      live: state,
      situation: situationOf(state),
      history: state.history,
      changed,
      delta,
      weekend: state.weekend,
      feed: this.#o.feedView(),
      config: this.#o.config,
      priors: {},
    };
  }

  /**
   * One scheduler pass on the current state with nothing changed and an empty history delta, restricted to the newly
   * needed calculators `only`: one that never ran is due and runs. Every other calculator stays untouched, `feed`
   * readers included (re-running `feed.status` on the last packet's time would undo a stale status). The outputs and
   * insights are published; history topics have nothing new.
   */
  #evaluateNow(only: ReadonlySet<CalculatorId>): void {
    const { feedId, publisher, log } = this.#o;
    const scheduler = this.#scheduler;
    const { state } = this.#runner;
    this.#o.calcStats?.atSessionTime(state.sessionTime);
    const lengths = projectionLengths(state.history);
    const scheduled = scheduler.run(this.#schedulerInput(state, new Set(), { before: lengths, after: lengths }), { only });
    // A pass between frames: a flashback to the frame before it undoes it too.
    const unpublished = [...publisher.publishOutputs(scheduled), ...publisher.publishInsights(scheduled.insights, { frameId: state.lastFrameId, between: true })];
    for (const { error, topic } of unpublished) {
      log.error({ feedId, sessionUid: this.#uid, ...(topic && { topic }), err: error }, 'topic not published on a demand change, marked errored');
    }
  }

  /** Logs every failure of the frame and dumps the frame once, with the first failure. */
  #report(frame: Frame, message: string, failures: ReadonlyArray<{ error: unknown; topic?: TopicName }>): void {
    const { feedId, log } = this.#o;
    for (const { error, topic } of failures) {
      log.error({ feedId, sessionUid: this.#uid, frameId: frame.frameId, ...(topic && { topic }), err: error }, message);
    }
    if (failures[0] !== undefined) this.#dump(frame, failures[0].error);
  }

  #dump(frame: Frame, error: unknown): void {
    const { feedId, log, dumpsDir, file } = this.#o;
    if (dumpsDir === undefined || this.#dumps >= MAX_DUMPS_PER_SESSION) return;
    this.#dumps++;
    try {
      const pwrec = file?.position ?? { t: this.#lastReceivedAtMs };
      const path = writeDebugDump(dumpsDir, { feedId, sessionUid: this.sessionUid, frame, pwrec, error });
      log.info({ feedId, sessionUid: this.#uid, path }, 'debug dump written');
    } catch (dumpError) {
      log.error({ feedId, sessionUid: this.#uid, err: dumpError }, 'debug dump failed');
    }
  }

  /** The session's row from the engine's values: the session as the state holds it (the first Session packet's until a frame was applied). */
  #row(drivers?: ParticipantsValues['drivers']): SessionRow {
    const { startedAt, pwrecPath } = this.#o;
    return sessionRowOf({ sessionUid: this.#uid, session: this.#runner.state.session, startedAt, pwrecPath, ...(drivers && { drivers }) });
  }
}
