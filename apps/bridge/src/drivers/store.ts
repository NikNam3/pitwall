// The profile store (C62c, SP4.3a spec 4): the bridge's owner of the persons (files under `<data dir>/drivers/`, the
// source of truth) and of the profile store (`<data dir>/profiles.sqlite`, a cache). It applies the driver-profile
// uiActions, rejecting an invalid one with a reason (C73); runs the units' declared profile entries over each person's
// linked stored sessions (C34), for the frames of the slot's `human` car-driver spans only; hands a run its profile
// snapshot at session start; and publishes `drivers.profiles` and `drivers.links` itself (C54, C55). The running bridge
// is its only writer while it runs (`drivers/.lock`). A stale stored session it reads (C61) is skipped, and its rebuild
// requested once; once that settles, the store recomputes.
//
// Stub of SP4.3a Task 6's test phase: the implement phase fills it in.
import type { TopicName } from '@pitwall/contracts';
import type { DriverAction } from '@pitwall/contracts';
import type { CarId, ProfileSnapshot, SessionRef, UnlinkedSlot } from '@pitwall/domain';
import type { FeatureConfig } from '../feature-config.ts';
import type { Feature } from '../features/feature.ts';
import type { ValueFor } from '../hub/topic-hub.ts';
import type { Logger } from '../log.ts';
import type { SessionKey } from '../storage/db.ts';
import type { DriverSessions } from '../storage/weekend-repository.ts';

export type { DriverAction } from '@pitwall/contracts';

/** The answer to a driver-profile uiAction (C73): a rejection carries its reason and changes nothing. */
export type ApplyResult = { ok: true } | { ok: false; reason: 'invalid'; message: string };

/**
 * A car slot of a session as Participants names it: its car id, team, race number and the name the game gave it
 * (`null` when hidden online). A run's slots at session start, for `snapshotFor`.
 */
export type SlotIdentity = { carId: CarId; teamId: number; raceNumber: number; name: string | null };

export type ProfileStoreDeps = {
  /** The features whose `profiles` declarations the store runs (C63). */
  features: readonly Feature[];
  /** The stored sessions the links apply to (C34, C61). */
  repo: DriverSessions;
  /** The effective config (C47): the profile aggregates read the units' thresholds from it. */
  config: FeatureConfig;
  hub: { publishGlobal(topic: TopicName, valueFor: ValueFor): void };
  log: Logger;
  /**
   * Rebuilds stored sessions from their recordings (C61). The store asks once per session it read stale and recomputes
   * once the rebuild settles; a rejection is logged and the session stays skipped.
   */
  rebuild: (keys: readonly SessionKey[]) => Promise<void>;
  /** Now as an ISO date. Default: the wall clock. */
  now?: () => string;
};

export class ProfileStore {
  /**
   * Takes the lock `drivers/.lock` under `dataDir`, loads the persons, computes their entries (from the cache where it
   * is current) and publishes the topics. Throws, naming the lock, when another process holds it.
   */
  static open(_dataDir: string, _deps: ProfileStoreDeps): ProfileStore {
    throw new Error('not implemented');
  }

  /** Applies one driver-profile uiAction; an invalid one is rejected with a reason and changes nothing (C73). */
  apply(_action: DriverAction): ApplyResult {
    throw new Error('not implemented');
  }

  /**
   * The run's profile snapshot at session start (C62c): the persons' files read again, every confirmed link applied to
   * the session's slots (`bySlot`, `null` for an unlinked one) and the linked persons' profiles.
   */
  snapshotFor(_slots: readonly SlotIdentity[], _session: SessionRef): ProfileSnapshot {
    throw new Error('not implemented');
  }

  /** The slots of the stored sessions with a `human` span and no confirmed link, newest session first, with their suggestions. */
  unlinked(): UnlinkedSlot[] {
    throw new Error('not implemented');
  }

  /** Recomputes every person's entries and the unlinked slots: on an edit, at session end, after a rebuild (C61). */
  recompute(_trigger: 'edit' | 'sessionEnd' | 'rebuild'): void {
    throw new Error('not implemented');
  }

  /** Closes the cache and releases the lock. */
  close(): void {
    throw new Error('not implemented');
  }
}
