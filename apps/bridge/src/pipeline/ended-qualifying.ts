// Whether a stored session's recording is an ended qualifying (SP4.3d spec §7.0 rule 4): the startup restore keeps only
// such a session's run (`FeedPipeline.restoreEnded`).
import { endsQualifying, feedId, unknown, type FeedId, type WeekendPhase } from '@pitwall/domain';
import { TopicHub } from '../hub/topic-hub.ts';
import type { PacketSource, RawPacket } from '../input/packet-source.ts';
import type { Logger } from '../log.ts';
import { readPwrec } from '../pwrec/reader.ts';
import { FeedPipeline } from './feed-pipeline.ts';

const PROBE_FEED: FeedId = feedId('probe');

/** A source the caller pushes into, one datagram at a time. */
class PushSource implements PacketSource {
  readonly feedId = PROBE_FEED;
  readonly #done: PromiseWithResolvers<void> = Promise.withResolvers();
  readonly done = this.#done.promise;
  #onPacket: ((packet: RawPacket) => void) | undefined;

  start(onPacket: (packet: RawPacket) => void): void {
    this.#onPacket = onPacket;
  }

  push(packet: RawPacket): void {
    this.#onPacket?.(packet);
  }

  stop(): Promise<void> {
    this.#onPacket = undefined;
    this.#done.resolve();
    return this.done;
  }
}

/**
 * Whether the recording at `path` is a session whose weekend phase ends qualifying (`endsQualifying`) and that holds its
 * end. Both are the engine's (C13, C14, C43; the bridge reads no signal): the recording runs through an engine of its
 * own, with no unit, no storage and no file; the weekend phase is the machine's decision, and the session's end is how
 * frame assembly ended it (`newestSessionEnd`: `SEND`, not the end of the recording). A session the machine places in
 * another phase stops the run at once. A recording that cannot be read is no ended qualifying.
 */
export async function isEndedQualifying(path: string, log: Logger): Promise<boolean> {
  const source = new PushSource();
  const probe = new FeedPipeline({
    feedId: PROBE_FEED,
    source,
    hub: new TopicHub({ now: () => 0, onDemandChange: () => {} }),
    features: [],
    log,
    tracks: () => unknown('notApplicable'),
  });
  probe.start();
  let phase: WeekendPhase | undefined;
  try {
    for await (const record of readPwrec(path)) {
      source.push({ feedId: PROBE_FEED, receivedAtMs: record.t, bytes: record.payload });
      if (phase !== undefined) continue;
      const decided = probe.weekendPhase();
      if (decided === undefined || decided.kind === 'pending') continue;
      phase = decided;
      if (!endsQualifying(phase)) return false;
    }
    // The input's end: frame assembly ends the session at its end (SEND) or, without one, at the end of the recording.
    await probe.stop();
    return phase !== undefined && probe.newestSessionEnd() === 'SEND';
  } catch (error) {
    log.warn({ pwrecPath: path, err: error }, 'recording not read: no ended qualifying');
    return false;
  } finally {
    await probe.stop();
  }
}
