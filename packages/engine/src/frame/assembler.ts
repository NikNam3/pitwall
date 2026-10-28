import { toSessionTime, type FeedId } from '@pitwall/domain';
import { PacketId, type Packet } from '@pitwall/protocol';
import { MENU_RATE_SLOTS, type Frame } from './frame.ts';
import { CadenceTracker, emptyMetrics, type FrameMetrics } from './metrics.ts';

const DEFAULT_REORDER_WINDOW = 2;

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
 */
export class FrameAssembler {
  readonly #feedId: FeedId;
  readonly #reorderWindow: number;
  readonly #open = new Map<number, Frame>();
  readonly #counters = emptyMetrics();
  readonly #cadence = new CadenceTracker();
  #newest: number | undefined;

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

  /** Adds a packet; returns the frames it closed, oldest first. */
  push(packet: Packet): Frame[] {
    const key = packet.header.overallFrameIdentifier;
    const newest = Math.max(this.#newest ?? key, key);
    if (newest - key > this.#reorderWindow) {
      this.#counters.latePackets++;
      return [];
    }
    this.#newest = newest;
    place(this.#frameFor(packet, key), packet);
    return this.#closeWhere((k) => newest - k > this.#reorderWindow);
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
    return this.#closeWhere(() => true);
  }

  #frameFor(packet: Packet, key: number): Frame {
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
