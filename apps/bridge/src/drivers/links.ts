// Which car slots a person's seat links name (C62c, SP4.3b spec 10): a link names a seat, a team and a race number
// (from Participants), and with it every session's slot that carries both, whatever its name. Only the frames of the
// slot's `human` car-driver spans count (C17): the spans are the machine's, read from the stored projection (C34).
import { carDriverSpans, type CarId, type DriverLink, type DriverPerson, type DriversLinksValue, type FrameNumber, type SessionRef, type UnlinkedSlot } from '@pitwall/domain';
import type { DriverSessionRow } from '../storage/weekend-repository.ts';

/** A car slot of a session as the links see it: the session, the car, its team, race number and name (`null`: hidden). */
export type SlotOf = { session: SessionRef; carId: CarId; teamId: number; raceNumber: number; name: string | null };

/** A slot of a stored session with the frames its `human` car-driver spans cover (none while the session is stale). */
export type StoredSlot = SlotOf & { row: DriverSessionRow; humanSpans: { startFrame: FrameNumber; endFrame?: FrameNumber }[] };

/** A stored session as a driver-profile action names it (C60's key). */
export const refOf = (row: Pick<DriverSessionRow, 'sessionUid' | 'weekendId' | 'playerCar'>): SessionRef => ({
  sessionUid: row.sessionUid, weekendId: row.weekendId, feedCar: row.playerCar,
});

/** Every slot of the stored session, with its human spans from the projection. */
export function storedSlots(row: DriverSessionRow): StoredSlot[] {
  const spans = row.stale ? [] : (row.projection.spans[carDriverSpans.machine] ?? []);
  const session = refOf(row);
  return row.cars.map((car) => ({
    row, session, carId: car.carId, teamId: car.carKey.teamId, raceNumber: car.carKey.raceNumber,
    name: car.driver.known ? car.driver.value : null,
    humanSpans: spans
      .filter((s) => s.carId === car.carId && s.kind === 'human')
      .map((s) => ({ startFrame: s.startFrame, endFrame: s.endFrame })),
  }));
}

/** Whether two links name the same seat. */
export const sameSeat = (a: DriverLink, b: DriverLink): boolean => a.team === b.team && a.raceNumber === b.raceNumber;

/** Whether `link` names `slot`'s seat. */
export const linkMatches = (link: DriverLink, slot: Pick<SlotOf, 'teamId' | 'raceNumber'>): boolean =>
  link.team === slot.teamId && link.raceNumber === slot.raceNumber;

/** The person a link gives the slot: the first of `persons` (in id order) with a link on its seat. */
export const personOf = (persons: readonly DriverPerson[], slot: Pick<SlotOf, 'teamId' | 'raceNumber'>): DriverPerson | undefined =>
  persons.find((p) => p.links.some((l) => linkMatches(l, slot)));

/** Every seat link of `persons`, in person id order. */
export const seatLinks = (persons: readonly DriverPerson[]): NonNullable<DriversLinksValue['links']> =>
  persons.flatMap((p) => p.links.map((l) => ({ team: l.team, raceNumber: l.raceNumber, person: p.id })));

const newestFirst = (a: StoredSlot, b: StoredSlot): number =>
  a.row.startedAt < b.row.startedAt ? 1 : a.row.startedAt > b.row.startedAt ? -1 : a.session.sessionUid < b.session.sessionUid ? 1 : a.session.sessionUid > b.session.sessionUid ? -1 : a.carId - b.carId;

/** The slots of `slots` (every stored session's) with a `human` span whose seat no person links, newest session first. */
export function unlinkedSlots(slots: readonly StoredSlot[], persons: readonly DriverPerson[]): UnlinkedSlot[] {
  return slots
    .toSorted(newestFirst)
    .filter((slot) => slot.humanSpans.length > 0 && personOf(persons, slot) === undefined)
    .map((slot): UnlinkedSlot => ({
      session: slot.session, date: slot.row.startedAt, trackId: slot.row.trackId, carId: slot.carId, teamId: slot.teamId,
      raceNumber: slot.raceNumber, name: slot.name,
    }));
}
