import type { FeedInfo, ReplayControl } from '@pitwall/contracts';
import type { FeedId, StrategyOutput } from '@pitwall/domain';
import { PLANNING_JOB, type StrategyInput } from '@pitwall/analysis';
import type { Job } from '@pitwall/engine/readers';
import { dirname } from 'node:path';
import { createFeedSeatStore } from '../planning/feed-seats.ts';
import { Planning, type PlanningAction } from '../planning/planning.ts';
import { suggestedLapsOf } from '../planning/round.ts';
import { createPlanningRunner } from '../planning/runner.ts';
import { SavedPlanStore } from '../planning/saved-plans.ts';
import { createPlanChoice } from '../planning/plan-choice.ts';
import { createRebuildService } from '../storage/rebuild-service.ts';
import { CalibrationStore, type ApplyResult, type CalibrationAction } from '../calibration/store.ts';
import { createCalcStats } from '../dev/calc-stats.ts';
import { readCatalogue } from '../dev/catalogue.ts';
import type { PositionMessage } from '../dev/dev-supervisor.ts';
import { effectiveConfig, type FeatureConfig } from '../feature-config.ts';
import { FEATURES } from '../features/index.generated.ts';
import { TopicHub } from '../hub/topic-hub.ts';
import type { PacketSource } from '../input/packet-source.ts';
import { WorkerLimit } from '../jobs/worker-limit.ts';
import { FeedPipeline, type FeedPipelineOptions } from '../pipeline/feed-pipeline.ts';
import { PlanRouting, type PlanAction } from '../pipeline/plan-routing.ts';
import { BasisRouting, type BasisAction } from '../pipeline/basis-routing.ts';
import { recordingBasis } from '../pipeline/basis-sidecar.ts';
import { createLastChoiceStore } from '../pipeline/last-choice.ts';
import type { LastChoiceStore, PlanChoice } from '../pipeline/last-choice-types.ts';
import type { RebuildService } from '../storage/rebuild-service-types.ts';
import { StaleSweep } from '../pipeline/stale-sweep.ts';
import { TeamFeeds } from '../pipeline/team-feeds.ts';
import type { StorageMode } from '../pipeline/session-storage.ts';
import { ReplayController } from '../replay/replay-controller.ts';
import { loadTrackFile, recordingTrack, TRACKS_DIR } from '../track-files/load.ts';
import { pruneEndedAcknowledgements } from '../ui-state/ack-pruning.ts';
import { DEFAULT_WORKBOOKS_DIR, seedDefaultWorkbooks } from '../ui-state/default-workbooks.ts';
import { UiState } from '../ui-state/ui-state.ts';
import { StartupError } from '../startup-error.ts';
import type { Db, SessionKey, StoredSessionRow } from '../storage/db.ts';
import { isStale, WeekendRepository } from '../storage/weekend-repository.ts';
import { WsServer, type ActionOutcome, type ChooseAction, type EndSessionAction } from '../ws/server.ts';
import { recordingDecisions } from '../pipeline/decision-sidecars.ts';
import { recordingProfiles } from '../pipeline/profile-sidecar.ts';
import { ProfileStore } from '../drivers/store.ts';
import { cliLogger, whenAborted, type CliIo } from './io.ts';
import type { RebuildProgress } from './rebuild-database.ts';

/** A recording served through a `ReplayController`; `controls` are applied (and any jump finished) before `listening` is printed. */
export type ReplayInput = { feedId: FeedId; path: string; controls: readonly ReplayControl[]; unpaced: boolean };

/** What a feed is called in the `hello` message. */
export type FeedLabel = Omit<FeedInfo, 'feedId' | 'team'>;

/**
 * One live feed (C1a): its packet source, which names its feed id, what it is called in `hello`, and its UDP port (the
 * meta `listenPort` of its recordings, by which the startup restore finds its sessions; unset: `0`).
 */
export type LiveFeed = { source: PacketSource; feed: FeedLabel; port?: number };

/** One live feed (`source`), several (`sources`, one pipeline each, in `hello` in this order), or a replay. */
export type ServeOptions = (
  | { source: PacketSource; feed: FeedLabel; replay?: never; sources?: never }
  | { sources: readonly LiveFeed[]; source?: never; replay?: never; feed?: never }
  | { replay: ReplayInput; feed: FeedLabel; source?: never; sources?: never }
) & ServeBase;

