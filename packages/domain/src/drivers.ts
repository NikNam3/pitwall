// Driver profiles (contract C62c, SP4.3a spec 4): the persons the user links to car slots, their profiles, the run's
// profile snapshot and the `drivers.*` topics' values. JSON-safe.
import type { CarId, FeedId, SessionUid, TeamId } from './ids.ts';
import type { Known } from './known.ts';
import type { WeekendPhase } from './weekend-phase.ts';

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

/**
 * A stored session a person's linked seat drove in with a human car-driver span (C62c): when and where, its weekend
 * phase with its segment and format (from the stored session's `weekend-phase` span, C20; never the game's session type,
 * C13), the person's laps in it, and whether the user excluded it.
 */
export type LinkedSession = {
  session: SessionRef;
  /** ISO date of the session. */
  date: string;
  trackId: number;
  phase: WeekendPhase;
  laps: number;
  excluded: boolean;
};

/**
 * `drivers.profiles`: every person with their profile, links and exclusions, their overrides per entry key, their linked
 * sessions (newest first) and the sessions and laps not excluded (`kept`). An entry's value is the computed one, without
 * the person's override; the profile snapshot applies the overrides (C62c).
 */
export type DriversProfilesValue = {
  persons: (DriverProfile & {
    links: DriverLink[];
    excluded: SessionRef[];
    overrides: Record<string, number>;
    sessions: LinkedSession[];
    kept: { sessions: number; laps: number };
  })[];
};

/** A human seat of one of our feeds (its player car or teammate while a human drives it, C17) with its seat from Participants. */
export type LiveSeat = { feedId: FeedId; carId: CarId; team: TeamId; raceNumber: number };

/**
 * `drivers.links`: the seat links, the human slots of the stored sessions whose seat has no link (`unlinked`), and our
 * running feeds' human seats without a link (`unlinkedSeats`).
 */
export type DriversLinksValue = { links: { team: TeamId; raceNumber: number; person: PersonId }[]; unlinked: UnlinkedSlot[]; unlinkedSeats: LiveSeat[] };
