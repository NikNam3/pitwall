// Session time is not a timeline (spec docs/superpowers/specs/2026-10-30-situations-design.md principle 6, 3.3): it
// resets, holds, runs ahead of wall time in the garage and jumps into the post-session simulation. This is the one
// place that reads its jumps, keeps the race clock the other steps stamp with, and reads the wall time of the frames for
// pauses.
import type { Known, Ms, OpenSessionPhase, SessionPhaseDetail, SessionPhaseSpan, SessionTime } from '@pitwall/domain';
import type { Frame } from '../../frame/frame.ts';
import type { EngineState, LapCursor } from '../../state/engine-state.ts';
import { mapCorners } from '../../step/corners.ts';
import type { ClockFall } from '../../step/types.ts';

/**
 * A fall of the session time at most this many frames after the race's lights out is the race clock settling: seen 4
 * frames after it (raceZandvoortOnline) and 11 and 12 (raceZandvoortUidReuse); t1-diagnosis.md P4, user ruling 2026-10-30.
 */
export const START_SETTLE_FRAMES = 60;
/**
 * A forward jump of more than this from one frame to the next is the game simulating the rest of an online session
 * (inventory 1.7: from 24 s to 6361 s, from 1207 s to 5837 s); spec 3.1, user ruling 2026-10-30.
 */
export const SIMULATION_JUMP_MS = 60_000;
/**
 * The simulation jump also outruns wall time by more than this factor: the recorded ones are thousands of seconds
 * within one frame interval, while garage acceleration runs at most about 30 times wall time (inventory 1.9: 10.8x
 * SgQ, 4.6x MiP), so a stall of a few seconds in the garage is no simulation; review 2 B3, ruling 2026-10-30.
 */
export const SIMULATION_RATE = 60;
/**
 * Offline, no frame for longer than this (wall time) beyond what the session time advanced is a pause (inventory 1.8:
 * 9 to 162 s seen); spec 3.1, user ruling 2026-10-30.
 */
export const PAUSE_AFTER_WALL_MS = 2000;

/** A session time of the game on the race clock of `state`. */
export const onRaceClock = (state: EngineState, sessionTime: SessionTime): SessionTime => sessionTime + state.open.phaseBook.clockOffsetMs;

/**
 * Notes a rewind the runner just took, before the game's new frame is applied: wall time does not go back, so an offline
 * pause is measured from the last frame applied (`before.lastWallMs`), not the restored one; and when the new frame still
 * carries the old timeline's time (at or above `before.sessionTime`, where the rewind started), the frames on that time
 * are part of the flashback (`staleFromMs`). Both times are on the race clock, the frame's on the restored one: a
 * rewind from a frame after a fall to one before it then sees the new timeline below the old time, as it is.
 */
export const noteRewind = (state: EngineState, before: { sessionTime: SessionTime; lastWallMs: number | undefined }, frame: Frame): void => {
  const book = state.open.phaseBook;
  book.lastWallMs = before.lastWallMs;
  book.staleFromMs = onRaceClock(state, frame.sessionTime) >= before.sessionTime ? before.sessionTime : undefined;
};

/**
 * Whether the frame (on the race clock) still belongs to the flashback just taken: one on the old timeline's time, or
 * the first on the target's clock, whose fall from the old time is the flashback's and no clock fall. The mark ends at
 * that frame.
 */
export const followsRewind = (state: EngineState, frame: Frame): boolean => {
  const book = state.open.phaseBook;
  if (book.staleFromMs === undefined) return false;
  if (frame.sessionTime < book.staleFromMs) book.staleFromMs = undefined;
  return true;
};

/** What the frame's session time did against the previous frame's. */
export type TimeJump =
  | { kind: 'none' }
  /** The race clock settling after lights out: the start's entries move back by `offsetMs`. */
  | { kind: 'settle'; offsetMs: Ms }
  /** The online simulation of the rest of the session. */
  | { kind: 'simulated' }
  /**
   * Any other fall: it is reported with the game's times, and from the race start on the race clock continues over it
   * (`offsetMs`, the fall's size; 0 before the start, where the start's own rules apply).
   */
  | { kind: 'fall'; fall: ClockFall; offsetMs: Ms };

const NONE: TimeJump = { kind: 'none' };

