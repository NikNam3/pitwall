// The stored sessions a planning round can pick from (C62d): `plans.sessions`, bridge user state published as a global
// core topic (C54, C55). Every stored practice and qualifying is listed once per session and team it is stored for (the
// team of each stored row's player car, C62); it is read from the rows alone, so nothing is rebuilt for it (C61).
import type { PlansSessions, StoredSessionEntry } from '@pitwall/contracts';
import type { TopicHub } from '../hub/topic-hub.ts';
import type { StoredSessionRow } from '../storage/db.ts';
import type { WeekendRepository } from '../storage/weekend-repository.ts';

/** The team of a row's player car; `undefined` when its slots do not carry the player car. */
const teamOf = (row: StoredSessionRow): number | undefined => row.cars.find((c) => c.carId === row.playerCar)?.carKey.teamId;

/** A row's team cars as an entry lists them: its player car, then its teammate when it has one. */
const carsOf = (row: StoredSessionRow): StoredSessionEntry['cars'] =>
  [row.playerCar, row.teammateCar].flatMap((carId) => {
    const slot = carId === null ? undefined : row.cars.find((c) => c.carId === carId);
    return slot === undefined ? [] : [{ carId: slot.carId, raceNumber: slot.carKey.raceNumber, name: slot.driver.known ? slot.driver.value : null }];
  });

/**
 * The entries of `rows` (C62): rows of kind `practice` or `qualifying` grouped by session ref and the team of their
 * player car. An entry's `startedAt` is its group's earliest, its `cars` its group's first row's in start order, and it is
 * `stale` when any of its rows is of another rules version than `rulesVersion` (C61). Newest first, then by session uid.
 */
export function sessionEntriesOf(rows: readonly StoredSessionRow[], rulesVersion: string): StoredSessionEntry[] {
  const groups = new Map<string, { team: number; kind: StoredSessionEntry['kind']; first: StoredSessionRow; stale: boolean }>();
  for (const row of rows) {
    const { kind } = row;
    if (kind !== 'practice' && kind !== 'qualifying') continue;
    const team = teamOf(row);
    if (team === undefined) continue;
    const key = JSON.stringify([row.sessionUid, row.weekendId, team]);
    const stale = row.rulesVersion !== rulesVersion;
    const group = groups.get(key);
    if (group === undefined) groups.set(key, { team, kind, first: row, stale });
    else groups.set(key, { ...group, first: Date.parse(row.startedAt) < Date.parse(group.first.startedAt) ? row : group.first, stale: group.stale || stale });
  }
  const entries = [...groups.values()].map(({ team, kind, first, stale }): StoredSessionEntry => ({
    ref: { sessionUid: first.sessionUid, weekendId: first.weekendId },
    kind,
    trackId: first.trackId,
    startedAt: first.startedAt,
    team,
    cars: carsOf(first),
    stale,
  }));
  return entries.sort(
    (a, b) =>
      Date.parse(b.startedAt) - Date.parse(a.startedAt)
      || compareText(a.ref.sessionUid, b.ref.sessionUid)
      || compareText(a.ref.weekendId, b.ref.weekendId)
      || a.team - b.team,
  );
}

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Publishes the repository's stored sessions as `plans.sessions`, a global state topic (C54, C55). */
export function publishStoredSessions(o: { hub: TopicHub; repo: Pick<WeekendRepository, 'storedSessions'>; rulesVersion: string }): void {
  const value: PlansSessions = { sessions: sessionEntriesOf(o.repo.storedSessions(), o.rulesVersion) };
  o.hub.publishGlobal('plans.sessions', () => value);
}
