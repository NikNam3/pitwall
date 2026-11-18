// The feed's basis and plan (C54, C62, C62d, SP4.3e spec §4.2): the basis in use (from the projection's newest
// `basisChosen` decision, else the session-start basis) and its session-start value, per named session its date, kind and
// track, the chosen plan (with the race laps it was computed for) beside the race's laps, the rebuild progress of a
// chosen basis, and the team's last confirmed choice on the track. Published by the feed's pipeline (C55).
import type { SessionBasis, TrackId } from '@pitwall/domain';
import { defineTopic, type NoParams } from '../topic-def.ts';

/**
 * `sessions` is keyed by `basisKey`'s per-session part (`<sessionUid>@<weekendId>`): every stored session of the feed's
 * seat on the track (the picker's candidates), the named ones included; `date` is an ISO date; `stale`: stored under
 * another rules version, rebuilt when chosen (C61).
 * `plan.laps` is the race laps the plan was computed on (`computedOn.race.laps`), shown beside `raceLaps`, not judged.
 * `rebuilding` is `null` while every named session is current.
 */
export type BasisActive = {
  basis: SessionBasis;
  start: SessionBasis;
  sessions: Record<string, { date: string; kind: 'practice' | 'qualifying'; trackId: TrackId; stale: boolean }>;
  plan: { id: string; name: string; laps: number } | null;
  raceLaps: number | null;
  rebuilding: { done: number; total: number } | null;
  lastChoice: { basis: SessionBasis; plan: string | null } | null;
};

export default defineTopic<NoParams, BasisActive>({ owner: 'core', scope: 'feed', mode: 'state', maxHz: Infinity });
