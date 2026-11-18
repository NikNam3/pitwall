// The C62 preselection rule (SP4.3e spec §4.2, Task 7a-1): per kind (practice, qualifying) the newer of the own
// weekend's earlier sessions of that kind of the seat (candidate A, its newest start time) and the team's last confirmed
// choice of that kind on the track (candidate B, its time); a tie goes to the own weekend; neither: none. A practice or a
// qualifying session builds on practice only. Pure: the caller passes the own weekend's earlier sessions of the seat.
import { NO_BASIS, type SessionBasis, type SessionRef } from '@pitwall/domain';
import type { StoredSessionRow } from '../storage/db.ts';
import type { LastChoice } from './last-choice-types.ts';

export type PreselectRule = 'ownWeekend' | 'lastChoice' | 'none';

export type Preselection = { basis: SessionBasis; rule: Record<'practice' | 'qualifying', PreselectRule> };

export type PreselectInput = {
  own: StoredSessionRow[];
  last: LastChoice | undefined;
  kind: 'qualifying' | 'race' | 'sprint' | 'practice';
};

const refOf = (row: StoredSessionRow): SessionRef => ({ sessionUid: row.sessionUid, weekendId: row.weekendId });

const timeOf = (iso: string): number => Date.parse(iso);

/** The own rows of a kind, oldest first. */
const ownOfKind = (own: StoredSessionRow[], kind: 'practice' | 'qualifying'): StoredSessionRow[] =>
  own.filter((row) => row.kind === kind).sort((a, b) => timeOf(a.startedAt) - timeOf(b.startedAt));

/** Which candidate wins: the own weekend's newest start time `tA` against the last choice's time `tB`. */
function winner(ownNewest: string | undefined, lastAt: string | undefined): PreselectRule {
  if (ownNewest === undefined) return lastAt === undefined ? 'none' : 'lastChoice';
  if (lastAt === undefined) return 'ownWeekend';
  return timeOf(ownNewest) >= timeOf(lastAt) ? 'ownWeekend' : 'lastChoice';
}

export function preselect(o: PreselectInput): Preselection {
  const practiceRows = ownOfKind(o.own, 'practice');
  const practiceRule = winner(practiceRows.at(-1)?.startedAt, o.last?.basis.practice.at);
  const practice =
    practiceRule === 'ownWeekend' ? practiceRows.map(refOf) : practiceRule === 'lastChoice' ? [...(o.last?.basis.practice.refs ?? [])] : NO_BASIS.practice;

  if (o.kind === 'practice' || o.kind === 'qualifying') {
    return { basis: { practice, qualifying: null }, rule: { practice: practiceRule, qualifying: 'none' } };
  }

  const qualifyingRows = ownOfKind(o.own, 'qualifying');
  const newestQualifying = qualifyingRows.at(-1);
  const qualifyingRule = winner(newestQualifying?.startedAt, o.last?.basis.qualifying.at);
  const qualifying =
    qualifyingRule === 'ownWeekend' && newestQualifying !== undefined
      ? refOf(newestQualifying)
      : qualifyingRule === 'lastChoice'
        ? (o.last?.basis.qualifying.ref ?? null)
        : NO_BASIS.qualifying;

  return { basis: { practice, qualifying }, rule: { practice: practiceRule, qualifying: qualifyingRule } };
}
