import type { FeedInfo, ReplayControl } from '@pitwall/contracts';
import type { FeedId } from '@pitwall/domain';
import { createCalcStats } from '../dev/calc-stats.ts';
import { readCatalogue } from '../dev/catalogue.ts';
import type { PositionMessage } from '../dev/dev-supervisor.ts';
import type { FeatureConfig } from '../feature-config.ts';
import { FEATURES } from '../features/index.generated.ts';
import { TopicHub } from '../hub/topic-hub.ts';
import type { PacketSource } from '../input/packet-source.ts';
import { FeedPipeline, type FeedPipelineOptions } from '../pipeline/feed-pipeline.ts';
import { ReplayController } from '../replay/replay-controller.ts';
import { pruneEndedAcknowledgements } from '../ui-state/ack-pruning.ts';
import { DEFAULT_WORKBOOKS_DIR, seedDefaultWorkbooks } from '../ui-state/default-workbooks.ts';
import { UiState } from '../ui-state/ui-state.ts';
import { StartupError } from '../startup-error.ts';
import type { Db } from '../storage/db.ts';
import { WsServer } from '../ws/server.ts';
import { cliLogger, whenAborted, type CliIo } from './io.ts';

/** A recording served through a `ReplayController`; `controls` are applied (and any jump finished) before `listening` is printed. */
export type ReplayInput = { feedId: FeedId; path: string; controls: readonly ReplayControl[]; unpaced: boolean };

export type ServeOptions = ({ source: PacketSource; replay?: never } | { replay: ReplayInput; source?: never }) & ServeBase;

type ServeBase = {
  /** What the feed is called in the `hello` message. */
  feed: Omit<FeedInfo, 'feedId'>;
  wsPort: number;
  dumpsDir: string;
  /**
   * `PITWALL_DATA_DIR/ui`: the UI state is kept there, and the shipped workbooks are seeded into it first.
   * Without it `uiAction` messages are answered with `notSupported`.
   */
  uiDir?: string;
  /** Opened by the caller, closed by `serve` (also when it fails). */
  storage?: { db: Db; recordingsDir: string };
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

/** How often a dev child reports its replay position to the supervisor. */
const POSITION_EVERY_MS = 500;

/** How often dev mode publishes the calculator timings (the topic's 1 Hz). */
const CALC_STATS_EVERY_MS = 1000;

/**
 * Serves one feed over WebSocket until `io.signal` aborts. Starts the WebSocket server, then the pipeline, and
 * reports `listening` only once both are up; if a step fails, the ones before it are undone (nothing stays half-started).
 */
export async function serve(opts: ServeOptions): Promise<number> {
  const { io } = opts;
  const feedId = opts.replay ? opts.replay.feedId : opts.source.feedId;
  const undo: Array<() => void | Promise<void>> = [];
  try {
    const { storage } = opts;
    if (storage) {
      undo.push(() => {
        storage.db.close();
      });
    }
    // The hub's one callback tells the pipeline which calculators its subscribers need. The pipeline is created after
    // the server, so a change before then has no pipeline to reach; it reads the demand itself when a session starts.
    let pipeline: FeedPipeline | undefined = undefined;
    const hub = new TopicHub({
      now: () => performance.now(),
      onDemandChange: (changed) => {
        if (changed === feedId) pipeline?.demandChanged();
      },
    });
    const feeds = (): FeedInfo[] => [{ feedId, ...opts.feed }];
    // Seeded first, so the UI state opens on the shipped workbooks, never on its own fallback, and on every start path.
    if (opts.uiDir !== undefined) await seedDefaultWorkbooks(opts.uiDir, DEFAULT_WORKBOOKS_DIR);
    const uiState = opts.uiDir === undefined ? undefined : UiState.open(opts.uiDir, hub, cliLogger(io, 'warn'));
    if (uiState) {
      undo.push(() => uiState.close());
      // Acknowledgements of occurrences that have ended are dropped, so state.json does not grow forever.
      undo.push(pruneEndedAcknowledgements(hub, [feedId], uiState));
    }
    let controller: ReplayController | undefined;
    // A replay's server opens only once the startup jump has landed: a client that connects earlier would be told the
    // positions the fast-forward passes through, and a dev restart would not come back to the moment it left.
    const startServer = async (): Promise<WsServer> => {
      const started = await WsServer.start({
        port: opts.wsPort,
        hub,
        feeds,
        log: cliLogger(io, wsLogLevel(io.env)),
        ...(uiState && { uiState }),
        ...(opts.replay && { replay: { control: (control: ReplayControl) => (controller === undefined ? false : (controller.control(control), true)) } }),
      });
      undo.push(() => started.close());
      return started;
    };
    let server: WsServer | undefined = opts.replay ? undefined : await startServer();
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
    const makePipeline = (source: PacketSource): FeedPipeline =>
      (pipeline = new FeedPipeline({
      feedId,
      source,
      hub,
      features: FEATURES,
      ...(opts.config && { config: opts.config }),
      log: cliLogger(io, 'info'),
      dumpsDir: opts.dumpsDir,
      ...(opts.storage && { storage: { db: opts.storage.db, recordingsDir: opts.storage.recordingsDir } }),
      ...(opts.staleCheck && { staleCheck: opts.staleCheck }),
      ...(calcStats && { calcStats }),
      // Live only: a replay reproduces the realism its sidecar recorded (spec 7.9), whatever the UI prefers next.
      ...(uiState && opts.source && { realismNextSession: () => uiState.realismNextSession() }),
      ...(testInsight !== undefined && { testInsight }),
    }));
    const failed = (error: unknown): never => {
      throw new StartupError(`feed ${feedId} failed: ${error instanceof Error ? error.message : String(error)}`);
    };
    let finished: Promise<void>;
    if (opts.replay) {
      const { replay } = opts;
      // A startup jump that lands at the end is not announced: the replay has not finished, it was jumped to the end.
      let jumping = true;
      controller = new ReplayController({
        path: replay.path,
        feedId,
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
      server = await startServer();
      finished = running.done;
    } else {
      const running = makePipeline(opts.source);
      running.start();
      undo.push(() => running.stop());
      finished = running.done.then(() => opts.onDone?.());
    }
    await opts.bound?.();
    listening = true;
    io.out(`listening ws://127.0.0.1:${server?.port}`);

    const aborted = whenAborted(io.signal);
    await Promise.race([aborted, finished.then(() => aborted)]).catch(failed);
    return 0;
  } finally {
    for (const step of undo.reverse()) await step();
  }
}