type ServeBase = {
  wsPort: number;
  dumpsDir: string;
  /**
   * `PITWALL_DATA_DIR/ui`: the UI state is kept there, and the shipped workbooks are seeded into it first.
   * Without it `uiAction` messages are answered with `notSupported`.
   */
  uiDir?: string;
  /**
   * Opened by the caller, closed by `serve` (also when it fails). `rulesVersion`: the logs are stored with it (C61);
   * `rebuild`: rebuilds a stored session found incomplete, in the background; nothing is rebuilt at start (C61).
   * `mode`: `append` (default) stores the run's own sessions; `read` (a replay, R21) stores nothing of them and only
   * reads the stored sessions their basis names (C38, C62), rebuilding a stale one first (C61); such a run opens no
   * calibration or profile store and no planning round.
   */
  storage?: {
    db: Db;
    recordingsDir: string;
    rulesVersion: string;
    mode?: Extract<StorageMode, 'append' | 'read'>;
    rebuild?: (row: StoredSessionRow) => Promise<void>;
    /**
     * The one rebuild service behind `rebuild` (`StaleSessions.rebuildService`): the basis's `ensureCurrent` and the
     * planning round's `ensureCurrent` and `replayToEnd` reach it with their priority (`runningBasis` before `planning`
     * before `firstRead`, C61). Without it the basis goes through `rebuild`'s queue, one row at a time, and the planning
     * round through a rebuild service of its own.
     */
    rebuildService?: Pick<RebuildService, 'ensureCurrent'> & Partial<Pick<RebuildService, 'replayToEnd'>>;
    /**
     * Handed, once the pipelines' map exists, the sessions the feeds run now (read at every call): the rebuild service
     * behind `rebuild` checks them when a rebuild is asked for, when it starts and at its swap (C24, C59).
     */
    onRunning?: (running: () => ReadonlyArray<SessionKey | undefined>) => void;
  };
  staleCheck?: FeedPipelineOptions['staleCheck'];
  /** For a source that binds a socket: resolves once it is bound, rejects with a `StartupError` if it cannot be. */
  bound?: () => Promise<void>;
  /** Called when the source has delivered everything (a replay); `serve` goes on serving until the signal. */
  onDone?: () => void;
  /** The effective calculator config for the run (see `loadFeatureConfig`); without it, the declared defaults. */
  config?: FeatureConfig;
  /** Dev mode (`--dev`): times every calculator run and publishes the `dev.calcStats` and `dev.catalogue` topics. */
  dev?: boolean;
  /**
   * Live: the startup server still holding the WebSocket port (`pitwall live`): the startup restore reports its progress
   * to it (C61), and `serve` closes it before its own server opens (also when it fails).
   */
  startup?: { progress: RebuildProgress; close: () => Promise<void> };
  /** The planning job the planning round runs (C62d); default `PLANNING_JOB`. */
  planningJob?: Job<StrategyInput, StrategyOutput>;
  /** The saved plans' choice a `basis.choose` with a plan makes (C62d); without it such a plan is `notSupported`. */
  planChoice?: PlanChoice;
  io: CliIo;
};

/** The levels `PITWALL_WS_LOG_LEVEL` may name. */
const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'];

/** The WebSocket server's log level from `PITWALL_WS_LOG_LEVEL` (default `info`; the Playwright harness sets `debug`). */
function wsLogLevel(env: NodeJS.ProcessEnv): string {
  const level = env['PITWALL_WS_LOG_LEVEL'] || 'info';
  if (!LOG_LEVELS.includes(level)) throw new StartupError(`PITWALL_WS_LOG_LEVEL must be one of ${LOG_LEVELS.join(', ')}, got "${level}"`);
  return level;
}

const sameSession = (a: SessionKey, b: SessionKey): boolean => a.sessionUid === b.sessionUid && a.weekendId === b.weekendId && a.playerCar === b.playerCar;

/** How often a dev child reports its replay position to the supervisor. */
const POSITION_EVERY_MS = 500;

/** How often dev mode publishes the calculator timings (the topic's 1 Hz). */
const CALC_STATS_EVERY_MS = 1000;

/**
 * Serves its feeds over one hub and one WebSocket server until `io.signal` aborts. Starts the pipelines (a replay also
 * lands its startup jump), then the WebSocket server, and reports `listening` only once all are up; if a step fails, the
 * ones before it are undone (nothing stays half-started).
 */
