import type { FeedInfo } from '@pitwall/contracts';
import { createCalcStats } from '../dev/calc-stats.ts';
import type { FeatureConfig } from '../feature-config.ts';
import { FEATURES } from '../features/index.generated.ts';
import { TopicHub } from '../hub/topic-hub.ts';
import type { PacketSource } from '../input/packet-source.ts';
import { FeedPipeline, type FeedPipelineOptions } from '../pipeline/feed-pipeline.ts';
import { UiState } from '../ui-state/ui-state.ts';
import { StartupError } from '../startup-error.ts';
import type { Db } from '../storage/db.ts';
import { WsServer } from '../ws/server.ts';
import { cliLogger, whenAborted, type CliIo } from './io.ts';

export type ServeOptions = {
  source: PacketSource;
  /** What the feed is called in the `hello` message. */
  feed: Omit<FeedInfo, 'feedId'>;
  wsPort: number;
  dumpsDir: string;
  /** `PITWALL_DATA_DIR/ui`: the UI state is kept there. Without it `uiAction` messages are answered with `notSupported`. */
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
  /** Dev mode (`--dev`): times every calculator run and publishes the `dev.calcStats` topic. */
  dev?: boolean;
  io: CliIo;
};

/** How often dev mode publishes the calculator timings (the topic's 1 Hz). */
const CALC_STATS_EVERY_MS = 1000;

/**
 * Serves one feed over WebSocket until `io.signal` aborts. Starts the WebSocket server, then the pipeline, and
 * reports `listening` only once both are up; if a step fails, the ones before it are undone (nothing stays half-started).
 */
export async function serve(opts: ServeOptions): Promise<number> {
  const { source, io } = opts;
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
        if (changed === source.feedId) pipeline?.demandChanged();
      },
    });
    const feeds = (): FeedInfo[] => [{ feedId: source.feedId, ...opts.feed }];
    const uiState = opts.uiDir === undefined ? undefined : UiState.open(opts.uiDir, hub, cliLogger(io, 'warn'));
    if (uiState) undo.push(() => uiState.close());
    const server = await WsServer.start({ port: opts.wsPort, hub, feeds, ...(uiState && { uiState }) });
    undo.push(() => server.close());
    const calcStats = opts.dev ? createCalcStats() : undefined;
    if (calcStats) {
      const publish = (): void => hub.publishGlobal('dev.calcStats', () => calcStats.snapshot());
      const timer = setInterval(publish, CALC_STATS_EVERY_MS);
      undo.push(() => clearInterval(timer));
    }
    pipeline = new FeedPipeline({
      feedId: source.feedId,
      source,
      hub,
      features: FEATURES,
      ...(opts.config && { config: opts.config }),
      log: cliLogger(io, 'info'),
      dumpsDir: opts.dumpsDir,
      ...(opts.storage && { storage: { db: opts.storage.db, recordingsDir: opts.storage.recordingsDir } }),
      ...(opts.staleCheck && { staleCheck: opts.staleCheck }),
      ...(calcStats && { calcStats }),
      ...(uiState && { realismNextSession: () => uiState.realismNextSession() }),
    });
    pipeline.start();
    undo.push(() => pipeline?.stop());
    await opts.bound?.();
    io.out(`listening ws://127.0.0.1:${server.port}`);

    const aborted = whenAborted(io.signal);
    const finished = pipeline.done.then(() => opts.onDone?.());
    await Promise.race([aborted, finished.then(() => aborted)]).catch((error: unknown) => {
      throw new StartupError(`feed ${source.feedId} failed: ${error instanceof Error ? error.message : String(error)}`);
    });
    return 0;
  } finally {
    for (const step of undo.reverse()) await step();
  }
}
