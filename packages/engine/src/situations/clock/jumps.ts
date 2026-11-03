// The jumps of the session time (spec docs/history/specs/2026-10-30-situations-design.md 3.3, contract C36): session
// time is not a timeline. It resets, holds, runs ahead of wall time in the garage and jumps into the post-session
// simulation. A flashback is the runner's (C27), never read here.
import type { Ms, SessionTime } from '@pitwall/domain';

/**
 * A forward jump of more than this from one frame to the next is the game simulating the rest of an online session
 * (inventory 1.7: from 24 s to 6361 s, from 1207 s to 5837 s) when it also outruns wall time (`SIMULATION_RATE`), and
 * is a `jump` fact otherwise; spec 3.1, 3.3, user ruling 2026-10-30.
 */
export const SIMULATION_JUMP_MS = 60_000;
/**
 * The simulation jump also outruns wall time by more than this factor: the recorded ones are thousands of seconds
 * within one frame interval, while garage acceleration peaks at about 31.6 times wall time (inventory 1.9: SgQ frames
 * 720 to 750, 15.777 s of session time in 0.5 s of wall time). The factor leaves a headroom of about 1.9 over that
 * peak, so a stall of a few seconds in the garage is no simulation; review 2 B3, review 3 E7, ruling 2026-10-30.
 */
export const SIMULATION_RATE = 60;

/** What the session time did from one frame to the next. */
export type Jump =
  | { kind: 'none' }
  /** The online simulation of the rest of the session. */
  | { kind: 'simulated' }
  /** Any other forward jump by more than `SIMULATION_JUMP_MS` (a stall in the garage). */
  | { kind: 'forward' }
  /** A fall that is no flashback: the race clock continues over it by its size, `offsetMs` (C36). */
  | { kind: 'fall'; offsetMs: Ms };

const NONE: Jump = { kind: 'none' };

/**
 * The jump from the previous frame's race-clock time `fromMs` to `toMs` (the frame's session time on the race clock as
 * it stood), `wallMs` of wall time after it. Garage acceleration (the clock ahead of wall time) is none. Every fall is
 * one, the start settling, the formation reset and a fall before the start included (C36).
 */
export const jumpOf = (fromMs: SessionTime, toMs: SessionTime, wallMs: number): Jump => {
  const advanceMs = toMs - fromMs;
  if (advanceMs > SIMULATION_JUMP_MS) return advanceMs > SIMULATION_RATE * wallMs ? { kind: 'simulated' } : { kind: 'forward' };
  return toMs >= fromMs ? NONE : { kind: 'fall', offsetMs: fromMs - toMs };
};
