// Driver profiles (contract C62c, SP4.3a spec 4): the persons the user links to car slots, their profiles, the run's
// profile snapshot and the `drivers.*` topics' values. JSON-safe.
import type { CarId, SessionUid, TeamId } from './ids.ts';
import type { Known } from './known.ts';

/** A person's id: kebab-case, the name of its file `PITWALL_DATA_DIR/drivers/<person>.json`. */
export type PersonId = string;

/** A stored session (C60): session uid, weekend id and the feed's player car. */
export type SessionRef = { sessionUid: SessionUid; weekendId: string; feedCar: CarId };

/** A link of a person to a seat (C62c): every session's car slot with this team and race number (from Participants). */
export type DriverLink = { team: TeamId; raceNumber: number };

/** A person as its file holds it: display name, confirmed links, excluded sessions, overrides per entry key. */
export type DriverPerson = { id: PersonId; displayName: string; links: DriverLink[]; excluded: SessionRef[]; overrides: Record<string, number> };

/** One entry of a profile: its value, the laps and sessions it rests on, and the date of its newest session (ISO date). */
export type ProfileEntry = { value: Known<number>; laps: number; sessions: number; newestSession: string };

/** A person's profile: their entries by key (as the units declare them, `defineProfiles`). */
export type DriverProfile = { person: PersonId; displayName: string; entries: Record<string, ProfileEntry> };

/**
 * The run's profiles (C62c): which person each slot is linked to, and their profiles; the profiles sidecar's content.
 * `fingerprint` names the snapshot (its profiles and links); `bySlot` is indexed by car slot, `null` for an unlinked one.
 */
export type ProfileSnapshot = { fingerprint: string; bySlot: (PersonId | null)[]; profiles: Record<PersonId, DriverProfile> };

/**
 * A slot of a stored session with a `human` car-driver span and no confirmed link, as `pitwall drivers` lists it: when
 * and where, its car, its seat (team and race number) and the name the game gave (`null` when hidden online).
 */
export type UnlinkedSlot = {
  session: SessionRef;
  /** ISO date of the session. */
  date: string;
  trackId: number;
  carId: CarId;
  teamId: number;
  raceNumber: number;
  name: string | null;
};

/** `drivers.profiles`: every person with their profile, links and exclusions. */
export type DriversProfilesValue = { persons: (DriverProfile & { links: DriverLink[]; excluded: SessionRef[] })[] };

/**
 * `drivers.links`: the seat links, and the human slots of the stored sessions whose seat has no link. The bridge always
 * sends `links`; it is optional so a value of the unlinked slots alone (a fake store) stays one.
 */
export type DriversLinksValue = { links?: { team: TeamId; raceNumber: number; person: PersonId }[]; unlinked: UnlinkedSlot[] };
