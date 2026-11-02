// Session time is not a timeline (spec docs/history/specs/2026-10-30-situations-design.md principle 6, 3.3): it
// resets, holds, runs ahead of wall time in the garage and jumps into the post-session simulation. This is the one
// place that reads its jumps, keeps the race clock the other steps stamp with, and reads the wall time of the frames for
// pauses.
import type { Known, Ms, OpenSessionPhase, SessionPhaseDetail, SessionPhaseSpan, SessionTime } from '@pitwall/domain';
import type { Frame } from '../../frame/frame.ts';
import type { EngineState, LapCursor } from '../../state/engine-state.ts';
import { mapCorners } from '../../step/corners.ts';
import type { ClockFall, ClockJump, RewindMark } from '../../step/types.ts';

/**
 * A fall of the session time at most this many frames after the race's lights out is the race clock settling: seen 4
 * frames after it (raceZandvoortOnline) and 11 and 12 (raceZandvoortUidReuse); t1-diagnosis.md P4, user ruling 2026-10-30.
 */
export const START_SETTLE_FRAMES = 60;
/**
 * A forward jump of more than this from one frame to the next is the game simulating the rest of an online session
 * (inventory 1.7: from 24 s to 6361 s, from 1207 s to 5837 s) when it also outruns wall time (`SIMULATION_RATE`), and
 * is reported as a clock jump otherwise; spec 3.1, 3.3, user ruling 2026-10-30.
 */
export const SIMULATION_JUMP_MS = 60_000;
/**
 * The simulation jump also outruns wall time by more than this factor: the recorded ones are thousands of seconds
 * within one frame interval, while garage acceleration peaks at about 31.6 times wall time (inventory 1.9: SgQ frames
 * 720 to 750, 15.777 s of session time in 0.5 s of wall time). The factor leaves a headroom of about 1.9 over that
 * peak, so a stall of a few seconds in the garage is no simulation; review 2 B3, review 3 E7, ruling 2026-10-30.
 */
export const SIMULATION_RATE = 60;
/**
 * Offline, no frame for longer than this (wall time) beyond what the session time advanced is a pause (inventory 1.8:
 * 9 to 162 s seen); spec 3.1, user ruling 2026-10-30.
 */
export const PAUSE_AFTER_WALL_MS = 2000;

/** A session time of the game on the race clock of `state`. */
export const onRaceClock = (state: EngineState, sessionTime: SessionTime): SessionTime => sessionTime + state.open.phaseBook.clockOffsetMs;

/** The mark of `state`, taken by the runner before it restores a snapshot (after the session's first frame). */
export const rewindMarkOf = (state: EngineState): RewindMark => ({
  frameId: state.lastFrameId,
  rawMs: state.sessionTime - state.open.phaseBook.clockOffsetMs,
  lastWallMs: state.open.phaseBook.lastWallMs,
});

/**
 * Notes the rewind the runner took on `frame`, before the frame is applied, on its first pass and on every replay of
 * it: wall time does not go back, so an offline pause is measured from the last frame applied before the rewind
 * (`before.lastWallMs`), not the restored one. The old timeline's last session time is the new frame's own when its
 * frame id still rises (an FLBK sent on the old timeline), else the time where the rewind started. While frames carry
 * exactly that time (inventory 1.10: the game's time, whatever the race clock did), they belong to the rewind's target
 * moment (`staleRawMs`).
 */
export const noteRewind = (state: EngineState, before: RewindMark, frame: Frame): void => {
  const book = state.open.phaseBook;
  book.lastWallMs = before.lastWallMs;
  const oldMs = frame.frameId > before.frameId ? frame.sessionTime : before.rawMs;
  book.staleRawMs = frame.sessionTime === oldMs ? oldMs : undefined;
};

/**
 * The frame stamped at the rewind's target moment (the state's time on the race clock) while it still carries the
 * pre-rewind session time (supervisor ruling 2026-10-31): what it records belongs there, and it is no jump. The mark
 * ends at the first frame on another time; undefined from then on.
 */
