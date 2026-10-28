// Scripted sessions for tests: frames are built as packets, sent through the encoder and assembled by a SessionTracker.
import { feedId, toSessionTime, type SessionTime } from '@pitwall/domain';
import {
  decode,
  encode,
  type CarStatusPacket,
  type CarTelemetryPacket,
  type EventDetails,
  type LapDataPacket,
  type MotionExPacket,
  type MotionPacket,
  type Packet,
  type PacketName,
  type PacketOf,
  type ParticipantsPacket,
  type SessionPacket,
} from '@pitwall/protocol';
import { MENU_RATE_SLOTS, SessionTracker, type Frame } from '../../src/index.ts';
import { buildPacket, deepMerge, type DeepPartial } from './packet.ts';

export type MenuSlot = (typeof MENU_RATE_SLOTS)[number];

/** The packets of one frame while a test shapes it; mutate the menu packets in place. */
export type FrameDraft = {
  readonly index: number;
  readonly sessionTime: SessionTime;
  motion: MotionPacket;
  lapData: LapDataPacket;
  telemetry: CarTelemetryPacket;
  status: CarStatusPacket;
  motionEx: MotionExPacket;
  /** Sends an extra packet in this frame only. */
  add<N extends PacketName>(name: N, o?: DeepPartial<PacketOf<N>>): PacketOf<N>;
  /** Leaves the slot's packet out of this frame; the next frame still carries it forward. */
  drop(slot: MenuSlot): void;
};

type Timed = { packet: Packet; receivedAtMs: number };
type Menu = Pick<FrameDraft, MenuSlot>;
type Options = { sessionUid?: bigint; cars?: number; player?: number; stepMs?: number };

const SESSION_DEFAULTS = {
  sessionType: 15,
  trackId: 0,
  totalLaps: 10,
  trackLength: 5000,
  sector2LapDistanceStart: 1500,
  sector3LapDistanceStart: 3300,
  trackTemperature: 30,
  airTemperature: 22,
  pitSpeedLimit: 80,
  sessionDuration: 3600,
  sessionTimeLeft: 3600,
  tyreTemperature: 1,
};

class Draft implements FrameDraft {
  readonly index: number;
  readonly sessionTime: SessionTime;
  motion: MotionPacket;
  lapData: LapDataPacket;
  telemetry: CarTelemetryPacket;
  status: CarStatusPacket;
  motionEx: MotionExPacket;
  readonly added: Packet[] = [];
  readonly dropped = new Set<MenuSlot>();

  constructor(index: number, sessionTime: SessionTime, menu: Menu) {
    this.index = index;
    this.sessionTime = sessionTime;
    this.motion = menu.motion;
    this.lapData = menu.lapData;
    this.telemetry = menu.telemetry;
    this.status = menu.status;
    this.motionEx = menu.motionEx;
  }

  add<N extends PacketName>(name: N, o?: DeepPartial<PacketOf<N>>): PacketOf<N> {
    const packet = buildPacket(name, o);
    this.added.push(packet);
    return packet;
  }

  drop(slot: MenuSlot): void {
    this.dropped.add(slot);
  }

  menu(): Menu {
    return { motion: this.motion, lapData: this.lapData, telemetry: this.telemetry, status: this.status, motionEx: this.motionEx };
  }
}

const roundTrip = (packet: Packet): Packet => {
  const decoded = decode(encode(packet));
  if (!decoded.ok) throw new Error(`scenario packet ${packet.packetId}: ${decoded.error.kind}`);
  return decoded.packet;
};

export class ScenarioBuilder {
  readonly #sessionUid: bigint;
  readonly #cars: number;
  readonly #player: number;
  readonly #stepMs: number;
  /** Packets waiting for the next frame; before the first frame the first two are the default Session and Participants. */
  #pending: Packet[];
  #prev: Menu;
  #frameCount = 0;
  readonly #out: Timed[] = [];

  constructor(o: Options = {}) {
    this.#sessionUid = o.sessionUid ?? 1n;
    this.#cars = o.cars ?? 20;
    this.#player = o.player ?? 0;
    this.#stepMs = o.stepMs ?? 16;
    this.#pending = [this.#sessionPacket(), this.#participantsPacket()];
    this.#prev = this.#defaultMenu();
  }

