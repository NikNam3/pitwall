// The basis and plan picker's options (SP4.3e spec §4.2): the stored sessions of `basis.active.sessions` per kind,
// newest first, and the team's saved plans, newest first. Between sessions (SP4.3f spec §4.4) the options of a planning
// round: the tracks, their qualifying per team and that team's practice, from `plans.sessions`. Selection and ordering
// only: the bridge decides which sessions are stored, stale or the team's last choice (C43); the picker shows them (C65).
import type { BasisActive, PlansSessions, SavedPlanEntry, StoredSessionEntry } from '@pitwall/contracts';
import type { SessionBasis, SessionRef, TrackId } from '@pitwall/domain';

/** A session's key in `basis.active.sessions`: `<sessionUid>@<weekendId>`. */
export const sessionKey = (ref: SessionRef): string => `${ref.sessionUid}@${ref.weekendId}`;

/** The session a key names (the weekend id follows the last `@`). */
export const refOf = (key: string): SessionRef => {
  const at = key.lastIndexOf('@');
  return { sessionUid: key.slice(0, at), weekendId: key.slice(at + 1) };
};

export type BasisKind = 'practice' | 'qualifying';

/** One stored session the picker offers. */
export type SessionOption = { key: string; date: string; stale: boolean; lastChoice: boolean };

/** One saved plan the picker offers. */
export type PlanOption = { id: string; name: string; lastChoice: boolean };

const byNewest = <T>(dateOf: (x: T) => string, keyOf: (x: T) => string) => (a: T, b: T): number =>
  dateOf(a) < dateOf(b) ? 1 : dateOf(a) > dateOf(b) ? -1 : keyOf(a) < keyOf(b) ? -1 : keyOf(a) > keyOf(b) ? 1 : 0;

/** The keys a basis names for one kind. */
export const keysOf = (basis: SessionBasis, kind: BasisKind): string[] =>
  kind === 'practice' ? basis.practice.map(sessionKey) : basis.qualifying === null ? [] : [sessionKey(basis.qualifying)];

/** The stored sessions of one kind, newest first, marked stale and last choice as the topic says. */
export function sessionOptions(active: BasisActive, kind: BasisKind): SessionOption[] {
  const last = new Set(active.lastChoice === null ? [] : keysOf(active.lastChoice.basis, kind));
  return Object.entries(active.sessions)
    .flatMap(([key, s]) => (s.kind === kind ? [{ key, date: s.date, stale: s.stale === true, lastChoice: last.has(key) }] : []))
    .sort(byNewest((o) => o.date, (o) => o.key));
}

/** The team's saved plans, newest first, the last choice's marked. */
export function planOptions(saved: readonly SavedPlanEntry[], active: BasisActive | undefined): PlanOption[] {
  const last = active?.lastChoice?.plan ?? null;
  return [...saved].sort(byNewest((p) => p.savedAt, (p) => p.id)).map((p) => ({ id: p.id, name: p.name, lastChoice: p.id === last }));
}

/** The picker's window-local draft (C73): per part, `undefined` follows the basis in use. */
export type BasisDraft = { practice?: readonly string[]; qualifying?: string | null; plan?: string | null };

/** What the draft chooses now: its own choice per part, else the basis in use and its plan. */
export function chosen(draft: BasisDraft, active: BasisActive): { practice: readonly string[]; qualifying: string | null; plan: string | null } {
  return {
    practice: draft.practice ?? keysOf(active.basis, 'practice'),
    qualifying: draft.qualifying !== undefined ? draft.qualifying : (keysOf(active.basis, 'qualifying')[0] ?? null),
    plan: draft.plan !== undefined ? draft.plan : (active.plan?.id ?? null),
  };
}

// ---------------------------------------------------------------- between sessions (SP4.3f spec §4.4)

/** A qualifying option's key: one stored session as stored for one team, `<sessionKey>#<team>`. */
export const qualifyingKey = (entry: StoredSessionEntry): string => `${sessionKey(entry.ref)}#${entry.team}`;

/** One track with a stored qualifying, and the start of its newest. */
export type TrackOption = { trackId: TrackId; newest: string };

const newestEntries = (entries: readonly StoredSessionEntry[]): StoredSessionEntry[] =>
  [...entries].sort(byNewest((e) => e.startedAt, qualifyingKey));

/** The tracks with a stored qualifying, newest first. */
export function trackOptions(s: PlansSessions): TrackOption[] {
  const newest = new Map<TrackId, string>();
  for (const e of s.sessions) {
    const seen = newest.get(e.trackId);
    if (e.kind === 'qualifying' && (seen === undefined || e.startedAt > seen)) newest.set(e.trackId, e.startedAt);
  }
  return [...newest].map(([trackId, at]) => ({ trackId, newest: at })).sort(byNewest((t) => t.newest, (t) => String(t.trackId)));
}

/** A track's stored qualifying, one entry per team it is stored for, newest first. */
export function qualifyingOptions(s: PlansSessions, trackId: TrackId): StoredSessionEntry[] {
  return newestEntries(s.sessions.filter((e) => e.kind === 'qualifying' && e.trackId === trackId));
}

/** The practice of a qualifying's track as stored for its team, newest first: never another team's (C62d). */
export function practiceOptions(s: PlansSessions, q: StoredSessionEntry): StoredSessionEntry[] {
  return newestEntries(s.sessions.filter((e) => e.kind === 'practice' && e.trackId === q.trackId && e.team === q.team));
}

/** The picker's window-local draft between sessions (C73): per part, `undefined` follows the preselection. */
export type PlanningDraft = { trackId?: TrackId; qualifying?: string; practice?: readonly string[] };

/** What a planning round would open with. */
export type PlanningChoice = { trackId: TrackId; qualifying: StoredSessionEntry; practice: StoredSessionEntry[] };

/**
 * The draft's own choice per part, else the preselection: the newest track, its newest qualifying, every practice of
 * that team on the qualifying's weekend (else none). A part the draft names that the chosen track or qualifying does
 * not offer is the preselection's, and so is the practice of a qualifying that changed. Nothing stored: `undefined`.
 */
export function planningChoice(d: PlanningDraft, s: PlansSessions): PlanningChoice | undefined {
  const tracks = trackOptions(s);
  const trackId = tracks.find((t) => t.trackId === d.trackId)?.trackId ?? tracks[0]?.trackId;
  if (trackId === undefined) return undefined;
  const quals = qualifyingOptions(s, trackId);
  const drafted = quals.find((q) => qualifyingKey(q) === d.qualifying);
  const qualifying = drafted ?? quals[0];
  if (qualifying === undefined) return undefined;
  const options = practiceOptions(s, qualifying);
  const keys = new Set(d.practice ?? []);
  const own = d.practice !== undefined && (d.qualifying === undefined || drafted !== undefined) && options.filter((p) => keys.has(sessionKey(p.ref))).length === keys.size;
  const practice = own ? options.filter((p) => keys.has(sessionKey(p.ref))) : options.filter((p) => p.ref.weekendId === qualifying.ref.weekendId);
  return { trackId, qualifying, practice };
}
