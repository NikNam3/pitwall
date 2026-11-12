// The profiles sidecar of a recording (C59, C62c; SP4.3a spec 4): a live session writes the run's profile snapshot
// (`ProfileSnapshot`, or `null` when the run has none) as `<file>.profiles.json` at session start; it is fixed for the
// run. A replay reads it back (`recordingProfiles`); a recording without one, or with one that cannot be read, runs with
// `drivers` `null` (every `view.drivers` slot `notApplicable`).
import type { DriverProfile, ProfileEntry, ProfileSnapshot } from '@pitwall/domain';
import type { Logger } from '../log.ts';
import { readSidecar } from './decision-sidecars.ts';

/** Where a recording's profiles sidecar lives: `<file>.profiles.json`. */
export function profilesSidecarPath(recordingPath: string): string {
  return `${recordingPath}.profiles.json`;
}

/** The recording's profile snapshot; `null` without a sidecar, or when it fails to read or decode (with a warning). */
export function recordingProfiles(recordingPath: string, log?: Logger): ProfileSnapshot | null {
  // A sidecar holding `null` (a live run without a snapshot) decodes to `null` as well.
  return readSidecar(profilesSidecarPath(recordingPath), (json) => (json === null ? null : decodeSnapshot(json)), log) ?? null;
}

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === 'string';
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

const isKnownNumber = (value: unknown): boolean =>
  isObject(value) && (value['known'] === true ? isNumber(value['value']) && isNumber(value['at']) : value['known'] === false && isString(value['reason']));

const isEntry = (value: unknown): value is ProfileEntry =>
  isObject(value) && isKnownNumber(value['value']) && isNumber(value['laps']) && isNumber(value['sessions']) && isString(value['newestSession']);

const isProfile = (value: unknown, person: string): value is DriverProfile =>
  isObject(value) && value['person'] === person && isString(value['displayName']) && isObject(value['entries']) && Object.values(value['entries']).every(isEntry);

function decodeSnapshot(json: unknown): ProfileSnapshot | undefined {
  if (!isObject(json) || !isString(json['fingerprint']) || !Array.isArray(json['bySlot']) || !isObject(json['profiles'])) return undefined;
  const profiles = json['profiles'];
  if (!Object.entries(profiles).every(([person, profile]) => isProfile(profile, person))) return undefined;
  const bySlot = json['bySlot'] as unknown[];
  if (!bySlot.every((p) => p === null || (isString(p) && profiles[p] !== undefined))) return undefined;
  return { fingerprint: json['fingerprint'], bySlot: bySlot as (string | null)[], profiles: profiles as Record<string, DriverProfile> };
}
