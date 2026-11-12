// The profiles sidecar of a recording (C59, C62c; SP4.3a spec 4): a live session writes the run's profile snapshot
// (`ProfileSnapshot`, or `null` when the run has none) as `<file>.profiles.json` at session start; it is fixed for the
// run. A replay reads it back (`recordingProfiles`); a recording without one, or with one that cannot be read, runs with
// `drivers` `null` (every `view.drivers` slot `notApplicable`).
//
// Stub of SP4.3a Task 6's test phase: the implement phase fills it in.
import type { ProfileSnapshot } from '@pitwall/domain';
import type { Logger } from '../log.ts';

/** Where a recording's profiles sidecar lives: `<file>.profiles.json`. */
export function profilesSidecarPath(_recordingPath: string): string {
  throw new Error('not implemented');
}

/** The recording's profile snapshot; `null` without a sidecar, or when it fails to read or decode (with a warning). */
export function recordingProfiles(_recordingPath: string, _log?: Logger): ProfileSnapshot | null {
  throw new Error('not implemented');
}
