import type { CarId, CarKey, SessionUid } from '@pitwall/domain';
import type { Projection } from '../log/types.ts';

/** A stored earlier session of the weekend, as `view.weekend` carries it (C39, C62). */
export type StoredSession = {
  sessionUid: SessionUid;
  /** The feed's player car in that session (C60's key). */
  playerCar: CarId;
  /** Team and race number per slot, as the session's Participants last named them (C62). */
  cars: ReadonlyArray<{ carId: CarId; carKey: CarKey }>;
  /** The session's projection; every span in it is closed (C28, C34). */
  projection: Projection;
};

/**
 * The player's earlier sessions of this weekend: read-only input the bridge loads from storage (C62). The weekend phase
 * of a stored session is its projection's `weekend-phase` span; no text copy of it exists (C13, C32).
 */
export type WeekendContext = {
  weekendId: string;
  /** The player car's team and race number in this session (C62). */
  player: CarKey;
  /** The player's earlier sessions of the weekend, oldest first: those whose player car had `player`'s key (C62). */
  sessions: StoredSession[];
};
