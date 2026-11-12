// Which car slots a person's confirmed links name (C62c, SP4.3a spec 4): a `nameAndNumber` link every slot with that
// name and race number (never a slot without a name), a `slot` link its one session's slot. Only the frames of the
// slot's `human` car-driver spans count (C17): the spans are the machine's, read from the stored projection (C34).
import { carDriverSpans, type CarId, type DriverLink, type DriverPerson, type FrameNumber, type SessionRef } from '@pitwall/domain';
import type { DriverSessionRow } from '../storage/weekend-repository.ts';
import { sameSession } from './persons.ts';

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

/** Whether `link` names `slot`. */
export const linkMatches = (link: DriverLink, slot: SlotOf): boolean =>
  link.kind === 'nameAndNumber'
    ? slot.name !== null && slot.name === link.name && slot.raceNumber === link.raceNumber
    : sameSession(link.session, slot.session) && link.carId === slot.carId;

/** The person a confirmed link gives the slot: the first of `persons` (in id order) with a link naming it. */
export const personOf = (persons: readonly DriverPerson[], slot: SlotOf): DriverPerson | undefined =>
  persons.find((p) => p.links.some((l) => linkMatches(l, slot)));

/** The link that confirms a person for the slot: by its name and race number when it has a name, else the slot itself. */
export const linkFor = (slot: SlotOf): DriverLink =>
  slot.name !== null ? { kind: 'nameAndNumber', name: slot.name, raceNumber: slot.raceNumber } : { kind: 'slot', session: slot.session, carId: slot.carId };
