// Scripted sessions for the tests of the session-phase sub-machines and of others that need a race start. Each beat
// is one frame: its session time, its receive (wall) time, the events and the Session packet it carries, and what the
// cars do. Session time and wall time are set on the packets before a SessionTracker assembles them, so the frames
// carry them as the game's would.
import { feedId } from '@pitwall/domain';
import type { EventDetails, Packet, SessionPacket } from '@pitwall/protocol';
import { SessionRunner, SessionTracker, type Frame, type StepResult } from '../../src/index.ts';
import { ScenarioBuilder, type FrameDraft } from '../builders/index.ts';
import type { DeepPartial } from '../builders/packet.ts';
import { initFor } from '../support/run.ts';
import { runAll } from '../support/runner.ts';

/** Session time and wall time per frame unless a beat says otherwise, in ms. */
export const STEP = 16;
/** Track length of every scripted session, in m. */
export const TRACK = 4000;

export type Beat = {
  /** Session time of the frame in ms; default the previous frame's plus `STEP` (0 for the first). */
  at?: number;
  /** Receive time of the frame's packets in ms; default the previous frame's plus `STEP` (0 for the first). */
  wall?: number;
  events?: EventDetails[];
  /** A Session packet in this frame: these fields over the script's and every earlier beat's (they stick). */
  session?: DeepPartial<SessionPacket>;
  cars?: (d: FrameDraft) => void;
};

export type ScriptOptions = {
  cars?: number;
  /**
   * Session packet fields of every Session packet, under the beats' own. Default a race on a 4000 m track, alone in its
   * weekend: the weekend structure holds the session's type, so the weekend phase is decided on the first frame (C14).
   */
  session?: DeepPartial<SessionPacket>;
};

/** The packets of `beats` as the game sends them, each with its receive time. */
export function scriptPackets(beats: readonly Beat[], o: ScriptOptions = {}): Array<{ packet: Packet; receivedAtMs: number }> {
  const b = new ScenarioBuilder({ cars: o.cars ?? 2, stepMs: STEP });
  let session: DeepPartial<SessionPacket> = { trackLength: TRACK, numSessionsInWeekend: 1, weekendStructure: [o.session?.sessionType ?? 15], ...o.session };
  b.session(session);
  const at: number[] = [];
  const wall: number[] = [];
  beats.forEach((beat, i) => {
    at.push(beat.at ?? (i === 0 ? 0 : at[i - 1]! + STEP));
    wall.push(beat.wall ?? (i === 0 ? 0 : wall[i - 1]! + STEP));
    if (beat.session) b.session((session = { ...session, ...beat.session }));
    for (const e of beat.events ?? []) b.event(e);
    b.frame((d) => beat.cars?.(d));
  });
  return b.packets().map(({ packet }) => {
    const i = Math.min(packet.header.frameIdentifier, beats.length - 1);
    return { packet: { ...packet, header: { ...packet.header, sessionTime: at[i]! / 1000 } } as Packet, receivedAtMs: wall[i]! };
  });
}

/** The frames of `beats`, assembled by a `SessionTracker` from `scriptPackets`. */
export function script(beats: readonly Beat[], o: ScriptOptions = {}): Frame[] {
  const tracker = new SessionTracker({ feedId: feedId('situations') });
  const events = scriptPackets(beats, o).flatMap(({ packet, receivedAtMs }) => tracker.push(packet, receivedAtMs));
  return [...events, ...tracker.end()].flatMap((e) => (e.type === 'frame' ? [e.frame] : []));
}

/** `n` beats from `make(k)`, k = 0..n-1. */
export const beats = (n: number, make: (k: number) => Beat = () => ({})): Beat[] => Array.from({ length: n }, (_, k) => make(k));

/** A runner over `frames` and every step's result. */
export function run(frames: Frame[]): { runner: SessionRunner; results: StepResult[] } {
  const runner = new SessionRunner(initFor(frames));
  return { runner, results: runAll(runner, frames) };
}

// Events as the game sends them.
export const stlg = (numLights: number): EventDetails => ({ code: 'STLG', numLights });
export const LGOT: EventDetails = { code: 'LGOT' };
export const RDFL: EventDetails = { code: 'RDFL' };
export const CHQF: EventDetails = { code: 'CHQF' };
export const SEND: EventDetails = { code: 'SEND' };
export const rcwn = (vehicleIdx: number): EventDetails => ({ code: 'RCWN', vehicleIdx });
/** SCAR: type 0 none, 1 SC, 2 VSC, 3 formation lap; event 0 deployed, 1 returning, 2 returned, 3 resume. */
export const scar = (safetyCarType: number, eventType: number): EventDetails => ({ code: 'SCAR', safetyCarType, eventType });
export const ovtk = (overtaking: number, overtaken: number): EventDetails => ({ code: 'OVTK', overtakingVehicleIdx: overtaking, beingOvertakenVehicleIdx: overtaken });
export const flbk = (frameId: number, sessionTimeMs: number): EventDetails => ({ code: 'FLBK', flashbackFrameIdentifier: frameId, flashbackSessionTime: sessionTimeMs / 1000 });

/** Session `safetyCarStatus`: 0 green, 1 SC, 2 VSC, 3 formation lap. */
export const status = (safetyCarStatus: number): DeepPartial<SessionPacket> => ({ safetyCarStatus });

/** Sets car `car`'s LapData fields in the frame. */
export const lap = (d: FrameDraft, car: number, fields: Partial<FrameDraft['lapData']['lapData'][number]>): void => {
  Object.assign(d.lapData.lapData[car]!, fields);
};

/** Sets car `car`'s fuel in the tank, kg. */
export const fuel = (d: FrameDraft, car: number, kg: number): void => {
  d.status.carStatusData[car]!.fuelInTank = kg;
};

/** Frame of `gridStart`'s first start light; the next four follow `LIGHT_EVERY` frames apart. */
export const FIRST_LIGHT = 10;
const LIGHT_EVERY = 10;
/** Frame of `gridStart`'s lights out. */
export const LIGHTS_OUT = 59;
/**
 * The start without a formation lap (shape S1, raceSingapore): the clock holds at 0 on the grid, five start lights from
 * frame `FIRST_LIGHT`, lights out at frame `LIGHTS_OUT`; the clock runs from the frame after it. `race(k)` shapes race
 * frame k (k = 0 is the frame after lights out); `n` race frames.
 */
export const gridStart = (n: number, race: (k: number) => Beat = () => ({})): Beat[] => [
  ...beats(LIGHTS_OUT + 1, (k) => ({
    at: 0,
    events: [...[1, 2, 3, 4, 5].flatMap((light) => (k === FIRST_LIGHT + (light - 1) * LIGHT_EVERY ? [stlg(light)] : [])), ...(k === LIGHTS_OUT ? [LGOT] : [])],
  })),
  ...beats(n, (k) => ({ at: (k + 1) * STEP, ...race(k) })),
];
/** Session time of race frame k of `gridStart`. */
export const raceAt = (k: number): number => (k + 1) * STEP;
