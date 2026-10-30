import { toSessionTime, type FeedId } from '@pitwall/domain';
import { PacketId, type Packet } from '@pitwall/protocol';
import { MENU_RATE_SLOTS, type Frame } from './frame.ts';
import { CadenceTracker, emptyMetrics, type FrameMetrics } from './metrics.ts';

const DEFAULT_REORDER_WINDOW = 2;

/** A packet and when it arrived, if the caller knows. */
type Arrival = { packet: Packet; receivedAtMs: number | undefined };

/** Stores a packet in its slot: single-instance slots keep the last packet, list slots append. */
function place(frame: Frame, packet: Packet): void {
  frame.sessionTime = Math.max(frame.sessionTime, toSessionTime(packet.header.sessionTime));
  switch (packet.packetId) {
    case PacketId.motion: frame.motion = packet; break;
    case PacketId.lapData: frame.lapData = packet; break;
    case PacketId.carTelemetry: frame.telemetry = packet; break;
    case PacketId.carStatus: frame.status = packet; break;
    case PacketId.motionEx: frame.motionEx = packet; break;
    case PacketId.session: frame.session = packet; break;
    case PacketId.carDamage: frame.damage = packet; break;
    case PacketId.carSetups: frame.setups = packet; break;
    case PacketId.participants: frame.participants = packet; break;
    case PacketId.lapPositions: frame.lapPositions = packet; break;
    case PacketId.finalClassification: frame.finalClassification = packet; break;
    case PacketId.timeTrial: frame.timeTrial = packet; break;
    case PacketId.sessionHistory: frame.sessionHistory.push(packet); break;
    case PacketId.tyreSets: frame.tyreSets.push(packet); break;
    case PacketId.event: frame.events.push(packet); break;
    case PacketId.lobbyInfo: break;
  }
}

/**
 * Groups decoded packets into frames by `overallFrameIdentifier` (spec 5.2).
 * A frame closes once a packet more than `reorderWindow` frames newer has arrived;
 * packets for closed frames are dropped and counted as late.
 *
 * A packet that skips frames (more than `reorderWindow + 1` ahead of the newest) is held, not trusted: a packet type may
 * carry a header frozen far ahead (raceZandvoortUidReuse sends a LapPositions stamped frame 10539 after every real one),
 * and taking it would make every other packet late. A packet of another type within the window of a held one confirms
 * the jump (after lost packets that is the same frame's next packet); once the stream moves on without that, the held
 * packets are dropped and counted as late.
 */
export class FrameAssembler {
  readonly #feedId: FeedId;
  readonly #reorderWindow: number;
  readonly #open = new Map<number, Frame>();
  readonly #counters = emptyMetrics();
  readonly #cadence = new CadenceTracker();
  #newest: number | undefined;
  /** Packets far ahead of `#newest`, waiting for a packet of another type to confirm the jump. */
  #held: Arrival[] = [];

  constructor(opts: { feedId: FeedId; reorderWindow?: number }) {
    this.#feedId = opts.feedId;
    this.#reorderWindow = opts.reorderWindow ?? DEFAULT_REORDER_WINDOW;
  }

  get metrics(): FrameMetrics {
    const cadenceMs = this.#cadence.medianMs;
    const lastSessionTime = this.#cadence.lastSessionTime;
    return {
      ...this.#counters,
      ...(lastSessionTime !== undefined && { lastSessionTime }),
      ...(cadenceMs !== undefined && { cadenceMs }),
    };
  }

  /** Adds a packet that arrived at `receivedAtMs` (wall clock, ms); returns the frames it closed, oldest first. */
  push(packet: Packet, receivedAtMs?: number): Frame[] {
    const key = packet.header.overallFrameIdentifier;
    const arrival = { packet, receivedAtMs };
    if (this.#newest !== undefined && key - this.#newest > this.#reorderWindow + 1) return this.#pushAhead(arrival, key);
    return this.#accept(arrival, key);
  }

  /**
   * Merges a packet into the newest open frame, whatever its own frame id
   * (the session end event and grace-window packets carry frame id 0).
   * Without an open frame the packet is dropped and counted as late.
   */
  attach(packet: Packet): void {
    const newestFrame = [...this.#open.values()].sort((a, b) => b.overallFrameId - a.overallFrameId)[0];
    if (newestFrame === undefined) {
      this.#counters.latePackets++;
      return;
    }
    place(newestFrame, packet);
  }

  /** Closes every open frame, oldest first. Later packets are still checked against the newest frame id. */
  flush(): Frame[] {
    this.#dropHeld();
    return this.#closeWhere(() => true);
  }

  #accept({ packet, receivedAtMs }: Arrival, key: number): Frame[] {
    const newest = Math.max(this.#newest ?? key, key);
    if (newest - key > this.#reorderWindow) {
      this.#counters.latePackets++;
      return [];
    }
    if (newest !== this.#newest) this.#dropHeld();
    this.#newest = newest;
    place(this.#frameFor(packet, key, receivedAtMs), packet);
    return this.#closeWhere((k) => newest - k > this.#reorderWindow);
  }

  /** Holds a packet far ahead of the newest frame; a held packet of another type near it confirms the jump. */
  #pushAhead(arrival: Arrival, key: number): Frame[] {
    const { packetId } = arrival.packet;
    const confirmed = this.#held.some(
      ({ packet: held }) => held.packetId !== packetId && Math.abs(held.header.overallFrameIdentifier - key) <= this.#reorderWindow,
    );
    if (!confirmed) {
      this.#held.push(arrival);
      return [];
    }
    const jump = [...this.#held, arrival];
    this.#held = [];
    this.#newest = key;
    return jump.flatMap((a) => this.push(a.packet, a.receivedAtMs));
  }

  /** The stream moved on without confirming the held packets: their headers were stale. */
  #dropHeld(): void {
    this.#counters.latePackets += this.#held.length;
    this.#held = [];
  }

  #frameFor(packet: Packet, key: number, receivedAtMs: number | undefined): Frame {
    const existing = this.#open.get(key);
    if (existing !== undefined) return existing;
    const { header } = packet;
    const frame: Frame = {
      feedId: this.#feedId,
      sessionUid: header.sessionUid,
      frameId: header.frameIdentifier,
      overallFrameId: key,
      sessionTime: toSessionTime(header.sessionTime),
      playerCarIndex: header.playerCarIndex,
      ...(receivedAtMs !== undefined && { receivedAtMs }),
      sessionHistory: [],
      tyreSets: [],
      events: [],
    };
    this.#open.set(key, frame);
    return frame;
  }

  #closeWhere(shouldClose: (key: number) => boolean): Frame[] {
    const closing = [...this.#open.values()]
      .filter((frame) => shouldClose(frame.overallFrameId))
      .sort((a, b) => a.overallFrameId - b.overallFrameId);
    return closing.map((frame) => this.#close(frame));
  }

  #close(frame: Frame): Frame {
    this.#open.delete(frame.overallFrameId);
    this.#counters.framesClosed++;
    if (MENU_RATE_SLOTS.some((slot) => frame[slot] === undefined)) this.#counters.incompleteFrames++;
    this.#cadence.record(frame.sessionTime);
    return frame;
  }
}
