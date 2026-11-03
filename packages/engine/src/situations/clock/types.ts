// The clock's open state and its span (contract C7, C20, C36): plain data, so snapshots carry it. Imports only domain,
// so the engine state can hold it. Its span declaration (scope, kinds) and the paused detail live in domain (C15).
import { clockSpans, type Ms, type OpenSpan, type PausedDetail, type SessionTime, type Span } from '@pitwall/domain';

/** The clock's id, its spans' `machine` (`spans:clock`, `situation.byMachine.clock`): its declaration's (C15). */
export const CLOCK_MACHINE = clockSpans.machine;
/** A pause in progress (`view.situation.byMachine.clock`); its `wallMs` is the wall time so far. */
export type OpenPausedSpan = OpenSpan<'paused', PausedDetail>;
/** A pause that ended: the pause's span in `spans:clock` (C7), with the frame numbers it opened and closed on (C26). */
export type PausedSpan = Span<'paused', PausedDetail>;

/** The clock's open state (`open.clock`): read only by the clock, `clockInput` and `onRaceClock`. */
export type ClockOpen = {
  /**
   * How far the race clock runs ahead of the game's session time: the sum of every fall that was no flashback (C36).
   * Every frame is timed at its session time plus this, so the race clock never falls but at a flashback.
   */
  offsetMs: Ms;
  /** The receive time of the previous frame (wall clock, ms), for pauses and the simulated end; unset before the session's first frame. */
  lastWallMs?: number | undefined;
  /**
   * Set by a rewind whose frame still carried the pre-rewind session time (inventory 1.10): the game's session time the
   * frames right after the rewind carry while they still belong to its target moment.
   */
  staleRawMs?: SessionTime | undefined;
  /** An online pause (`gamePaused`) in progress: its span and the receive time it opened at. */
  pause?: { span: OpenPausedSpan; sinceWallMs: number } | undefined;
  /** The paused spans opened so far: the next one's id (C26). */
  opened: number;
  /** The clock read the simulated end of the session: a later simulation-sized jump is a `jump`, no second `simulatedEnd`. */
  ended: boolean;
};
