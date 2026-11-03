// Pauses (spec 3.1, contract C7, C20, C37): the clock's one span kind, `paused`. Offline: no frame for over
// `PAUSE_AFTER_WALL_MS` of wall time beyond what the session time advanced, a span opened and closed on the frame after
// the gap. Online: the Session packet's `gamePaused`, a span open while it lasts. Garage acceleration is none.
import type { SessionTime } from '@pitwall/domain';
import type { ClockOpen, OpenPausedSpan, PausedSpan } from './types.ts';

/**
 * Offline, no frame for longer than this (wall time) beyond what the session time advanced is a pause (inventory 1.8:
 * 9 to 162 s seen); spec 3.1, user ruling 2026-10-30.
 */
export const PAUSE_AFTER_WALL_MS = 2000;

/** What the pause rule reads of a frame: its receive time, its time and the previous frame's on the race clock, `gamePaused`. */
export type PauseInput = {
  networkGame: boolean;
  gamePaused: number | undefined;
  wallMs: number;
  fromMs: SessionTime;
  atMs: SessionTime;
};

const opened = (open: ClockOpen, start: SessionTime, source: 'offline' | 'online'): OpenPausedSpan => ({
  machine: 'clock',
  id: open.opened++,
  kind: 'paused',
  start,
  confirmed: true,
  detail: { source, wallMs: 0 },
});

/** The open pause with its wall time up to `wallMs`. */
export const pauseSoFar = (pause: NonNullable<ClockOpen['pause']>, wallMs: number): OpenPausedSpan => ({
  ...pause.span,
  detail: { ...pause.span.detail, wallMs: Math.max(0, Math.round(wallMs - pause.sinceWallMs)) },
});

/** Reads the pause of one frame into `open`; returns the paused span it closed, if any. */
export const trackPause = (open: ClockOpen, input: PauseInput): PausedSpan | undefined => {
  const { networkGame, gamePaused, wallMs, fromMs, atMs } = input;
  if (networkGame) {
    if (gamePaused === 1 && !open.pause) {
      open.pause = { span: opened(open, atMs, 'online'), sinceWallMs: wallMs };
    } else if (gamePaused === 0 && open.pause) {
      const span = pauseSoFar(open.pause, wallMs);
      open.pause = undefined;
      return { ...span, end: atMs };
    }
    return undefined;
  }
  if (open.lastWallMs === undefined) return undefined;
  const gap = wallMs - open.lastWallMs;
  if (gap - Math.max(0, atMs - fromMs) <= PAUSE_AFTER_WALL_MS) return undefined;
  const span = opened(open, fromMs, 'offline');
  return { ...span, end: atMs, detail: { source: 'offline', wallMs: Math.round(gap) } };
};
