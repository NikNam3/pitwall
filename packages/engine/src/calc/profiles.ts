// Driver-profile declarations and `view.drivers` (contract C62c, SP4.3a spec 4): each estimation unit declares its
// profile entries with pure functions over a person's linked stored sessions; the bridge's profile store runs them
// between runs; the scheduler gives each car slot its linked profile from the run's snapshot.
import type { CarId, DriverProfile, FrameNumber, Known, ProfileSnapshot, SessionRef, TrackData, WeekendPhase } from '@pitwall/domain';
import type { Projection } from '../log/types.ts';
import type { DeepReadonly } from '../util/deep-readonly.ts';
import type { EngineView } from './types.ts';

/**
 * One linked session of a person as an aggregate reads it, from its stored projection (C34): the session, the linked
 * car slot, when it started (ISO), its weekend phase and AI difficulty, the projection, the frames the car's `human`
 * car-driver spans cover (the only frames a profile counts, C17, C62c), and the session's track file.
 */
export type StoredDriverSession = {
  session: SessionRef;
  carId: CarId;
  startedAt: string;
  phase: WeekendPhase;
  aiDifficulty: Known<number>;
  projection: Projection;
  humanSpans: { startFrame: FrameNumber; endFrame?: FrameNumber }[];
  track: Known<DeepReadonly<TrackData>>;
};

/** What a profile aggregate reads besides its sessions: the effective config (C47) and the person's overrides. */
export type ProfileCtx = { config: EngineView['config']; overrides: Readonly<Record<string, number>> };

/** One profile entry: its aggregate's version, the range an override must lie in, and its pure aggregate. */
export type ProfileEntryDecl = {
  /** Bumped when `aggregate` changes, so the store recomputes the entry (C62c). */
  version: number;
  /** The inclusive range of the entry's value; an override outside it is rejected (C73). */
  range: readonly [min: number, max: number];
  /** The entry's value over the person's sessions, with the laps it rests on. */
  aggregate(sessions: readonly StoredDriverSession[], ctx: ProfileCtx): { value: Known<number>; laps: number };
};

/** A unit's profile declaration: its entries by key. */
export type ProfilesDecl = { unit: string; entries: Record<string, ProfileEntryDecl> };

/** Declares a unit's profile entries; a feature lists it in its `profiles` (C63), as it lists its priors. */
export function defineProfiles(unit: string, decl: Omit<ProfilesDecl, 'unit'>): ProfilesDecl {
  return { unit, ...decl };
}

/**
 * `view.drivers` (C62c): per car slot (`cars` of them) its linked person's profile from `snapshot`;
 * `notApplicable` for an unlinked slot and for every slot without a snapshot.
 */
export function driversOf(_snapshot: DeepReadonly<ProfileSnapshot> | null, _cars: number): Known<DeepReadonly<DriverProfile>>[] {
  throw new Error('not implemented');
}
