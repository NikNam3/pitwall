// The unlinked slots and their suggestions (C62c, SP4.3a spec 4): every slot of a stored session with a `human`
// car-driver span that no confirmed link names, newest session first, then by car id. A suggestion is a hint, never
// applied without `link` or `accept`: the person with a confirmed link on the slot's race number, else the person whose
// newest linked slot drove for the slot's team (league memory: one team, one driver).
import type { DriverPerson, UnlinkedSlot } from '@pitwall/domain';
import { linkMatches, personOf, type StoredSlot } from './links.ts';

const newestFirst = (a: StoredSlot, b: StoredSlot): number =>
  a.row.startedAt < b.row.startedAt ? 1 : a.row.startedAt > b.row.startedAt ? -1 : a.session.sessionUid < b.session.sessionUid ? 1 : a.session.sessionUid > b.session.sessionUid ? -1 : a.carId - b.carId;

/** The race numbers a person's links stand on: a name-and-number link's own, a slot link's slot's. */
function raceNumbersOf(person: DriverPerson, linked: readonly StoredSlot[]): Set<number> {
  const numbers = new Set<number>();
  for (const link of person.links) if (link.kind === 'nameAndNumber') numbers.add(link.raceNumber);
  for (const slot of linked) numbers.add(slot.raceNumber);
  return numbers;
}

/** The unlinked human slots of `slots` (every stored session's), with their suggestions from `persons` (in id order). */
export function unlinkedSlots(slots: readonly StoredSlot[], persons: readonly DriverPerson[]): UnlinkedSlot[] {
  const ordered = slots.toSorted(newestFirst);
  const linkedOf = new Map(persons.map((p) => [p.id, ordered.filter((s) => p.links.some((l) => linkMatches(l, s)))]));
  const numbers = new Map(persons.map((p) => [p.id, raceNumbersOf(p, linkedOf.get(p.id) ?? [])]));
  // The team of each person's newest linked slot.
  const teams = new Map(persons.flatMap((p) => {
    const newest = linkedOf.get(p.id)?.[0];
    return newest === undefined ? [] : [[p.id, newest.teamId] as const];
  }));
  return ordered
    .filter((slot) => slot.humanSpans.length > 0 && personOf(persons, slot) === undefined)
    .map((slot): UnlinkedSlot => {
      const byNumber = persons.find((p) => numbers.get(p.id)?.has(slot.raceNumber) === true);
      const byTeam = byNumber === undefined ? persons.find((p) => teams.get(p.id) === slot.teamId) : undefined;
      const suggestion = byNumber !== undefined
        ? { person: byNumber.id, by: 'raceNumber' as const }
        : byTeam !== undefined ? { person: byTeam.id, by: 'team' as const } : undefined;
      return {
        session: slot.session, date: slot.row.startedAt, trackId: slot.row.trackId, carId: slot.carId, teamId: slot.teamId,
        raceNumber: slot.raceNumber, name: slot.name, ...(suggestion && { suggestion }),
      };
    });
}