export const atRewindTarget = (state: EngineState, frame: Frame): Frame | undefined => {
  const book = state.open.phaseBook;
  if (book.staleRawMs === undefined) return undefined;
  if (frame.sessionTime === book.staleRawMs) return { ...frame, sessionTime: state.sessionTime };
  book.staleRawMs = undefined;
  return undefined;
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
  | { kind: 'fall'; fall: ClockFall; offsetMs: Ms }
  /** Any other forward jump by more than `SIMULATION_JUMP_MS` (a stall in the garage), with the game's times. */
  | { kind: 'forward'; jump: ClockJump };

const NONE: TimeJump = { kind: 'none' };

/** The phases before the start: a fall there, before any lights out, is the start's (the grid's clock, the formation reset). */
const BEFORE_START: ReadonlySet<OpenSessionPhase['kind']> = new Set(['preStart', 'formation', 'startLights']);

/**
 * Reads the jump of the session time from the previous frame to `frame` (on the race clock), `wallMs` of wall time
 * after it. A frame the runner took as a flashback report is no jump here (the caller skips it); garage acceleration
 * (the clock ahead of wall time) is none either. The rest of the session simulated is a forward jump by more than
 * `SIMULATION_JUMP_MS` and by more than `SIMULATION_RATE` times `wallMs`; any other forward jump by more than
 * `SIMULATION_JUMP_MS` is only reported. A fall while the formation lap is open is the formation's reset: lights out
 * discards the formation, so it needs nothing itself.
 */
export const timeJumpOf = (state: EngineState, frame: Frame, wallMs: number): TimeJump => {
  const { phaseBook } = state.open;
  const { kind } = state.open.situations.session;
  if (kind === 'postSession') return NONE;
  const fromMs = state.sessionTime;
  const toMs = frame.sessionTime;
  const raw = (at: SessionTime): SessionTime => at - phaseBook.clockOffsetMs;
  const advanceMs = toMs - fromMs;
  if (advanceMs > SIMULATION_JUMP_MS) {
    return advanceMs > SIMULATION_RATE * wallMs ? { kind: 'simulated' } : { kind: 'forward', jump: { fromMs: raw(fromMs), toMs: raw(toMs) } };
  }
  if (toMs >= fromMs) return NONE;
  const sinceLightsOut = phaseBook.lightsOut === undefined ? undefined : frame.frameId - phaseBook.lightsOut.frameId;
  if (sinceLightsOut !== undefined && sinceLightsOut > 0 && sinceLightsOut <= START_SETTLE_FRAMES) return { kind: 'settle', offsetMs: fromMs - toMs };
  if (phaseBook.formationFrom !== undefined) return NONE;
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
  // Rewrites the log in place (an old mechanism; Task 9 replaces it): the step is `rewritten`, so the projection is rebuilt.
  const { log, open } = state;
  const start = open.phaseBook.lightsOut;
  if (!start) return;
  const shift: Shift = (at) => Math.max(0, at - offsetMs);
  const { from, phaseFrom } = start;
  // The previous frame's time too, so this frame's steps measure from it on the new clock.
  state.sessionTime = shift(state.sessionTime);
  const each = <T>(list: T[], fromIndex: number, move: (entry: T) => T): void => {
    list.splice(fromIndex, list.length - fromIndex, ...list.slice(fromIndex).map(move));
  };
  each(log.laps, from.laps, (lap) => ({ ...lap, completedAt: shift(lap.completedAt) }));
  each(log.pitStops, from.pitStops, (stop) => ({ ...stop, pitLaneEntry: shift(stop.pitLaneEntry), pitLaneExit: shift(stop.pitLaneExit) }));
  each(log.events, from.events, (event) => ({ ...event, at: shift(event.at) }));
  each(log.crossings, from.crossings, (crossing) => ({ ...crossing, at: shift(crossing.at) }));
  each(log.pauses, from.pauses, (pause) => ({ ...pause, start: shift(pause.start) }));
  each(log.flagPhases, from.flagPhases, (p) => ({
    ...p,
    start: shift(p.start),
    end: shift(p.end),
    scPhases: p.scPhases.map((s) => ({ ...s, at: shift(s.at) })),
  }));
  // The phase before the start lights ends where they begin; from the start lights on, the whole spans move.
  const before = log.sessionPhases[phaseFrom - 1];
  if (before) log.sessionPhases[phaseFrom - 1] = { ...before, end: shift(before.end) };
  each(log.sessionPhases, phaseFrom, (span) => shiftSpan(span, shift));
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
  const { log, open } = state;
  const book = open.phaseBook;
  const wall = frame.receivedAtMs;
  if (state.session.networkGame) {
    const paused = frame.session?.gamePaused;
    if (paused === 1 && !book.onlinePause) {
      book.onlinePause = { start: frame.sessionTime, wallMs: wall };
    } else if (paused === 0 && book.onlinePause) {
      const { start, wallMs } = book.onlinePause;
      log.pauses.push({ start, wallMs: Math.max(0, Math.round(wall - wallMs)), kind: 'online' });
      book.onlinePause = undefined;
    }
  } else if (book.lastWallMs !== undefined) {
    const gap = wall - book.lastWallMs;
    if (gap - Math.max(0, frame.sessionTime - state.sessionTime) > PAUSE_AFTER_WALL_MS) {
      log.pauses.push({ start: state.sessionTime, wallMs: Math.round(gap), kind: 'offline' });
    }
  }
  book.lastWallMs = wall;
};
