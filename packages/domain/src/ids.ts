import type { Ms } from './units.ts';

export type FeedId = string & { readonly __brand: 'FeedId' };
/** The car's slot in the game's arrays (`vehicleIdx`), stable within a session. */
export type CarId = number & { readonly __brand: 'CarId' };
/** The game's u64 session UID as a decimal string (JSON-safe, unlike `bigint`). */
export type SessionUid = string;
/** Session time in integer ms. */
export type SessionTime = Ms;

export const MAX_CARS = 22;

/** The game's team id (Participants' `teamId`). */
export type TeamId = number;

/** A car as the game names it across the sessions of a weekend (C62): its team and race number. */
export type CarKey = { teamId: number; raceNumber: number };

export const feedId = (s: string): FeedId => s as FeedId;
export const carId = (i: number): CarId => i as CarId;
export const sessionUidString = (uid: bigint): SessionUid => uid.toString();
export const toSessionTime = (seconds: number): SessionTime => Math.round(seconds * 1000);

/** One string per car key: `teamId:raceNumber`. */
export const carKeyString = (k: CarKey): string => `${k.teamId}:${k.raceNumber}`;
/** A car identity's key (C62). */
export const carKeyOf = (identity: { teamId: number; raceNumber: number }): CarKey => ({ teamId: identity.teamId, raceNumber: identity.raceNumber });
