import type { CarId, CarKey, SessionBasis, SessionUid } from '@pitwall/domain';
import type { Projection } from '../log/types.ts';

/** A stored session of the basis, as `view.basis` carries it (C39, C62). */
export type StoredSession = {
  sessionUid: SessionUid;
  /** The session's weekend id (C60's key): a basis may name sessions of several weekends. */
  weekendId: string;
  /** The feed's player car in that session (C60's key). */
  playerCar: CarId;
  /** Team and race number per slot, as the session's Participants last named them (C62). */
  cars: ReadonlyArray<{ carId: CarId; carKey: CarKey }>;
  /** The session's projection; every span in it is closed (C28, C34). */
  projection: Projection;
};

/**
 * The basis of the session (C62): the stored sessions it builds on, as read-only input the bridge loads from storage.
 * The weekend phase of a stored session is its projection's `weekend-phase` span; no text copy of it exists (C13, C32).
 */
export type BasisContext = {
  /** The basis the sessions were loaded for: the session-start basis, or the one a `basisChosen` decision names. */
  basis: SessionBasis;
  /** The player car's team and race number in this session (C62). */
  player: CarKey;
  /** The basis's sessions of the player's seat, oldest first: those whose player car had `player`'s key (C62); a session not stored is missing. */
  sessions: StoredSession[];
};
