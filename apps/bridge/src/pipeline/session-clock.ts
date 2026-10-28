import type { Logger } from '../log.ts';
import { readPwrecMeta } from '../pwrec/reader.ts';

/** Turns a session's first `receivedAtMs` into the ISO time it started. */
export type SessionClock = (receivedAtMs: number) => string;

/**
 * A replayed recording counts from its own `meta.startedAt` (its `receivedAtMs` are record times), so replays stay
 * deterministic; a live feed takes the wall clock. An unreadable recording falls back to the wall clock.
 */
export function sessionClock(opts: { sourcePath?: string | undefined; wallClock: () => number; log: Logger }): SessionClock {
  const wall: SessionClock = () => new Date(opts.wallClock()).toISOString();
  if (opts.sourcePath === undefined) return wall;
  try {
    const startMs = Date.parse(readPwrecMeta(opts.sourcePath).startedAt);
    if (Number.isNaN(startMs)) throw new Error('startedAt is not a date');
    return (receivedAtMs) => new Date(startMs + receivedAtMs).toISOString();
  } catch (err) {
    opts.log.warn({ sourcePath: opts.sourcePath, err }, 'recording start unknown, sessions are dated by the wall clock');
    return wall;
  }
}
