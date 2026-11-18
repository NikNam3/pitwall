// The basis and plan picker's options (SP4.3e spec §4.2): the stored sessions of `basis.active.sessions` per kind,
// newest first, and the team's saved plans, newest first. Selection and ordering only: the bridge decides which sessions
// are stored, stale or the team's last choice (C43); the picker shows them (C65).
import type { BasisActive, SavedPlanEntry } from '@pitwall/contracts';
import type { SessionBasis, SessionRef } from '@pitwall/domain';

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
