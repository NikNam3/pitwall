// The line on track, the one rule for the recorders that need it (contract C10, C11: a pure function of two lap
// distances and the track length, no recorder's open state).
import type { Metres } from '@pitwall/domain';

/** The line on track: the lap distance from below 0 to 0 or more, or a wrap of more than half the track's length. */
export const crossesLine = (beforeM: Metres, nowM: Metres, trackLengthM: Metres): boolean =>
  (beforeM < 0 && nowM >= 0) || (trackLengthM > 0 && beforeM - nowM > trackLengthM / 2);