  /** Before the first frame this replaces the default Session; later it is sent with the next frame. */
  session(o: DeepPartial<SessionPacket> = {}): this {
    return this.#queue(0, this.#sessionPacket(o));
  }

  /** Before the first frame this replaces the default Participants; later it is sent with the next frame. */
  participants(o: DeepPartial<ParticipantsPacket> = {}): this {
    return this.#queue(1, this.#participantsPacket(o));
  }

  event(details: EventDetails): this {
    this.#pending.push(buildPacket('event', { details }));
    return this;
  }

  frame(fn: (f: FrameDraft) => void): this {
    const index = this.#frameCount++;
    const draft = new Draft(index, toSessionTime(this.#timeMs(index) / 1000), structuredClone(this.#prev));
    fn(draft);
    const menuGroup = MENU_RATE_SLOTS.filter((slot) => !draft.dropped.has(slot)).map((slot) => draft[slot]);
    this.#out.push(...this.#stamp(index, [...this.#pending, ...draft.added, ...menuGroup]));
    this.#pending = [];
    this.#prev = draft.menu();
    return this;
  }

  frames(n: number, fn: (f: FrameDraft, i: number) => void): this {
    for (let i = 0; i < n; i++) this.frame((f) => fn(f, i));
    return this;
  }

  /** Every packet as the decoder reads it back, so f32 rounding and field ranges are real. Queued packets without a frame get a last frame. */
  packets(): Array<{ packet: Packet; receivedAtMs: number }> {
    const trailing = this.#stamp(this.#frameCount, this.#pending);
    return [...this.#out, ...trailing].map(({ packet, receivedAtMs }) => ({ packet: roundTrip(packet), receivedAtMs }));
  }

  build(): Frame[] {
    const tracker = new SessionTracker({ feedId: feedId('scenario') });
    const events = this.packets().flatMap(({ packet, receivedAtMs }) => tracker.push(packet, receivedAtMs));
    return [...events, ...tracker.end()].flatMap((e) => (e.type === 'frame' ? [e.frame] : []));
  }

  #queue(slot: 0 | 1, packet: Packet): this {
    if (this.#frameCount === 0) this.#pending[slot] = packet;
    else this.#pending.push(packet);
    return this;
  }

  #timeMs(index: number): number {
    return index * this.#stepMs;
  }

  /** Gives the packets the headers and arrival time of frame `index`. */
  #stamp(index: number, packets: Packet[]): Timed[] {
    const ms = this.#timeMs(index);
    return packets.map((packet) => ({
      receivedAtMs: ms,
      packet: {
        ...packet,
        header: {
          ...packet.header,
          sessionUid: this.#sessionUid,
          sessionTime: ms / 1000,
          frameIdentifier: index,
          overallFrameIdentifier: index,
          playerCarIndex: this.#player,
        },
      },
    }));
  }

  #sessionPacket(o: DeepPartial<SessionPacket> = {}): SessionPacket {
    return buildPacket('session', deepMerge(SESSION_DEFAULTS, o) as DeepPartial<SessionPacket>);
  }

  #participantsPacket(o: DeepPartial<ParticipantsPacket> = {}): ParticipantsPacket {
    const own = (i: number): boolean => i === this.#player;
    const defaults = {
      numActiveCars: this.#cars,
      participants: Array.from({ length: this.#cars }, (_, i) => ({
        aiControlled: own(i) ? 0 : 1,
        driverId: own(i) ? 255 : i,
        networkId: own(i) ? 0 : 255,
        teamId: Math.floor(i / 2),
        raceNumber: i + 1,
        name: `DRIVER ${i}`,
        yourTelemetry: 1,
      })),
    };
    return buildPacket('participants', deepMerge(defaults, o) as DeepPartial<ParticipantsPacket>);
  }

  #defaultMenu(): Menu {
    const cars = Array.from({ length: this.#cars }, (_, i) => i);
    return {
      motion: buildPacket('motion'),
      lapData: buildPacket('lapData', {
        lapData: cars.map((i) => ({ carPosition: i + 1, gridPosition: i + 1, currentLapNum: 1, resultStatus: 2, driverStatus: 4 })),
      }),
      telemetry: buildPacket('carTelemetry'),
      status: buildPacket('carStatus', {
        carStatusData: cars.map(() => ({ actualTyreCompound: 18, visualTyreCompound: 17 })),
      }),
      motionEx: buildPacket('motionEx'),
    };
  }
}
