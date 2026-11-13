// One feed end to end (spec 4): PacketSource → decode → SessionTracker → SessionProcessor → TopicHub,
// with the feed's health, its session files and its storage alongside.
import { resolve } from 'node:path';
import type { ConfigEffectiveValue } from '@pitwall/contracts';
import { toSessionTime, type CalibrationActiveValue, type FeedId, type Known, type LiveSeat, type PriorsSnapshot, type ProfileSnapshot, type RunPriors, type SessionRef, type SessionTime, type TeamId, type TrackFile } from '@pitwall/domain';
import type { CalibrationStore } from '../calibration/store.ts';
import type { ProfileStore, SlotIdentity } from '../drivers/store.ts';
import { profilesSidecarPath } from './profile-sidecar.ts';
import { CalculatorRegistry, SessionTracker, type Frame, type FrameMetrics, type InsightChange, type TrackerEvent } from '@pitwall/engine';
import { decode } from '@pitwall/protocol';
import { effectiveConfig, overriddenFields, sessionConfigPath, sessionConfigSidecar, type FeatureConfig } from '../feature-config.ts';
import type { Feature } from '../features/feature.ts';
import { feedStatusOf } from '../features/feed-status/feed-status.ts';
import type { TopicHub } from '../hub/topic-hub.ts';
import type { PacketSource, RawPacket } from '../input/packet-source.ts';
import { FeedJobs } from '../jobs/feed-jobs.ts';
import type { JobResult } from '../jobs/job-runner.ts';
import type { Logger } from '../log.ts';
import type { Db, StoredSessionRow } from '../storage/db.ts';
import { SessionFile, sessionRecordingName } from '../storage/session-files.ts';
import { loadTrackFile, TRACKS_DIR, trackSidecarPath } from '../track-files/load.ts';
import { decisionsSidecarPath, noRunPriors, priorsSidecarPath, writeSidecar, type GivenDecision, type RecordedDecision, type RecordedRun } from './decision-sidecars.ts';
import { RecordedPlacement } from './decision-placement.ts';
import { FeedAlerts, type WriteFailure } from './feed-alerts.ts';
import { demandOf } from './demand.ts';
import type { CalcStats } from '../dev/calc-stats.ts';
import { FeedMonitor } from './feed-monitor.ts';
import { sessionClock, type SessionClock } from './session-clock.ts';
import { playerCarOf, SessionProcessor } from './session-processor.ts';
import { SessionStorage, type StorageMode } from './session-storage.ts';
import type { PlanDecision, TeamFeeds } from './team-feeds.ts';
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
   * is stored as the sessions' recording (`reprocess` reads them from there). `rulesVersion`: the rules version the logs
   * are stored with (C61). `mode`: `append` (default, live) appends each session's log as it grows; `replace` (a
   * rebuild of a recording) writes it once, at the session's end, replacing the stored one (C24). `rebuild`: rebuilds,
   * in the background, an earlier session of the weekend whose stored log is not complete (C61).
   */
  storage?: {
    db: Db;
    rulesVersion: string;
    mode?: StorageMode;
    recordingsDir?: string;
    sourcePath?: string;
    rebuild?: (row: StoredSessionRow) => Promise<void>;
    /** Live: called once a session's log is stored complete (`serve` recomputes the calibration store, ruling R14). */
    onStored?: () => void;
  };
  /**
   * Live: the calibration store's slice a run uses (C62a, spec 3.3). A session starts on the track's preselection
   * (marked used), and `commitDecision` takes a picked set's snapshot from it. Without it (and without `recorded`) a run
   * has no priors (`notApplicable`) and takes no picks. `trackOf` finds a picked set's track before any session on the
   * feed; without it such a pick is rejected.
   */
  calibration?: Pick<CalibrationStore, 'preselect' | 'snapshotOf' | 'markUsed'> & Partial<Pick<CalibrationStore, 'trackOf'>>;
  /**
   * A replay: the recording's priors and decisions sidecars (`recordingDecisions`, C38, C76). Every session starts on
   * their priors, and each decision is handed to the running session before the record it was committed at.
   */
  recorded?: RecordedRun;
  /**
   * Live: the profile store's slice a run uses (C62c, SP4.3a spec 4). Each session asks it once, at its start, for the
   * profile snapshot of its slots; the snapshot is fixed for the run, goes to `<file>.profiles.json` and to the scheduler
   * as `SchedulerInput.drivers`. Without it (and without `recordedProfiles`) a run's `drivers` is `null`. The pipeline
   * also tells it the feed's human seats as they change (`feedSeats`, SP4.3b2 Task 10), and none once a session ends
   * or the feed stops.
   */
  profiles?: Pick<ProfileStore, 'snapshotFor' | 'feedSeats'>;
  /** A replay: the recording's profiles sidecar (`recordingProfiles`, C38); `null` for a recording without one. */
  recordedProfiles?: ProfileSnapshot | null;
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
  /** Test aid (`PITWALL_E2E_INSIGHT`): the key of one critical insight raised when the pipeline starts; see `FeedAlerts.raiseTestInsight`. */
  testInsight?: string;
  /** Live only: whether realism mode is on for the next session; read when a session starts and fixed for it. Replays use the config's value. */
  realismNextSession?: () => boolean;
  /**
   * The track file of a session's track id, resolved once when the session starts (C62b). Default: the committed file
   * (`loadTrackFile(id, TRACKS_DIR)`); a pipeline built from a recording passes `recordingTrack(file, id, TRACKS_DIR)`.
   */
  tracks?: (trackId: number) => Known<TrackFile>;
  /**
   * The bridge's team bookkeeping (C1a): the pipeline reports its session uid when a session starts and its player car's
   * team once the session's Participants name it.
   */
  teams?: TeamFeeds;
};

