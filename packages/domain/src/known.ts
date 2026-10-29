import type { SessionTime } from './ids.ts';

/**
 * Why a value is missing (spec 6.2, 7.9). Missing data is never 0; `realism` = withheld on purpose in realism mode;
 * `insufficientData` = too few laps or samples yet for a rate or a mean.
 */
export type UnknownReason = 'restricted' | 'notReceived' | 'notApplicable' | 'realism' | 'insufficientData';

/** A value with its availability: known since `at`, or unknown for a reason. */
export type Known<T> = { known: true; value: T; at: SessionTime } | { known: false; reason: UnknownReason };

export const known = <T>(value: T, at: SessionTime): Known<T> => ({ known: true, value, at });
export const unknown = (reason: UnknownReason): Known<never> => ({ known: false, reason });