/** The phases before the start: a fall there, before any lights out, is the start's (the grid's clock, the formation reset). */
const BEFORE_START: ReadonlySet<OpenSessionPhase['kind']> = new Set(['preStart', 'formation', 'startLights']);

/**
 * The game simulated the rest of the session: the clock jumped forward by more than `SIMULATION_JUMP_MS` and by more
 * than `SIMULATION_RATE` times the wall time between the frames (without a wall time before, by the first alone).
 */
const isSimulation = (state: EngineState, frame: Frame, advanceMs: Ms): boolean => {
  const { lastWallMs } = state.open.phaseBook;
  return advanceMs > SIMULATION_JUMP_MS && (lastWallMs === undefined || advanceMs > SIMULATION_RATE * (frame.receivedAtMs - lastWallMs));
};

/**
 * Reads the jump of the session time from the previous frame to `frame` (on the race clock). A frame the runner took
 * as a flashback report is no jump here (the caller skips it); garage acceleration (the clock ahead of wall time) is
 * none either. A fall while the formation lap is open is the formation's reset: lights out discards the formation, so
 * it needs nothing itself.
 */
export const timeJumpOf = (state: EngineState, frame: Frame): TimeJump => {
  const { phaseBook } = state.open;
  const { kind } = state.open.situations.session;
  if (kind === 'postSession') return NONE;
  const fromMs = state.sessionTime;
  const toMs = frame.sessionTime;
  if (isSimulation(state, frame, toMs - fromMs)) return { kind: 'simulated' };
  if (toMs >= fromMs) return NONE;
  const sinceLightsOut = phaseBook.lightsOut === undefined ? undefined : frame.frameId - phaseBook.lightsOut.frameId;
  if (sinceLightsOut !== undefined && sinceLightsOut > 0 && sinceLightsOut <= START_SETTLE_FRAMES) return { kind: 'settle', offsetMs: fromMs - toMs };
  if (phaseBook.formationFrom !== undefined) return NONE;
  const raw = (at: SessionTime): SessionTime => at - phaseBook.clockOffsetMs;
  const started = phaseBook.lightsOut !== undefined || !BEFORE_START.has(kind);
  return { kind: 'fall', fall: { fromMs: raw(fromMs), toMs: raw(toMs) }, offsetMs: started ? fromMs - toMs : 0 };
};

type Shift = (at: SessionTime) => SessionTime;

const shiftKnown = <T>(value: Known<T>, shift: Shift): Known<T> => (value.known ? { ...value, at: shift(value.at) } : value);

const shiftDetail = (detail: SessionPhaseDetail, shift: Shift): SessionPhaseDetail =>
  detail.kind === 'neutralised' ? { ...detail, stages: detail.stages.map((s) => ({ ...s, at: shift(s.at) })) } : detail;

const shiftOpen = (phase: OpenSessionPhase, shift: Shift): OpenSessionPhase => ({
  ...phase,
  start: shift(phase.start),
  ...(phase.detail && { detail: shiftDetail(phase.detail, shift) }),
});

const shiftSpan = (span: SessionPhaseSpan, shift: Shift): SessionPhaseSpan => ({ ...span, ...shiftOpen(span, shift), end: shift(span.end) });

/** The lap so far on the new clock: it began no earlier than its start there, so a jump before the settling drops out. */
const shiftCursor = (cursor: LapCursor, shift: Shift): void => {
  cursor.startedAt = shift(cursor.startedAt);
  cursor.lastSeenAt = shift(cursor.lastSeenAt);
  cursor.trackedMs = Math.min(cursor.trackedMs, cursor.lastSeenAt - cursor.startedAt);
  cursor.scMs = Math.min(cursor.scMs, cursor.trackedMs);
  cursor.vscMs = Math.min(cursor.vscMs, cursor.trackedMs);
  cursor.fuelAtStartKg = shiftKnown(cursor.fuelAtStartKg, shift);
  cursor.ersStoreAtStartJ = shiftKnown(cursor.ersStoreAtStartJ, shift);
  const wear = cursor.wearAtStartPct;
  cursor.wearAtStartPct = mapCorners((c) => shiftKnown(wear[c], shift));
};