/** A feed's session uid and its player car's team (`null` before Participants), as reported to `teams`. */
type Seat = { sessionUid: string; team: TeamId | null };

/**
 * Where the feed is: the newest frame's session time and the player's lap. The time is the game's own, not the race
 * clock: `--at-time` and the dev supervisor's restart (`jumpToTime`) name a moment of the recording by it.
 */
export type FeedPosition = { sessionTimeMs: number; playerLap: number };

type SessionStarted = Extract<TrackerEvent, { type: 'sessionStarted' }>;

/** The answer to a pick (`commitDecision`), as the WebSocket server sends it back (C73). */
export type DecisionResult = { ok: true } | { ok: false; reason: 'invalid' | 'notSupported'; message: string };

/** A session's decisions as its decisions sidecar holds them, and where that sidecar goes (none without a session file). */
type SessionDecisions = { trackId: number; file: string | undefined; decisions: RecordedDecision[] };

/** The track sidecar of a session without a valid track file (C62b). */
const NOT_APPLICABLE_SIDECAR = { known: false, reason: 'notApplicable' } as const;

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
  /** Per config key, the fields `config.json` set (`config.effective`). */
  readonly #overridden: Record<string, string[]>;
  readonly #registry: CalculatorRegistry;
  readonly #demand: ReturnType<typeof demandOf>;
  readonly #publisher: TopicPublisher;
  readonly #jobs: FeedJobs;
  readonly #tracker: SessionTracker;
  readonly #monitor = new FeedMonitor();
  readonly #alerts: FeedAlerts;
  readonly #wallClock: () => number;
  readonly #sessionClock: SessionClock;
  readonly #tracks: (trackId: number) => Known<TrackFile>;
  readonly #done: PromiseWithResolvers<void> = Promise.withResolvers();
  /** Session files still closing; each leaves the set once closed. */
  readonly #closing = new Set<Promise<void>>();
  #session: SessionProcessor | undefined;
  /** The last session that ended, file closed; it stays evaluable for late subscribers until the next session starts. */
  #ended: SessionProcessor | undefined;
  #lastReceivedAtMs = 0;
  #position: FeedPosition | undefined;
  #staleTimer: NodeJS.Timeout | undefined;
  #started = false;
  /** `stop()` was called: the sessions still open end before their input did. */
  #stopped = false;
  /** A replay's recorded decisions by the record index they go before. */
  readonly #recorded: RecordedPlacement<GivenDecision>;
  /** The newest session's decisions (kept once it ended: a pick then only marks its set used). */
  #decisions: SessionDecisions | undefined;
  /** The newest session's seat as last reported to `teams`. */
  #seat: Seat | undefined;

  constructor(opts: FeedPipelineOptions) {
    this.#o = opts;
    this.#feedId = opts.feedId;
    this.#log = opts.log;
    // Fixed for the run; changing the config from the UI at runtime comes later (it needs a new sidecar per change).
    this.#config = effectiveConfig(opts.features, opts.config);
    this.#overridden = overriddenFields(opts.config);
    this.#jobs = new FeedJobs(opts.features, (result) =>
      this.#guarded('job result', () => this.#onJobResult(result)),
    );
    this.#registry = CalculatorRegistry.build([...opts.features.flatMap((feature) => feature.calculators), ...this.#jobs.calculators]);
    this.#demand = demandOf(opts.features, this.#registry);
    this.#publisher = new TopicPublisher({ feedId: opts.feedId, hub: opts.hub, features: opts.features, log: opts.log });
    this.#tracker = new SessionTracker({ feedId: opts.feedId });
    this.#alerts = new FeedAlerts(opts.feedId);
    this.#wallClock = opts.wallClock ?? Date.now;
    this.#tracks = opts.tracks ?? ((trackId) => loadTrackFile(trackId, TRACKS_DIR, opts.log));
    this.#sessionClock = sessionClock({ sourcePath: opts.storage?.sourcePath, wallClock: this.#wallClock, log: opts.log });
    this.#recorded = new RecordedPlacement(opts.recorded?.decisions ?? []);
    this.done = this.#done.promise;
    this.done.catch(() => {});
  }

  /**
   * The user picked a calibration set, or `defaults` (`null`), for the running session (`calibration.choose`, C62a,
   * C76; spec 3.3): the set's current snapshot joins the run's priors and the priors sidecar, the decision
   * `calibrationChosen { setId, snapshot }` goes to the runner with the next frame and, with its record index, to the
   * decisions sidecar; the set is marked used. Without a running session a pick only marks the set used (the newest
   * session's track; before any session, the set's own track). An unknown set (of the newest session's track, or before
   * any session of any track) is rejected, with or without a running session (C73); `defaults` before any session
   * changes nothing. A pipeline without a calibration store takes no picks.
   */
  commitDecision(setId: string | null): DecisionResult {
    const calibration = this.#o.calibration;
    if (calibration === undefined) return { ok: false, reason: 'notSupported', message: 'this feed takes no calibration picks' };
    const run = this.#decisions;
    const session = this.#session;
    if (run === undefined) {
      if (setId === null) return { ok: true };
      const trackId = calibration.trackOf?.(setId);
      if (trackId === undefined) return { ok: false, reason: 'invalid', message: `no calibration set ${setId}` };
      calibration.markUsed(trackId, setId, this.#now());
      return { ok: true };
    }
    const snapshot: PriorsSnapshot | undefined = setId === null ? undefined : calibration.snapshotOf(run.trackId, setId);
    if (setId !== null && snapshot === undefined) {
      return { ok: false, reason: 'invalid', message: `no calibration set ${setId} on track ${run.trackId}` };
    }
    if (session === undefined) {
      if (setId !== null) calibration.markUsed(run.trackId, setId, this.#now());
      return { ok: true };
    }
    this.#choose(session, run, setId, snapshot);
    if (setId !== null) calibration.markUsed(run.trackId, setId, this.#now());
    return { ok: true };
  }

  /**
   * A calibration edit of the set `setId` was applied (C62a, C76): a running session on that set commits
   * `calibrationChosen` with the set's new snapshot, exactly as a pick does. Nothing is committed without a running
   * session, for a run on another set or on `defaults`, when the snapshot's fingerprint is the run's active one, or when
   * the set is gone (a delete: the run keeps the snapshot it has, ruling R29). Never throws.
   */
  calibrationEdited(setId: string): void {
    this.#guarded('calibration edit', () => {
      const calibration = this.#o.calibration;
      const run = this.#decisions;
      const session = this.#session;
      if (calibration === undefined || run === undefined || session === undefined) return;
      const active = session.activeChoice;
      if (active.setId !== setId) return;
      const snapshot = calibration.snapshotOf(run.trackId, setId);
      if (snapshot === undefined || snapshot.fingerprint === active.snapshot) return;
      this.#choose(session, run, setId, snapshot);
    });
  }

  /**
   * Commits `calibrationChosen { setId, snapshot }` to the running session: the snapshot joins the run's priors, the
   * decision goes to the runner with the next frame and, placed at the session's record index, to the decisions sidecar.
   */
  #choose(session: SessionProcessor, run: SessionDecisions, setId: string | null, snapshot: PriorsSnapshot | undefined): void {
    const decision: GivenDecision = { kind: 'calibrationChosen', setId, snapshot: snapshot?.fingerprint ?? null };
    session.decide(decision, snapshot);
    run.decisions.push(session.place(decision));
    if (run.file !== undefined) {
      this.#writeSidecar(priorsSidecarPath(run.file), session.priors);
      this.#writeSidecar(decisionsSidecarPath(run.file), run.decisions);
    }
  }

  /** The running session's race laps; `undefined` without a running session. */
  totalLaps(): number | undefined {
    return this.#session?.totalLaps;
  }

  /**
   * A plan decision for the running session (`plan.commit`, `plan.clear`; C76, SP4.3b spec §8.2), as `PlanRouting` hands
   * it to each of the team's feeds: it goes to the runner with the next frame and, placed at the session's record index,
   * to the decisions sidecar. Without a running session it is not taken.
   */
  commitPlan(decision: PlanDecision): DecisionResult {
    const run = this.#decisions;
    const session = this.#session;
    if (run === undefined || session === undefined) return { ok: false, reason: 'notSupported', message: 'this feed runs no session' };
    session.decide(decision);
    run.decisions.push(session.place(decision));
    if (run.file !== undefined) this.#writeSidecar(decisionsSidecarPath(run.file), run.decisions);
    return { ok: true };
  }

  start(): void {
    if (this.#started) throw new Error('FeedPipeline: already started');
    this.#started = true;
    const { source, staleCheck, testInsight } = this.#o;
    if (testInsight !== undefined) this.#publishInsights(this.#alerts.raiseTestInsight(testInsight, this.#sessionTime()));
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

  /** The newest frame's position; undefined before any frame, and still readable after the source ended. */
  position(): FeedPosition | undefined {
    return this.#position;
  }

  /** Stops the source and resolves once `done` has settled; the feed's job runner is closed by then. */
  async stop(): Promise<void> {
    this.#stopped = true;
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
    // A feed that stopped runs no seat (C62c).
    this.#reportHumanSeats([]);
    await this.#jobs.close();
    await Promise.all(this.#closing);
    if (failure !== undefined) throw failure.error;
  }

  #onPacket(packet: RawPacket): void {
    // A replay's decisions go to the running session before the record they were committed at (C76): the frame they
    // land on is the one their live pick landed on. The placement module owns that order.
    this.#recorded.deliver(packet, {
      decide: (decision) => this.#guarded('recorded decision', () => this.#session?.decide(decision)),
      process: (record) => this.#process(record),
    });
  }

  /** One datagram: decoded, pushed through the tracker, recorded in the session file, and the feed's health checked. */
  #process({ receivedAtMs, bytes }: RawPacket): void {
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
        this.#updatePosition(event.frame);
        this.#updateTeam(event.frame);
        this.#session?.push(event.frame);
        return;
      case 'sessionEnded':
        this.#endSession(receivedAtMs);
        return;
    }
  }

  /** The position follows the newest frame; without lap data it keeps the last lap, and stays unknown until one is seen. */
  #updatePosition(frame: Frame): void {
    const playerLap = frame.lapData?.lapData[frame.playerCarIndex]?.currentLapNum ?? this.#position?.playerLap;
    if (playerLap !== undefined) this.#position = { sessionTimeMs: frame.sessionTime, playerLap };
  }

  /**
   * The player car's team from the frame's Participants, reported to `teams` when it changes. Live, once the team is
   * first known, the session is handed each car's newest plan decision of the team (C76): this frame carries them, and
   * a replay, which has them in its decisions sidecar at the record index they were placed at, gives them to it too.
   */
  #updateTeam(frame: Frame): void {
    const seat = this.#seat;
    const team = frame.participants?.participants[frame.playerCarIndex]?.teamId;
    if (seat === undefined || team === undefined || team === seat.team) return;
    this.#reportSeat({ sessionUid: seat.sessionUid, team });
    if (seat.team !== null || this.#o.recorded !== undefined || this.#o.teams === undefined) return;
    for (const decision of this.#o.teams.plansOf(this.#feedId)) this.commitPlan(decision);
  }

  #reportSeat(seat: Seat): void {
    this.#seat = seat;
    this.#o.teams?.report(this.#feedId, seat.sessionUid, seat.team);
  }

  /** A new session: every topic of the feed starts over, apart from the feed's own insights that still hold. */
  #startSession(event: SessionStarted): void {
    const { feedId, hub, log, dumpsDir } = this.#o;
    this.#ended = undefined;
    this.#reportSeat({ sessionUid: String(event.sessionUid), team: null });
    this.#alerts.clearWriteFailures(this.#sessionTime());
    hub.resetFeed(feedId);
    this.#publisher.sessionStarted();
    this.#publishInsights(this.#alerts.active.map((insight) => ({ type: 'raised', insight })));
    const startedAt = this.#sessionClock(event.receivedAtMs);
    const storage = this.#sessionStorage();
    const config = this.#sessionConfig();
    this.#publishEffectiveConfig(config);
    const track = this.#tracks(event.session.trackId);
    const priors = this.#startPriors(event.session.trackId);
    const file = this.#openSessionFile(event, startedAt, config, track, priors);
    this.#decisions = { trackId: event.session.trackId, file: file?.path, decisions: [] };
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
      track,
      priors,
      onActive: (value: CalibrationActiveValue) => hub.publishState(feedId, 'calibration.active', () => value),
      profilesFor: (slots, session) => this.#profilesFor(slots, session, file?.path),
      ...(this.#o.profiles && { onSeats: (seats: Omit<LiveSeat, 'feedId'>[]) => this.#reportHumanSeats(seats) }),
      feedView: () => this.#monitor.view(this.#tracker.metrics, this.#lastReceivedAtMs),
      ...(storage && { storage }),
      ...(file && { file }),
      ...(dumpsDir !== undefined && { dumpsDir }),
      ...(this.#o.calcStats && { calcStats: this.#o.calcStats }),
    });
  }

  /** A new session's storage, if the pipeline stores. */
  #sessionStorage(): SessionStorage | undefined {
    const storage = this.#o.storage;
    if (storage === undefined) return undefined;
    return new SessionStorage(storage.db, {
      log: this.#log,
      onError: (error) => this.#writeFailed('storage', error),
      rulesVersion: storage.rulesVersion,
      mode: storage.mode ?? 'append',
      ...(storage.rebuild && { rebuild: storage.rebuild }),
      ...(storage.onStored && { onStored: storage.onStored }),
    });
  }

  /**
   * The run's priors at session start (C62a, spec 3.3): a replay's recorded ones; live, the calibration store's
   * preselection for the track, marked used; else none (`notApplicable`).
   */
  #startPriors(trackId: number): RunPriors {
    const { recorded, calibration } = this.#o;
    if (recorded !== undefined) return recorded.priors;
    if (calibration === undefined) return noRunPriors();
    try {
      const start = calibration.preselect(trackId);
      if (start === null) return noRunPriors();
      calibration.markUsed(trackId, start.setId, this.#now());
      return { start: start.fingerprint, snapshots: { [start.fingerprint]: start } };
    } catch (error) {
      this.#log.error({ feedId: this.#feedId, trackId, err: error }, 'calibration preselection failed: the run has no priors');
      return noRunPriors();
    }
  }

  /**
   * The run's profile snapshot (C62c), asked once per session, on its first frame with Participants: a replay's recorded
   * one (C38); live, the profile store's for the session's slots, written to the profiles sidecar; else none (`null`).
   */
  #profilesFor(slots: readonly SlotIdentity[], session: SessionRef, file: string | undefined): ProfileSnapshot | null {
    const { recordedProfiles, profiles } = this.#o;
    if (recordedProfiles !== undefined) return recordedProfiles;
    if (profiles === undefined) return null;
    const snapshot = profiles.snapshotFor(slots, session);
    if (file !== undefined) this.#writeSidecar(profilesSidecarPath(file), snapshot);
    return snapshot;
  }

  /** The feed's human seats to the profile store (`drivers.links.unlinkedSeats`, C62c); a failure is logged, never thrown. */
  #reportHumanSeats(seats: readonly Omit<LiveSeat, 'feedId'>[]): void {
    const { profiles } = this.#o;
    if (profiles === undefined) return;
    this.#guarded('human seats', () => profiles.feedSeats(this.#feedId, seats));
  }

  /** Now as an ISO date: when a set was used (spec 3.1 `lastUsedAt`). */
  #now(): string {
    return new Date(this.#wallClock()).toISOString();
  }

  /**
   * `config.effective` (C47, C54, C55): the session's config, every declared key with its value, and per key the fields
   * `config.json` set; published by the pipeline itself, typed by its topic file, once per session start.
   */
  #publishEffectiveConfig(config: FeatureConfig): void {
    const value: ConfigEffectiveValue = {
      values: config,
      overridden: Object.fromEntries(Object.keys(config).map((key) => [key, this.#overridden[key] ?? []])),
    };
    this.#o.hub.publishState(this.#feedId, 'config.effective', () => value);
  }

  /** The run's config with `realism.enabled` taken from the live hook, if any; fixed for the whole session. */
  #sessionConfig(): FeatureConfig {
    const { realismNextSession } = this.#o;
    if (realismNextSession === undefined) return this.#config;
    return { ...this.#config, realism: { ...this.#config.realism, enabled: realismNextSession() } };
  }

  #openSessionFile(event: SessionStarted, startedAt: string, config: FeatureConfig, track: Known<TrackFile>, priors: RunPriors): SessionFile | undefined {
    const dir = this.#o.storage?.recordingsDir;
    if (dir === undefined) return undefined;
    const file = new SessionFile({
      dir,
      name: sessionRecordingName(this.#wallClock(), event.sessionUid, playerCarOf(event.session)),
      meta: { recorderVersion: 'pitwall-bridge', startedAt, listenPort: 0 },
      originMs: event.receivedAtMs,
      onError: (error) => this.#writeFailed('pwrec', error),
    });
    this.#writeSidecar(sessionConfigPath(file.path), sessionConfigSidecar(config, this.#overridden));
    // The track file the session runs with (C59, C62b); a session without a valid one writes a not-applicable sidecar,
    // so its replay stays notApplicable even after a committed file appears (C38).
    this.#writeSidecar(trackSidecarPath(file.path), track.known ? track.value : NOT_APPLICABLE_SIDECAR);
    // The priors the run starts on (C59, C62a): rewritten with each pick's snapshot; none gives `{ start: null }`.
    this.#writeSidecar(priorsSidecarPath(file.path), priors);
    // The run's driver profiles (C59, C62c): none until its slots are known; the snapshot replaces it then.
    this.#writeSidecar(profilesSidecarPath(file.path), this.#o.recordedProfiles ?? null);
    return file;
  }

  /**
   * A sidecar of the session file: the config, the track file or the priors the session runs with, or its decisions,
   * so a replay reproduces its stream (C38). A failure is a write failure of the session file.
   */
  #writeSidecar(path: string, value: unknown): void {
    try {
      writeSidecar(path, value);
    } catch (error) {
      this.#writeFailed('pwrec', error);
    }
  }

  #endSession(receivedAtMs: number): void {
    const session = this.#session;
    if (session === undefined) return;
    this.#session = undefined;
    this.#ended = session;
    // A session that ended runs no seat any more (C62c).
    this.#reportHumanSeats([]);
    this.#jobs.sessionEnded();
    const closing = session.end(receivedAtMs, { interrupted: this.#stopped }).finally(() => this.#closing.delete(closing));
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
    this.#publishInsights(this.#alerts.feedChanged(view, this.#sessionTime()));
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

  /**
   * Feed-level insights are stamped on the engine's race clock (spec 3.3), like every entry the engine records: the
   * time of the newest frame the session's engine applied. Before the engine runs, no fall has moved the race clock
   * off the game's, so the newest session time seen stands in; 0 before any.
   */
  #sessionTime(): SessionTime {
    return (this.#session ?? this.#ended)?.sessionTime ?? this.#tracker.metrics.lastSessionTime ?? toSessionTime(0);
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
