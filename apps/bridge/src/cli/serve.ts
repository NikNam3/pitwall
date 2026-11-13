import type { FeedInfo, ReplayControl } from '@pitwall/contracts';
import type { FeedId } from '@pitwall/domain';
import { dirname } from 'node:path';
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
import { TeamFeeds } from '../pipeline/team-feeds.ts';
import { ReplayController } from '../replay/replay-controller.ts';
import { loadTrackFile, recordingTrack, TRACKS_DIR } from '../track-files/load.ts';
import { pruneEndedAcknowledgements } from '../ui-state/ack-pruning.ts';
import { DEFAULT_WORKBOOKS_DIR, seedDefaultWorkbooks } from '../ui-state/default-workbooks.ts';
import { UiState } from '../ui-state/ui-state.ts';
import { StartupError } from '../startup-error.ts';
import type { Db, SessionKey, StoredSessionRow } from '../storage/db.ts';
import { WeekendRepository } from '../storage/weekend-repository.ts';
import { WsServer, type ActionOutcome, type ChooseAction } from '../ws/server.ts';
import { recordingDecisions } from '../pipeline/decision-sidecars.ts';
import { recordingProfiles } from '../pipeline/profile-sidecar.ts';
import { ProfileStore } from '../drivers/store.ts';
import { cliLogger, whenAborted, type CliIo } from './io.ts';

/** A recording served through a `ReplayController`; `controls` are applied (and any jump finished) before `listening` is printed. */
export type ReplayInput = { feedId: FeedId; path: string; controls: readonly ReplayControl[]; unpaced: boolean };

/** What a feed is called in the `hello` message. */
export type FeedLabel = Omit<FeedInfo, 'feedId' | 'team'>;

/** One live feed (C1a): its packet source, which names its feed id, and what it is called in `hello`. */
export type LiveFeed = { source: PacketSource; feed: FeedLabel };

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
   * `rebuild`: rebuilds a stored session found incomplete, in the background.
   */
  storage?: { db: Db; recordingsDir: string; rulesVersion: string; rebuild?: (row: StoredSessionRow) => Promise<void> };
  staleCheck?: FeedPipelineOptions['staleCheck'];
  /** For a source that binds a socket: resolves once it is bound, rejects with a `StartupError` if it cannot be. */
  bound?: () => Promise<void>;
  /** Called when the source has delivered everything (a replay); `serve` goes on serving until the signal. */
  onDone?: () => void;
  /** The effective calculator config for the run (see `loadFeatureConfig`); without it, the declared defaults. */
  config?: FeatureConfig;
  /** Dev mode (`--dev`): times every calculator run and publishes the `dev.calcStats` and `dev.catalogue` topics. */
  dev?: boolean;
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
  try {
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
    if (opts.uiDir !== undefined) await seedDefaultWorkbooks(opts.uiDir, DEFAULT_WORKBOOKS_DIR);
    const uiState = opts.uiDir === undefined ? undefined : UiState.open(opts.uiDir, hub, cliLogger(io, 'warn'));
    if (uiState) {
      undo.push(() => uiState.close());
      // Acknowledgements of occurrences that have ended are dropped, so state.json does not grow forever.
      undo.push(pruneEndedAcknowledgements(hub, feedIds, uiState));
    }
    const { rebuild } = storage ?? {};
    // The calibration store (C62a) reads the stored sessions, so only a run that stores has one; `uiDir` is `<data dir>/ui`.
    const calibrationLog = cliLogger(io, 'warn');
    const calibrationRepo = storage && new WeekendRepository(storage.db, {
      rulesVersion: storage.rulesVersion,
      track: (row) => (row.pwrecPath === null ? loadTrackFile(row.trackId, TRACKS_DIR) : recordingTrack(row.pwrecPath, row.trackId, TRACKS_DIR)),
    });
    // The stale sessions a set, a person's links or the suggestions read (C61), rebuilt from their recordings as a session
    // start's weekend context rebuilds its stale ones; a failed rebuild is logged and its session stays stale (C3).
    const rebuildStored = async (keys: readonly SessionKey[]): Promise<void> => {
      if (rebuild === undefined || calibrationRepo === undefined) return;
      const rows = keys.flatMap((key) => calibrationRepo.sessionsOf(key.weekendId).filter((row) => sameSession(row, key)));
      await Promise.all(rows.map((row) => rebuild(row).catch((error: unknown) => {
        calibrationLog.error({ sessionUid: row.sessionUid, weekendId: row.weekendId, playerCar: row.playerCar, err: error }, 'stored session not rebuilt');
      })));
    };
    const calibration = calibrationRepo && opts.uiDir !== undefined
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
    const profiles = calibrationRepo && opts.uiDir !== undefined
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
    const rebuildThenRecompute = rebuild && (async (row: StoredSessionRow) => {
      await rebuild(row);
      calibration?.recompute('rebuild');
      profiles?.recompute('rebuild');
    });
    let controller: ReplayController | undefined;
    // The server opens after the pipeline, and a replay's only once the startup jump has landed: a client that connects
    // earlier would be told the positions the fast-forward passes through, and a dev restart would not come back to the moment it left.
    const startServer = async (): Promise<WsServer> => {
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
        // A plan is a decision of the team's running sessions (C1a, C76): the plan routing takes it.
        plan: (action: PlanAction): ActionOutcome =>
          feedIds.includes(action.feedId) ? planRouting.commit(action) : { ok: false, reason: 'invalid', message: `no feed ${action.feedId}` },
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
    const makePipeline = (source: PacketSource): FeedPipeline => {
      const pipeline = new FeedPipeline({
      feedId: source.feedId,
      source,
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
      ...(opts.staleCheck && { staleCheck: opts.staleCheck }),
      ...(calcStats && { calcStats }),
      // Live only: a replay reproduces the realism its sidecar recorded (spec 7.9), whatever the UI prefers next.
      ...(uiState && isLive && { realismNextSession: () => uiState.realismNextSession() }),
      ...(testInsight !== undefined && { testInsight }),
      // A replay (and dev) runs with the track file its recording was made with (C62b); live loads the committed file.
      ...(opts.replay && { tracks: (trackId: number) => recordingTrack(opts.replay.path, trackId, TRACKS_DIR, pipelineLog) }),
      });
      // A replay's backward jump builds the feed's pipeline anew; the newest one takes the feed's demand and picks.
      pipelines.set(source.feedId, pipeline);
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
      const running = live.map(({ source }) => {
        const pipeline = makePipeline(source);
        pipeline.start();
        undo.push(() => pipeline.stop());
        return pipeline.done.catch(failedFeed(source.feedId));
      });
      finished = Promise.all(running).then(() => opts.onDone?.());
    }
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