export async function serve(opts: ServeOptions): Promise<number> {
  const { io } = opts;
  const live: readonly LiveFeed[] = opts.sources ?? (opts.source ? [{ source: opts.source, feed: opts.feed }] : []);
  const labels: ReadonlyArray<Omit<FeedInfo, 'team'>> = opts.replay
    ? [{ feedId: opts.replay.feedId, ...opts.feed }]
    : live.map(({ source, feed }) => ({ feedId: source.feedId, ...feed }));
  const feedIds = labels.map((label) => label.feedId);
  // Live, with one source or several (`pitwall live` always passes `sources`); a replay is the one other run.
  const isLive = opts.replay === undefined;
  const undo: Array<() => void | Promise<void>> = [];
  // The startup server frees the port before the WebSocket server takes it, or once a step before that fails.
  let startupOpen = opts.startup !== undefined;
  const closeStartup = async (): Promise<void> => {
    if (!startupOpen) return;
    startupOpen = false;
    await opts.startup?.close();
  };
  try {
    undo.push(closeStartup);
    const { storage } = opts;
    if (storage) {
      undo.push(() => {
        storage.db.close();
      });
    }
    // The hub's one callback tells a feed's pipeline which calculators its subscribers need. A change before the pipeline
    // exists has none to reach; the pipeline reads the demand itself when a session starts.
    const pipelines = new Map<FeedId, FeedPipeline>();
    const hub = new TopicHub({
      now: () => performance.now(),
      onDemandChange: (changed) => pipelines.get(changed)?.demandChanged(),
    });
    // The team's feeds (C1a): each pipeline reports its session uid and its player car's team.
    const teams = new TeamFeeds();
    // A plan decision goes to every feed of the committing feed's team (C1a, C76).
    const planRouting = new PlanRouting({ teams, pipelines });
    const feeds = (): FeedInfo[] => labels.map((label) => ({ ...label, team: teams.team(label.feedId) }));
    // Seeded first, so the UI state opens on the shipped workbooks, never on its own fallback, and on every start path.
    // Today's date names the backup of a user file a shipped default replaces; the bridge, the I/O shell, reads it here only.
    const now = (): string => new Date().toISOString().slice(0, 10);
    if (opts.uiDir !== undefined) await seedDefaultWorkbooks(opts.uiDir, DEFAULT_WORKBOOKS_DIR, now);
    const uiState = opts.uiDir === undefined ? undefined : UiState.open(opts.uiDir, hub, cliLogger(io, 'warn'), { dir: DEFAULT_WORKBOOKS_DIR, now });
    if (uiState) {
      undo.push(() => uiState.close());
      // Acknowledgements of occurrences that have ended are dropped, so state.json does not grow forever.
      undo.push(pruneEndedAcknowledgements(hub, feedIds, uiState));
    }
    const { rebuild } = storage ?? {};
    // A run that stores its own sessions (not a replay's `read`, R21) has the stores and the planning round that rest on them.
    const stores = storage !== undefined && (storage.mode ?? 'append') === 'append';
    // The calibration store (C62a) reads the stored sessions, so only a run that stores has one; `uiDir` is `<data dir>/ui`.
    const calibrationLog = cliLogger(io, 'warn');
    const calibrationRepo = storage && new WeekendRepository(storage.db, {
      rulesVersion: storage.rulesVersion,
      track: (row) => (row.pwrecPath === null ? loadTrackFile(row.trackId, TRACKS_DIR) : recordingTrack(row.pwrecPath, row.trackId, TRACKS_DIR)),
    });
    // A session a feed is running right now is no stale session: it is never rebuilt under it (C59). The bridge's
    // rebuilds run one at a time, each checked when it starts: a session stored fresh meanwhile is not rebuilt again.
    const running = (): Array<SessionKey | undefined> => [...pipelines.values()].map((pipeline) => pipeline.runningSession());
    storage?.onRunning?.(running);
    const isRunning = (row: SessionKey): boolean => running().some((key) => key !== undefined && sameSession(row, key));
    const isFresh = (row: SessionKey): boolean => {
      const stored = calibrationRepo?.sessionOf(row);
      return stored !== undefined && storage !== undefined && !isStale(stored, storage.rulesVersion);
    };
    let rebuilds: Promise<void> = Promise.resolve();
    const checkedRebuild = rebuild && ((row: StoredSessionRow): Promise<void> => {
      const turn = rebuilds.then(() => (isRunning(row) || isFresh(row) ? undefined : rebuild(row)));
      rebuilds = turn.catch(() => {});
      return turn;
    });
    // The stale sessions a set, a person's links or the suggestions read (C61), rebuilt from their recordings as a session
    // start's weekend context rebuilds its stale ones; a failed rebuild is logged and its session stays stale (C3).
    // Nothing is rebuilt at bridge start (C61): the stores ask for nothing while they open, only at their first real read
    // (a session start's snapshot, a calibration edit), always as a first read (the service's default priority).
    const rebuildStored = async (keys: readonly SessionKey[]): Promise<void> => {
      if (checkedRebuild === undefined || calibrationRepo === undefined) return;
      const rows = keys.flatMap((key) => calibrationRepo.sessionsOf(key.weekendId).filter((row) => sameSession(row, key)));
      await Promise.all(rows.map((row) => checkedRebuild(row).catch((error: unknown) => {
        calibrationLog.error({ sessionUid: row.sessionUid, weekendId: row.weekendId, playerCar: row.playerCar, err: error }, 'stored session not rebuilt');
      })));
    };
    const calibration = stores && calibrationRepo && opts.uiDir !== undefined
      ? CalibrationStore.open(dirname(opts.uiDir), {
        features: FEATURES,
        repo: calibrationRepo,
        config: opts.config ?? effectiveConfig(FEATURES),
        hub,
        log: calibrationLog,
        rebuild: rebuildStored,
      })
      : undefined;
    if (calibration) undo.push(() => calibration.close());
    // The profile store (C62c) reads the stored sessions too; the running bridge is its only writer (P3, `drivers/.lock`).
    const profiles = stores && calibrationRepo && opts.uiDir !== undefined
      ? ProfileStore.open(dirname(opts.uiDir), {
        features: FEATURES,
        repo: calibrationRepo,
        config: opts.config ?? effectiveConfig(FEATURES),
        hub,
        log: calibrationLog,
        rebuild: rebuildStored,
      })
      : undefined;
    if (profiles) undo.push(() => profiles.close());
    // A rebuild changes the stored projections the sets' sources and the persons' links rest on (C61).
    const rebuildThenRecompute = checkedRebuild && (async (row: StoredSessionRow) => {
      await checkedRebuild(row);
      calibration?.recompute('rebuild');
      profiles?.recompute('rebuild');
    });
    // The basis's sessions made current before they enter a running session (C61, C62), through the bridge's one rebuild
    // service with the basis's priority, then the stores see the rebuilt projections; without the service through the
    // one rebuild queue (`checkedRebuild`): a session not stored, or current, waits for nothing; one that fails stays stale (C3).
    const service = storage?.rebuildService;
    const ensureCurrent: RebuildService['ensureCurrent'] = service ? async (keys, o) => {
      await service.ensureCurrent(keys, o);
      calibration?.recompute('rebuild');
      profiles?.recompute('rebuild');
    } : async (keys, o) => {
      const stale = keys.flatMap((key) => {
        const row = calibrationRepo?.sessionOf(key);
        return row !== undefined && storage !== undefined && isStale(row, storage.rulesVersion) ? [row] : [];
      });
      let done = 0;
      o?.onProgress?.(done, stale.length);
      for (const row of stale) {
        await rebuildThenRecompute?.(row).catch((error: unknown) => {
          calibrationLog.error({ sessionUid: row.sessionUid, weekendId: row.weekendId, playerCar: row.playerCar, err: error }, 'stored session not rebuilt');
        });
        o?.onProgress?.(++done, stale.length);
      }
    };
    // The team's last confirmed choices (C62): bridge user state in `<data dir>/basis/`, so only a run with a data dir keeps them.
    const lastChoiceStore: LastChoiceStore | undefined = opts.uiDir === undefined ? undefined : createLastChoiceStore(dirname(opts.uiDir), cliLogger(io, 'warn'));
    const lastChoice: Pick<LastChoiceStore, 'read' | 'write'> = lastChoiceStore ?? { read: () => undefined, write: () => {} };
    // The team's saved plans (C62d): bridge user state in `<data dir>/plans/`, so only a run with a data dir keeps them.
    const savedPlans = opts.uiDir === undefined ? undefined : new SavedPlanStore(dirname(opts.uiDir), cliLogger(io, 'warn'));
    // A plan chosen with a basis commits its decisions on each of the team's feeds then running (C1a, C62d, C76).
    const planChoice: PlanChoice | undefined = opts.planChoice ?? (savedPlans && createPlanChoice({
      feeds: {
        feeds: () => [...pipelines.entries()].map(([feedId, pipeline]) => ({ feedId, target: () => pipeline.planTarget() })),
        commitToTeam: (feedId, decisions) => teams.commitToTeam(feedId as FeedId, decisions),
        showToTeam: (feedId, plan) => teams.showToTeam(feedId as FeedId, plan),
      },
      store: savedPlans,
    }));
    // A basis choice is a decision of the team's running sessions (C1a, C62, C76); the plan with it is the saved plans' (C62d).
    const basisRouting = new BasisRouting({
      teams,
      pipelines,
      rebuild: { ensureCurrent },
      plans: planChoice ?? { choosePlan: () => ({ ok: false, reason: 'notSupported', message: 'no saved plans' }) },
      lastChoice,
      log: calibrationLog,
    });
    // Live: one sweep of stale stored sessions for the run's feeds (C59, C1a); it waits for every feed's first Session packet.
    const staleSweep = isLive && storage && rebuildThenRecompute
      ? new StaleSweep({ feeds: feedIds, db: storage.db, rebuild: rebuildThenRecompute, running, log: cliLogger(io, 'warn') })
      : undefined;
    let controller: ReplayController | undefined;
    // The server opens after the pipeline, and a replay's only once the startup jump has landed: a client that connects
    // earlier would be told the positions the fast-forward passes through, and a dev restart would not come back to the moment it left.
    const startServer = async (): Promise<WsServer> => {
      const planner = planning;
      const started = await WsServer.start({
        port: opts.wsPort,
        hub,
        feeds,
        log: cliLogger(io, wsLogLevel(io.env)),
        ...(uiState && { uiState }),
        // An edit of a set reaches every feed's pipeline once applied: a run on that set commits its new snapshot (C62a,
        // C76). A new set or a copy is a set no run uses; a prefer changes no running session (C62a, C75).
        ...(calibration && {
          calibration: {
            apply: (action: CalibrationAction): ApplyResult => {
              const result = calibration.apply(action);
              if (result.ok && action.kind !== 'calibration.set.create' && action.kind !== 'calibration.set.copy' && action.kind !== 'calibration.prefer') {
                for (const pipeline of pipelines.values()) pipeline.calibrationEdited(action.setId);
              }
              return result;
            },
          },
        }),
        // A driver-profile edit takes effect at the next session start (C62c, C75).
        ...(profiles && { drivers: profiles }),
        // A pick is a decision of the feed's running session (C76): the pipeline takes it.
        choose: (action: ChooseAction): ActionOutcome => {
          if (!feedIds.includes(action.feedId)) return { ok: false, reason: 'invalid', message: `no feed ${action.feedId}` };
          const pipeline = pipelines.get(action.feedId);
          return pipeline === undefined ? { ok: false, reason: 'notSupported' } : pipeline.commitDecision(action.setId);
        },
        // Ending a session's recording is the feed's pipeline's (C59, C73).
        endSession: (action: EndSessionAction): ActionOutcome => {
          if (!feedIds.includes(action.feedId)) return { ok: false, reason: 'invalid', message: `no feed ${action.feedId}` };
          const pipeline = pipelines.get(action.feedId);
          return pipeline === undefined ? { ok: false, reason: 'notSupported' } : pipeline.endSession();
        },
        // A plan is a decision of the team's running sessions (C1a, C76): the plan routing takes it.
        plan: (action: PlanAction): ActionOutcome =>
          feedIds.includes(action.feedId) ? planRouting.commit(action) : { ok: false, reason: 'invalid', message: `no feed ${action.feedId}` },
        // A basis is a decision of the team's running sessions (C1a, C62, C76): the basis routing takes it.
        basis: (action: BasisAction): Promise<ActionOutcome> =>
          feedIds.includes(action.feedId) ? basisRouting.choose(action) : Promise.resolve({ ok: false, reason: 'invalid', message: `no feed ${action.feedId}` }),
        // The planning round and the saved plans are the planning module's (C62d, C70, C73).
        ...(planner && {
          planning: (action: PlanningAction): ActionOutcome =>
            feedIds.includes(action.feedId) ? planner.apply(action) : { ok: false, reason: 'invalid', message: `no feed ${action.feedId}` },
        }),
        ...(opts.replay && { replay: { control: (control: ReplayControl) => (controller === undefined ? false : (controller.control(control), true)) } }),
      });
      undo.push(() => started.close());
      return started;
    };
    // A dev child tells its supervisor where the replay is, so a restart can come back to the same moment.
    let listening = false;
    if (opts.dev && opts.replay && process.send) {
      const send = process.send.bind(process);
      const timer = setInterval(() => {
        const position = controller?.position();
        if (!listening || !controller || !position) return;
        const { paused, speed } = controller.transport();
        send({ type: 'position', sessionTimeMs: position.sessionTimeMs, paused, speed } satisfies PositionMessage);
      }, POSITION_EVERY_MS);
      undo.push(() => clearInterval(timer));
    }
    const calcStats = opts.dev ? createCalcStats() : undefined;
    if (calcStats) {
      const publish = (): void => hub.publishGlobal('dev.calcStats', () => calcStats.snapshot());
      const timer = setInterval(publish, CALC_STATS_EVERY_MS);
      undo.push(() => clearInterval(timer));
    }
    if (opts.dev) {
      const catalogue = readCatalogue();
      hub.publishGlobal('dev.catalogue', () => catalogue);
    }
    // Test aid for the Playwright specs: inert unless set (see `FeedAlerts.raiseTestInsight`).
    const testInsight = io.env['PITWALL_E2E_INSIGHT'] || undefined;
    const pipelineLog = cliLogger(io, 'info');
    // One job-worker limit for every feed, so all feeds together run at most MAX_JOB_WORKERS workers (Task 18b, C1a).
    const workerLimit = new WorkerLimit();
    // The planning round (C62d): it replays a stored qualifying (so only a run that stores has one) and keeps the saved
    // plans in `<data dir>/plans/`; its replay runs in the rebuild service's worker, off the thread that applies frames
    // (C61), its jobs on the feeds' worker limit (C51). The suggestion reads the stored sessions on the track (§7.1 step 3).
    let planning: Planning | undefined;
    if (stores && storage && calibrationRepo && opts.uiDir !== undefined && savedPlans && lastChoiceStore) {
      const dataDirRoot = dirname(opts.uiDir);
      const warnLog = cliLogger(io, 'warn');
      // The bridge's one rebuild service (C61): the round's practice is made current through the basis's `ensureCurrent`
      // (the stores then see the rebuilt projections) and its replay queued behind it, both at priority `planning`. A run
      // given no service, or one without replays (a test's `serve`), has one of its own here for the replay.
      const replays: Pick<RebuildService, 'ensureCurrent' | 'replayToEnd'> = service?.replayToEnd ? { ensureCurrent: service.ensureCurrent.bind(service), replayToEnd: service.replayToEnd.bind(service) } : (() => {
        const own = createRebuildService({
          db: storage.db,
          ...(opts.config && { config: opts.config }),
          rulesVersion: storage.rulesVersion,
          log: warnLog,
          running,
        });
        // Before the database closes (`undo` runs in reverse).
        undo.push(() => own.close());
        return own;
      })();
      const store = savedPlans;
      const lastChoice = lastChoiceStore;
      const runner = createPlanningRunner({
        rebuild: {
          ensureCurrent: service ? ensureCurrent : (keys, o) => replays.ensureCurrent(keys, o),
          replayToEnd: replays.replayToEnd.bind(replays),
        },
        jobs: { job: opts.planningJob ?? PLANNING_JOB, workerLimit },
        hub,
        store,
        lastChoice,
        sessions: calibrationRepo,
        seatOf: (feedId) => planning?.seatOf(feedId),
        log: pipelineLog,
      });
      planning = new Planning({
        runner,
        store,
        lastChoice,
        suggestedLaps: (trackId, format) => suggestedLapsOf(calibrationRepo.sessionsOnTrack(trackId), format),
        // Each feed's last seat, so a bridge between sessions knows the team (R19).
        seats: createFeedSeatStore(dataDirRoot, warnLog),
        log: pipelineLog,
      });
      const made = planning;
      undo.push(() => made.close());
    }
    const makePipeline = (source: PacketSource, listenPort?: number): FeedPipeline => {
      const pipeline = new FeedPipeline({
      feedId: source.feedId,
      source,
      ...(listenPort !== undefined && { listenPort }),
      teams,
      hub,
      features: FEATURES,
      workerLimit,
      ...(opts.config && { config: opts.config }),
      log: pipelineLog,
      dumpsDir: opts.dumpsDir,
      ...(opts.storage && {
        storage: {
          db: opts.storage.db,
          recordingsDir: opts.storage.recordingsDir,
          rulesVersion: opts.storage.rulesVersion,
          ...(opts.storage.mode && { mode: opts.storage.mode }),
          ...(rebuildThenRecompute && { rebuild: rebuildThenRecompute }),
          // A stored session gives new candidates (ruling R14).
          onStored: () => {
            calibration?.recompute('sessionEnd');
            profiles?.recompute('sessionEnd');
          },
        },
      }),
      // Live: the session starts on the calibration store's preselection and takes picks (C62a). A replay runs on its
      // recording's priors and decisions sidecars instead (C38, C76).
      ...(calibration && isLive && { calibration }),
      ...(opts.replay && { recorded: recordingDecisions(opts.replay.path, pipelineLog) }),
      // Live: each session starts on the profile store's snapshot of its slots; a replay on its profiles sidecar (C38, C62c).
      ...(profiles && isLive && { profiles }),
      ...(opts.replay && { recordedProfiles: recordingProfiles(opts.replay.path, pipelineLog) }),
      // Live: each session preselects its basis (C62); a replay starts on its basis sidecar (C38), whose sessions are
      // made current before its first frame (C61).
      ...(opts.storage && { basis: { rebuild: { ensureCurrent }, lastChoice } }),
      ...(opts.replay && { recordedBasis: recordingBasis(opts.replay.path, pipelineLog) }),
      ...(opts.staleCheck && { staleCheck: opts.staleCheck }),
      ...(staleSweep && { staleSweep }),
      ...(calcStats && { calcStats }),
      // Live only: a replay reproduces the realism its sidecar recorded (spec 7.9), whatever the UI prefers next.
      ...(uiState && isLive && { realismNextSession: () => uiState.realismNextSession() }),
      ...(testInsight !== undefined && { testInsight }),
      // A replay (and dev) runs with the track file its recording was made with (C62b); live loads the committed file.
      ...(opts.replay && { tracks: (trackId: number) => recordingTrack(opts.replay.path, trackId, TRACKS_DIR, pipelineLog) }),
      ...(planning && { planning }),
      });
      // A replay's backward jump builds the feed's pipeline anew; the newest one takes the feed's demand and picks.
      pipelines.set(source.feedId, pipeline);
      // A new pipeline has no ended session: the feed's round, if any, closes (`{ open: false }` from the feed's start on).
      planning?.sessionStarted(source.feedId);
      return pipeline;
    };
    const failedFeed = (id: FeedId) => (error: unknown): never => {
      throw new StartupError(`feed ${id} failed: ${error instanceof Error ? error.message : String(error)}`);
    };
    let finished: Promise<void>;
    if (opts.replay) {
      const { replay } = opts;
      const failed = failedFeed(replay.feedId);
      // A startup jump that lands at the end is not announced: the replay has not finished, it was jumped to the end.
      let jumping = true;
      controller = new ReplayController({
        path: replay.path,
        feedId: replay.feedId,
        hub,
        makePipeline,
        unpaced: replay.unpaced,
        onEnd: () => {
          if (!jumping) opts.onDone?.();
        },
      });
      const running = controller;
      undo.push(() => running.stop());
      for (const control of replay.controls) running.control(control);
      // A recording that cannot be read ends the wait too (`done` rejects), and so does an interrupt.
      await Promise.race([running.settled(), running.done, whenAborted(io.signal)]).catch(failed);
      jumping = false;
      finished = running.done.catch(failed);
    } else {
      // One pipeline per feed, all on the one hub (C1a); the run has finished once every feed's source is done.
      const made = live.map(({ source, port }) => {
        const pipeline = makePipeline(source, port);
        undo.push(() => pipeline.stop());
        return { source, pipeline };
      });
      const running = made.map(({ source, pipeline }) => {
        pipeline.start();
        return pipeline.done.catch(failedFeed(source.feedId));
      });
      finished = Promise.all(running).then(() => opts.onDone?.());
    }
    await closeStartup();
    const server = await startServer();
    await opts.bound?.();
    listening = true;
    io.out(`listening ws://127.0.0.1:${server.port}`);

    const aborted = whenAborted(io.signal);
    await Promise.race([aborted, finished.then(() => aborted)]);
    return 0;
  } finally {
    for (const step of undo.reverse()) await step();
  }
}
