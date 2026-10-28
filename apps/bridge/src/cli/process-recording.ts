import { basename } from 'node:path';
import { feedId } from '@pitwall/domain';
import { FEATURES } from '../features/index.generated.ts';
import { TopicHub } from '../hub/topic-hub.ts';
import { PwrecSource } from '../input/pwrec-source.ts';
import type { Logger } from '../log.ts';
import { FeedPipeline } from '../pipeline/feed-pipeline.ts';
import { StartupError } from '../startup-error.ts';
import type { Db } from '../storage/db.ts';

/**
 * Runs one recording through the pipeline as fast as possible, storing its sessions in `db`. Nobody listens to the hub.
 * An aborted `signal` (also one aborted before the call) stops the run, and it throws a `StartupError`.
 */
export async function processRecording(path: string, db: Db, log: Logger, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw new StartupError('interrupted');
  const id = feedId('replay');
  const pipeline = new FeedPipeline({
    feedId: id,
    source: new PwrecSource({ feedId: id, path, mode: 'asFastAsPossible' }),
    hub: new TopicHub({
      now: () => 0,
      onDemandChange: (changed) => {
        if (changed === id) pipeline.demandChanged();
      },
    }),
    features: FEATURES,
    log,
    storage: { db, sourcePath: path },
  });
  const stop = () => void pipeline.stop();
  signal.addEventListener('abort', stop, { once: true });
  pipeline.start();
  try {
    await pipeline.done;
  } catch (error) {
    throw new StartupError(`cannot process ${basename(path)}: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    signal.removeEventListener('abort', stop);
  }
  if (signal.aborted) throw new StartupError('interrupted');
}
