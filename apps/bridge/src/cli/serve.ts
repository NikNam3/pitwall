import type { FeedInfo } from '@pitwall/contracts';
import { FEATURES } from '../features/index.generated.ts';
import { TopicHub } from '../hub/topic-hub.ts';
import type { PacketSource } from '../input/packet-source.ts';
import { FeedPipeline, type FeedPipelineOptions } from '../pipeline/feed-pipeline.ts';
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
  /** Opened by the caller, closed by `serve` (also when it fails). */
  storage?: { db: Db; recordingsDir: string };
  staleCheck?: FeedPipelineOptions['staleCheck'];
  /** For a source that binds a socket: resolves once it is bound, rejects with a `StartupError` if it cannot be. */
  bound?: () => Promise<void>;
  /** Called when the source has delivered everything (a replay); `serve` goes on serving until the signal. */
  onDone?: () => void;
  io: CliIo;
};

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
    const hub = new TopicHub({ now: () => performance.now() });
    const feeds = (): FeedInfo[] => [{ feedId: source.feedId, ...opts.feed }];
    const server = await WsServer.start({ port: opts.wsPort, hub, feeds });
    undo.push(() => server.close());
    const pipeline = new FeedPipeline({
      feedId: source.feedId,
      source,
      hub,
      features: FEATURES,
      log: cliLogger(io, 'info'),
      dumpsDir: opts.dumpsDir,
      ...(opts.storage && { storage: { db: opts.storage.db, recordingsDir: opts.storage.recordingsDir } }),
      ...(opts.staleCheck && { staleCheck: opts.staleCheck }),
    });
    pipeline.start();
    undo.push(() => pipeline.stop());
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
