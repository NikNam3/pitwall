import type { Ms } from './units.ts';

export type FeedId = string & { readonly __brand: 'FeedId' };
/** The car's slot in the game's arrays (`vehicleIdx`), stable within a session. */
export type CarId = number & { readonly __brand: 'CarId' };
/** The game's u64 session UID as a decimal string (JSON-safe, unlike `bigint`). */
export type SessionUid = string;
/** Session time in integer ms. */
export type SessionTime = Ms;

export const MAX_CARS = 22;

/** Identifies a driver across the sessions of a weekend (spec 6.2). */
export type DriverKey =
  | { kind: 'ai'; driverId: number }
  | { kind: 'human'; networkId: number; name: string; raceNumber: number };

export const feedId = (s: string): FeedId => s as FeedId;
export const carId = (i: number): CarId => i as CarId;
export const sessionUidString = (uid: bigint): SessionUid => uid.toString();
export const toSessionTime = (seconds: number): SessionTime => Math.round(seconds * 1000);

export const driverKeyString = (k: DriverKey): string =>
  k.kind === 'ai' ? `ai:${k.driverId}` : `human:${k.networkId}:${k.raceNumber}:${k.name}`;