/**
 * The race clock settled after lights out by falling `offsetMs` (spec 3.3, user ruling 2026-10-30): the start's entries
 * (the start lights, lights out and everything since, history and open trackers alike, and the previous frame's time)
 * move back by the fall, clamped at 0, which keeps their order and durations. Entries are replaced, not changed in
 * place, since readers may hold them.
 */
export const restampStart = (state: EngineState, offsetMs: Ms): void => {
  const { history, open } = state;
  const start = open.phaseBook.lightsOut;
  if (!start) return;
  const shift: Shift = (at) => Math.max(0, at - offsetMs);
  const { from, phaseFrom } = start;
  // The previous frame's time too, so this frame's steps measure from it on the new clock.
  state.sessionTime = shift(state.sessionTime);
  const each = <T>(list: T[], fromIndex: number, move: (entry: T) => T): void => {
    list.splice(fromIndex, list.length - fromIndex, ...list.slice(fromIndex).map(move));
  };
  each(history.laps, from.laps, (lap) => ({ ...lap, completedAt: shift(lap.completedAt) }));
  each(history.pitStops, from.pitStops, (stop) => ({ ...stop, pitLaneEntry: shift(stop.pitLaneEntry), pitLaneExit: shift(stop.pitLaneExit) }));
  each(history.events, from.events, (event) => ({ ...event, at: shift(event.at) }));
  each(history.miniSectors, from.miniSectors, (crossing) => ({ ...crossing, at: shift(crossing.at) }));
  each(history.pauses, from.pauses, (pause) => ({ ...pause, start: shift(pause.start) }));
  each(history.flagPhases, from.flagPhases, (p) => ({
    ...p,
    start: shift(p.start),
    end: shift(p.end),
    scPhases: p.scPhases.map((s) => ({ ...s, at: shift(s.at) })),
  }));
  // The phase before the start lights ends where they begin; from the start lights on, the whole spans move.
  const before = history.sessionPhases[phaseFrom - 1];
  if (before) history.sessionPhases[phaseFrom - 1] = { ...before, end: shift(before.end) };
  each(history.sessionPhases, phaseFrom, (span) => shiftSpan(span, shift));
  open.situations.session = shiftOpen(open.situations.session, shift);
  const { unconfirmed, onlinePause } = open.phaseBook;
  if (unconfirmed) open.phaseBook.unconfirmed = { ...unconfirmed, closed: shiftSpan(unconfirmed.closed, shift), replaced: shiftOpen(unconfirmed.replaced, shift) };
  if (onlinePause) open.phaseBook.onlinePause = { ...onlinePause, start: shift(onlinePause.start) };
  for (const cursor of open.laps) if (cursor) shiftCursor(cursor, shift);
  open.miniSectors = open.miniSectors.map((cursor) => cursor && { ...cursor, at: shift(cursor.at) });
  open.pitVisits = open.pitVisits.map((visit) => visit && { ...visit, entry: shift(visit.entry) });
};

/**
 * Pauses (display only, spec 3.1). Offline: no frame for over `PAUSE_AFTER_WALL_MS` of wall time beyond what the session
 * time advanced, recorded at the frame before the gap. Online: the Session packet's `gamePaused`, open in
 * `phaseBook.onlinePause` while it lasts. Garage acceleration (session time ahead of wall time) is none.
 */
export const trackPauses = (state: EngineState, frame: Frame): void => {
  const { history, open } = state;
  const book = open.phaseBook;
  const wall = frame.receivedAtMs;
  if (state.session.networkGame) {
    const paused = frame.session?.gamePaused;
    if (paused === 1 && !book.onlinePause) {
      book.onlinePause = { start: frame.sessionTime, wallMs: wall };
    } else if (paused === 0 && book.onlinePause) {
      const { start, wallMs } = book.onlinePause;
      history.pauses.push({ start, wallMs: Math.max(0, Math.round(wall - wallMs)), kind: 'online' });
      book.onlinePause = undefined;
    }
  } else if (book.lastWallMs !== undefined) {
    const gap = wall - book.lastWallMs;
    if (gap - Math.max(0, frame.sessionTime - state.sessionTime) > PAUSE_AFTER_WALL_MS) {
      history.pauses.push({ start: state.sessionTime, wallMs: Math.round(gap), kind: 'offline' });
    }
  }
  book.lastWallMs = wall;
};
