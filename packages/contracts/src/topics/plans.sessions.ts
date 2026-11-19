// The stored practice and qualifying sessions a planning round can pick from (C62d, bridge user state, C54, C55).
import type { CarId, SessionRef, TeamId, TrackId } from '@pitwall/domain';
import { defineTopic, type NoParams } from '../topic-def.ts';

/** One stored practice or qualifying (or shootout) as stored for one team: its player car's team (C62). */
export type StoredSessionEntry = {
  ref: SessionRef;
  kind: 'practice' | 'qualifying';
  trackId: TrackId;
  /** ISO, the earliest of its rows. */
  startedAt: string;
  team: TeamId;
  /** The team's cars of the session: its player car first, then its teammate (of the first row in start order). */
  cars: { carId: CarId; raceNumber: number; name: string | null }[];
  /** Any of its rows stored under another rules version (C61): it is rebuilt when a round needs it. */
  stale: boolean;
};

/** Every stored practice and qualifying, one entry per session and team, newest first (bridge user state, C54). */
export type PlansSessions = { sessions: StoredSessionEntry[] };

export default defineTopic<NoParams, PlansSessions>({ owner: 'core', scope: 'global', mode: 'state', maxHz: Infinity });
