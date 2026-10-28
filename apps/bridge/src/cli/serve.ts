import type { FeedInfo, ReplayControl } from '@pitwall/contracts';
import type { FeedId } from '@pitwall/domain';
import { createCalcStats } from '../dev/calc-stats.ts';
import type { FeatureConfig } from '../feature-config.ts';
import { FEATURES } from '../features/index.generated.ts';
import { TopicHub } from '../hub/topic-hub.ts';
import type { PacketSource } from '../input/packet-source.ts';
import { FeedPipeline, type FeedPipelineOptions } from '../pipeline/feed-pipeline.ts';
import { ReplayController } from '../replay/replay-controller.ts';
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
    const uiState = opts.uiDir === undefined ? undefined : UiState.open(opts.uiDir, hub, cliLogger(io, 'warn'));
    if (uiState) undo.push(() => uiState.close());
    let controller: ReplayController | undefined;
    const server = await WsServer.start({
      port: opts.wsPort,
      hub,
      feeds,
      ...(uiState && { uiState }),
      ...(opts.replay && { replay: { control: (control: ReplayControl) => (controller === undefined ? false : (controller.control(control), true)) } }),
    });
    undo.push(() => server.close());
    const calcStats = opts.dev ? createCalcStats() : undefined;
    if (calcStats) {
      const publish = (): void => hub.publishGlobal('dev.calcStats', () => calcStats.snapshot());
      const timer = setInterval(publish, CALC_STATS_EVERY_MS);
      undo.push(() => clearInterval(timer));
    }
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
      finished = running.done;
    } else {
      const running = makePipeline(opts.source);
      running.start();
      undo.push(() => running.stop());
      finished = running.done.then(() => opts.onDone?.());
    }
    await opts.bound?.();
    io.out(`listening ws://127.0.0.1:${server.port}`);

    const aborted = whenAborted(io.signal);
    await Promise.race([aborted, finished.then(() => aborted)]).catch(failed);
    return 0;
  } finally {
    for (const step of undo.reverse()) await step();
  }
}
