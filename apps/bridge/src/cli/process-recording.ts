import { basename } from 'node:path';
import { feedId, type FeedId } from '@pitwall/domain';
import type { FeatureConfig } from '../feature-config.ts';
import type { Feature } from '../features/feature.ts';
import { FEATURES } from '../features/index.generated.ts';
import { TopicHub } from '../hub/topic-hub.ts';
import type { PacketSource } from '../input/packet-source.ts';
import { PwrecSource } from '../input/pwrec-source.ts';
import type { Logger } from '../log.ts';
import { recordingDecisions } from '../pipeline/decision-sidecars.ts';
import { FeedPipeline, type FeedPipelineOptions } from '../pipeline/feed-pipeline.ts';
import { recordingProfiles } from '../pipeline/profile-sidecar.ts';
import { StartupError } from '../startup-error.ts';
import { recordingTrack, TRACKS_DIR } from '../track-files/load.ts';
import type { Db } from '../storage/db.ts';

/** The feed a recording is processed on. */
export const RECORDING_FEED: FeedId = feedId('replay');

/** How `recordingPipeline` runs a recording. */
export type RecordingRun = {
  path: string;
  hub: TopicHub;
  log: Logger;
  /** The calculator config it runs with (the recording's own, see `recordingConfig`). */
  config: FeatureConfig;
  /** Default: the recording, as fast as possible. */
  source?: PacketSource;
  /** Default: the generated feature index. */
  features?: readonly Feature[];
  /** Without it nothing is stored. */
  storage?: FeedPipelineOptions['storage'];
};

/**
 * The pipeline that runs one recording as `pitwall reprocess` does (C38): the track file is the recording's sidecar,
 * or the committed file without one (`recordingTrack`, C62b); the priors and decisions are its sidecars'
 * (`recordingDecisions`, C76), and the driver profiles its profiles sidecar's (`recordingProfiles`, C62c), none
 * without them. Not started.
 */
export function recordingPipeline(run: RecordingRun): FeedPipeline {
  const { path, log } = run;
  return new FeedPipeline({
    feedId: RECORDING_FEED,
    source: run.source ?? new PwrecSource({ feedId: RECORDING_FEED, path, mode: 'asFastAsPossible' }),
    hub: run.hub,
    features: run.features ?? FEATURES,
    config: run.config,
    log,
    tracks: (trackId) => recordingTrack(path, trackId, TRACKS_DIR, log),
    // Reprocessing equals the live run (C38): the recording's priors, decisions and profiles sidecars (C62c, C76).
    recorded: recordingDecisions(path, log),
    recordedProfiles: recordingProfiles(path, log),
    ...(run.storage && { storage: run.storage }),
  });
}

/** A hub wired like `serve`'s: its demand changes on the recording's feed reach `pipeline()`. */
export function recordingHub(pipeline: () => FeedPipeline | undefined, now: () => number = () => 0): TopicHub {
  return new TopicHub({
    now,
    onDemandChange: (changed) => {
      if (changed === RECORDING_FEED) pipeline()?.demandChanged();
    },
  });
}

/**
 * Starts `pipeline` and resolves once it is done. An aborted `signal` (also one aborted before the call) stops the run,
 * and it throws a `StartupError`; so does a failing source.
 */
export async function runToEnd(pipeline: FeedPipeline, path: string, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw new StartupError('interrupted');
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

/**
 * Runs one recording through the pipeline as fast as possible, storing its sessions in `db`: each session's log is
 * written once, at its end, and replaces the stored one in one transaction (C24, C61; a run stopped early writes
 * nothing). Nobody listens to the hub. An aborted `signal` (also one aborted before the call) stops the run, and it
 * throws a `StartupError`.
 */
export async function processRecording(path: string, db: Db, log: Logger, signal: AbortSignal, config: FeatureConfig, rulesVersion: string): Promise<void> {
  if (signal.aborted) throw new StartupError('interrupted');
  let pipeline: FeedPipeline | undefined = undefined;
  const hub = recordingHub(() => pipeline);
  pipeline = recordingPipeline({ path, hub, log, config, storage: { db, sourcePath: path, rulesVersion, mode: 'replace' } });
  await runToEnd(pipeline, path, signal);
}
