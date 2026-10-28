import type { FeedId } from '@pitwall/domain';
import { PacketId, type Packet, type SessionPacket } from '@pitwall/protocol';
import { FrameAssembler } from './assembler.ts';
import type { Frame } from './frame.ts';
import { emptyMetrics, type FrameMetrics } from './metrics.ts';

export type TrackerEvent =
  | { type: 'sessionStarted'; sessionUid: bigint; session: SessionPacket; receivedAtMs: number }
  | { type: 'frame'; sessionUid: bigint; frame: Frame }
  | { type: 'sessionEnded'; sessionUid: bigint; reason: 'SEND' | 'replaced' | 'streamEnd' };

type EndReason = Extract<TrackerEvent, { type: 'sessionEnded' }>['reason'];

/** The game sends `sessionUid = 0` packets around a session's end; this long a window on both sides of SEND keeps them. */
const DEFAULT_GRACE_MS = 10_000;

/** The session being assembled; `sendAt` is set once its SEND event arrived (the grace window). */
type Current = { uid: bigint; assembler: FrameAssembler; sendAt?: number };
type Pending = { packet: Packet; receivedAtMs: number };

const isSessionEnd = (packet: Packet): boolean => packet.packetId === PacketId.event && packet.details.code === 'SEND';

const framesOf = (sessionUid: bigint, frames: Frame[]): TrackerEvent[] =>
  frames.map((frame) => ({ type: 'frame', sessionUid, frame }));

const sum = (parts: FrameMetrics[], key: 'framesClosed' | 'incompleteFrames' | 'latePackets'): number =>
  parts.reduce((total, part) => total + part[key], 0);

/**
 * Splits a packet stream into sessions and assembles each session's frames (spec 5.3).
 * `receivedAtMs` is only compared, never read from a clock.
 *
 * `sessionUid = 0` packets belong to the session whose SEND event is within `graceMs`
 * (before or after it), so they wait in `#pending` until SEND shows up or they grow too old.
 */
export class SessionTracker {
  readonly #feedId: FeedId;
  readonly #graceMs: number;
  /** One assembler per session: the game's frame counter may restart in a new session. */
  readonly #assemblers: FrameAssembler[] = [];
  readonly #counters = emptyMetrics();
  #current: Current | undefined;
  #pending: Pending[] = [];

  constructor(opts: { feedId: FeedId; graceMs?: number }) {
    this.#feedId = opts.feedId;
    this.#graceMs = opts.graceMs ?? DEFAULT_GRACE_MS;
  }

  get metrics(): FrameMetrics {
    const parts = this.#assemblers.map((assembler) => assembler.metrics);
    const newest = parts.at(-1);
    return {
      ...this.#counters,
      framesClosed: sum(parts, 'framesClosed'),
      incompleteFrames: sum(parts, 'incompleteFrames'),
      latePackets: sum(parts, 'latePackets'),
      ...(newest?.lastSessionTime !== undefined && { lastSessionTime: newest.lastSessionTime }),
      ...(newest?.cadenceMs !== undefined && { cadenceMs: newest.cadenceMs }),
    };
  }

  push(packet: Packet, receivedAtMs: number): TrackerEvent[] {
    const events: TrackerEvent[] = [];
    const expired = this.#current?.sendAt !== undefined && receivedAtMs - this.#current.sendAt > this.#graceMs;
    if (expired) events.push(...this.#close('SEND'));
    const current = this.#current;
    if (current === undefined) events.push(...this.#pushWithoutSession(packet, receivedAtMs));
    else if (current.sendAt === undefined) events.push(...this.#pushOpen(current, packet, receivedAtMs));
    else events.push(...this.#pushGrace(current, packet, receivedAtMs));
    return events;
  }

  /** Ends the stream: closes the current session and drops waiting UID-0 packets. */
  end(): TrackerEvent[] {
    if (this.#current === undefined) return [];
    return this.#close(this.#current.sendAt === undefined ? 'streamEnd' : 'SEND');
  }

  #pushWithoutSession(packet: Packet, receivedAtMs: number): TrackerEvent[] {
    if (packet.header.sessionUid === 0n) {
      this.#counters.droppedUid0++;
      return [];
    }
    if (packet.packetId !== PacketId.session) {
      this.#counters.droppedBeforeSession++;
      return [];
    }
    return this.#start(packet, receivedAtMs);
  }

  #pushOpen(current: Current, packet: Packet, receivedAtMs: number): TrackerEvent[] {
    this.#dropOldPending(receivedAtMs);
    const uid = packet.header.sessionUid;
    if (uid === current.uid) {
      if (!isSessionEnd(packet)) return framesOf(current.uid, current.assembler.push(packet));
      // Frame ids of the waiting packets and of SEND are unreliable; they join the newest frame.
      for (const waiting of this.#pending) current.assembler.attach(waiting.packet);
      current.assembler.attach(packet);
      this.#pending = [];
      current.sendAt = receivedAtMs;
      return [];
    }
    if (uid === 0n) {
      this.#pending.push({ packet, receivedAtMs });
      return [];
    }
    if (packet.packetId === PacketId.session) return [...this.#close('replaced'), ...this.#start(packet, receivedAtMs)];
    this.#counters.droppedBeforeSession++;
    return [];
  }

  #pushGrace(current: Current, packet: Packet, receivedAtMs: number): TrackerEvent[] {
    const uid = packet.header.sessionUid;
    if (uid === 0n || uid === current.uid) {
      current.assembler.attach(packet);
      return [];
    }
    if (packet.packetId === PacketId.session) return [...this.#close('SEND'), ...this.#start(packet, receivedAtMs)];
    this.#counters.droppedBeforeSession++;
    return [];
  }

  #start(session: SessionPacket, receivedAtMs: number): TrackerEvent[] {
    const sessionUid = session.header.sessionUid;
    const assembler = new FrameAssembler({ feedId: this.#feedId });
    this.#assemblers.push(assembler);
    this.#current = { uid: sessionUid, assembler };
    return [{ type: 'sessionStarted', sessionUid, session, receivedAtMs }, ...framesOf(sessionUid, assembler.push(session))];
  }

  /** Flushes the current session's frames and ends it; waiting UID-0 packets never saw SEND and are dropped. */
  #close(reason: EndReason): TrackerEvent[] {
    const current = this.#current;
    if (current === undefined) return [];
    this.#current = undefined;
    this.#counters.droppedUid0 += this.#pending.length;
    this.#pending = [];
    return [...framesOf(current.uid, current.assembler.flush()), { type: 'sessionEnded', sessionUid: current.uid, reason }];
  }

  #dropOldPending(receivedAtMs: number): void {
    const before = this.#pending.length;
    this.#pending = this.#pending.filter((waiting) => receivedAtMs - waiting.receivedAtMs <= this.#graceMs);
    this.#counters.droppedUid0 += before - this.#pending.length;
  }
}
