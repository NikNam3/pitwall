// The clock's open state and its span (contract C7, C20, C36): plain data, so snapshots carry it. Imports only domain,
// so the engine state can hold it.
import type { ClockFact, Ms, OpenSpan, SessionTime, Span } from '@pitwall/domain';

/** The detail of the clock's one span kind, `paused`: what paused the session and how long it lasted in wall time. */
export type PausedDetail = { source: 'offline' | 'online'; wallMs: number };
/** A pause in progress (`view.situation.byMachine.clock`); its `wallMs` is the wall time so far. */
export type OpenPausedSpan = OpenSpan<'paused', PausedDetail>;
/** A pause that ended: the pause's clock fact in `spans:clock` (C7), before step 2 stamps it. */
export type PausedSpan = Omit<Span<'paused', PausedDetail>, 'in'>;
/** A clock fact of the `clock` list as the clock returns it, before step 2 stamps it. */
export type ClockFactBody = WithoutStamp<ClockFact>;
type WithoutStamp<F> = F extends unknown ? Omit<F, 'in'> : never;

/** The clock's open state (`open.clock`): read only by the clock, `clockInput` and `onRaceClock`. */
export type ClockOpen = {
  /**
   * How far the race clock runs ahead of the game's session time: the sum of every fall that was no flashback (C36).
   * Every frame is stamped at its session time plus this, so the race clock never falls but at a flashback.
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
  /** The clock read the simulated end of the session: it reads no jump after it. */
  ended: boolean;
};
