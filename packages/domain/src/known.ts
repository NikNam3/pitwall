import type { SessionTime } from './ids.ts';

/** Why a value is missing (spec 6.2). Missing data is never 0. */
export type UnknownReason = 'restricted' | 'notReceived' | 'notApplicable' | 'stale';

/** A value with its availability: known since `at`, or unknown for a reason. */
export type Known<T> = { known: true; value: T; at: SessionTime } | { known: false; reason: UnknownReason };

export const known = <T>(value: T, at: SessionTime): Known<T> => ({ known: true, value, at });
export const unknown = (reason: UnknownReason): Known<never> => ({ known: false, reason });
