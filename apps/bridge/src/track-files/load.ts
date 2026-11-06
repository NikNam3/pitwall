// The session's track file (C62b, spec 4): loaded from the committed files, or from a recording's sidecar in a replay.
// Only the bridge reads track files; a file that is missing or fails validation is `notApplicable` (C3), a failing one
// with one warning on the bridge's log (no insight, C52). A session without a valid file writes the not-applicable
// sidecar `{ "known": false, "reason": "notApplicable" }`; its replay is `notApplicable` without a warning, also
// when a committed file exists by then (C38).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { known, unknown, validateTrackFile, type Known, type TrackFile } from '@pitwall/domain';
import type { Logger } from '../log.ts';

/** The committed track files: `<repo>/data/tracks`, resolved from the bridge package root (no environment variable, C58). */
export const TRACKS_DIR: string = join(import.meta.dirname, '..', '..', '..', '..', 'data', 'tracks');

const NOT_APPLICABLE = unknown('notApplicable');

/** `<dir>/<trackId>.json`, validated; missing or invalid → `unknown('notApplicable')`, an invalid one with one warning. */
export function loadTrackFile(trackId: number, dir: string, log?: Logger): Known<TrackFile> {
  return readTrackFile(join(dir, `${trackId}.json`), trackId, log) ?? NOT_APPLICABLE;
}

/** Where a recording's track sidecar lives. */
export function trackSidecarPath(recordingPath: string): string {
  return `${recordingPath}.track.json`;
}

/**
 * A replay's track: the recording's sidecar if it has one, validated against `trackId` (a sidecar of another track
 * fails), else the committed file. A not-applicable sidecar, or one that fails, is `notApplicable`, never the committed file.
 */
export function recordingTrack(recordingPath: string, trackId: number, dir: string, log?: Logger): Known<TrackFile> {
  return readTrackFile(trackSidecarPath(recordingPath), trackId, log) ?? loadTrackFile(trackId, dir, log);
}

/**
 * The track file at `path`, checked against `trackId`; `undefined` without a file; a not-applicable sidecar is
 * `notApplicable` silently, a failing file `notApplicable` with one warning.
 */
function readTrackFile(path: string, trackId: number, log: Logger | undefined): Known<TrackFile> | undefined {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    return rejected(path, trackId, [`not readable: ${messageOf(error)}`], log);
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    return rejected(path, trackId, [`not JSON: ${messageOf(error)}`], log);
  }
  if (isNotApplicableSidecar(json)) return NOT_APPLICABLE;
  const result = validateTrackFile(json);
  if (!result.ok) return rejected(path, trackId, result.errors, log);
  if (result.file.trackId !== trackId) return rejected(path, trackId, [`trackId: ${result.file.trackId}, the session's track is ${trackId}`], log);
  return known(result.file, 0);
}

/** Exactly `{ "known": false, "reason": "notApplicable" }`: the sidecar of a session without a valid track file. */
function isNotApplicableSidecar(json: unknown): boolean {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return false;
  const keys = Object.keys(json);
  const value = json as Record<string, unknown>;
  return keys.length === 2 && value['known'] === false && value['reason'] === 'notApplicable';
}

function rejected(path: string, trackId: number, errors: readonly string[], log: Logger | undefined): Known<TrackFile> {
  log?.warn({ path, trackId, errors }, 'track file rejected: the track is notApplicable');
  return NOT_APPLICABLE;
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));
