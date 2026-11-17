// Whether a stored session's recording is an ended qualifying (SP4.3d spec §7.0 rule 4): the startup restore keeps only
// such a session's run (`FeedPipeline.restoreEnded`).
import { endsQualifying, feedId, unknown, type FeedId, type WeekendPhase } from '@pitwall/domain';
import { decode, PacketId, peekHeader } from '@pitwall/protocol';
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
 * end (SEND). The weekend phase is the machine's (C14, C43): the recording runs through an engine of its own, with no
 * unit, no storage and no file, only until the machine has decided it; then the rest of the recording is only scanned
 * for SEND. A recording that cannot be read is no ended qualifying.
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
      if (phase === undefined) {
        source.push({ feedId: PROBE_FEED, receivedAtMs: record.t, bytes: record.payload });
        const decided = probe.weekendPhase();
        if (decided === undefined || decided.kind === 'pending') continue;
        phase = decided;
        await probe.stop();
        if (!endsQualifying(phase)) return false;
      }
      if (peekHeader(record.payload)?.packetId !== PacketId.event) continue;
      const decoded = decode(record.payload);
      if (decoded.ok && decoded.packet.packetId === PacketId.event && decoded.packet.details.code === 'SEND') return true;
    }
    return false;
  } catch (error) {
    log.warn({ pwrecPath: path, err: error }, 'recording not read: no ended qualifying');
    return false;
  } finally {
    await probe.stop();
  }
}
