// The clock's spans (spec 3.1, contract C7, C20, C26, C37, C85): they tile the session. The session's first frame opens
// `running` (or `paused` when it is already an online pause); a pause closes `running` and opens `paused`, its end
// closes `paused` and opens `running`. Offline: no frame for over `PAUSE_AFTER_WALL_MS` of wall time beyond what the
// session time advanced is a paused span opened and closed on the frame after the gap (it covers no frame), between the
// `running` span that closes there and the one that opens there. Online: the Session packet's `gamePaused`, a span open
// while it lasts. Garage acceleration is none.
import type { FrameNumber, PausedDetail, SessionTime } from '@pitwall/domain';
import { CLOCK_MACHINE, type ClockOpen, type ClockSpan, type OpenClock, type OpenClockSpan, type PausedSpan } from './types.ts';

/**
 * Offline, no frame for longer than this (wall time) beyond what the session time advanced is a pause (inventory 1.8:
 * 9 to 162 s seen); spec 3.1, user ruling 2026-10-30.
 */
export const PAUSE_AFTER_WALL_MS = 2000;

/**
 * What the pause rule reads of a frame: its receive time, its time and the previous frame's on the race clock,
 * `gamePaused`, and its frame number (a clock span opens and closes on it, C26).
 */
export type PauseInput = {
  frameNumber: FrameNumber;
  networkGame: boolean;
  gamePaused: number | undefined;
  wallMs: number;
  fromMs: SessionTime;
  atMs: SessionTime;
};

/** The next clock span's common fields; the session's first (id 0, opened on its first frame) is joined (`joinedAt`). */
const nextSpan = (open: ClockOpen, start: SessionTime, startFrame: FrameNumber) => {
  const id = open.opened++;
  return { machine: CLOCK_MACHINE, id, start, confirmed: true, ...(id === 0 && { joinedAt: true as const }), startFrame };
};

const running = (open: ClockOpen, start: SessionTime, input: PauseInput): OpenClock => ({
  span: { ...nextSpan(open, start, input.frameNumber), kind: 'running', detail: undefined },
  sinceWallMs: input.wallMs,
});

const paused = (open: ClockOpen, start: SessionTime, input: PauseInput, source: PausedDetail['source']): OpenClock => ({
  span: { ...nextSpan(open, start, input.frameNumber), kind: 'paused', detail: { source, wallMs: 0 } },
  sinceWallMs: input.wallMs,
});

/** The open span as readers see it: a pause with its wall time up to `wallMs`; `running` as it opened. */
export const clockSpanSoFar = (current: OpenClock, wallMs: number): OpenClockSpan =>
  current.span.kind === 'running'
    ? current.span
    : { ...current.span, detail: { ...current.span.detail, wallMs: Math.max(0, Math.round(wallMs - current.sinceWallMs)) } };

const closeAt = (current: OpenClock, end: SessionTime, input: PauseInput): ClockSpan =>
  ({ ...clockSpanSoFar(current, input.wallMs), end, endFrame: input.frameNumber }) as ClockSpan;

/**
 * Reads the clock's spans of one frame into `open`; returns the spans it closed, in order. Online, `gamePaused` 1 closes
 * `running` and `gamePaused` 0 closes `paused`, each at the frame's time, and the other kind opens there. Offline, a gap
 * closes `running` where the frame before it was timed; the pause spans the gap on the frame after it, and `running`
 * opens at that frame's time.
 */
export const trackPause = (open: ClockOpen, input: PauseInput): ClockSpan[] => {
  const { networkGame, gamePaused, wallMs, fromMs, atMs } = input;
  const current = open.current;
  if (current === undefined) {
    open.current = networkGame && gamePaused === 1 ? paused(open, atMs, input, 'online') : running(open, atMs, input);
    return [];
  }
  if (networkGame) {
    const isRunning = current.span.kind === 'running';
    if (gamePaused !== (isRunning ? 1 : 0)) return [];
    const closed = closeAt(current, atMs, input);
    open.current = isRunning ? paused(open, atMs, input, 'online') : running(open, atMs, input);
    return [closed];
  }
  if (open.lastWallMs === undefined) return [];
  const gap = wallMs - open.lastWallMs;
  if (gap - Math.max(0, atMs - fromMs) <= PAUSE_AFTER_WALL_MS) return [];
  const before = closeAt(current, fromMs, input);
  const pause = paused(open, fromMs, input, 'offline').span as PausedSpan;
  const closedPause: PausedSpan = { ...pause, end: atMs, endFrame: input.frameNumber, detail: { source: 'offline', wallMs: Math.round(gap) } };
  open.current = running(open, atMs, input);
  return [before, closedPause];
};
