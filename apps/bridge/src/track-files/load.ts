// The session's track file (C62b, spec 4): loaded from the committed files, or from a recording's sidecar in a replay.
// Test-phase stubs: the implement phase fills them in.
import { join } from 'node:path';
import type { Known, TrackFile } from '@pitwall/domain';
import type { Logger } from '../log.ts';

/** The committed track files: `<repo>/data/tracks`, resolved from the bridge package root (no environment variable, C58). */
export const TRACKS_DIR: string = join(import.meta.dirname, '..', '..', '..', '..', 'data', 'tracks');

/** `<dir>/<trackId>.json`, validated; missing or invalid → `unknown('notApplicable')`, an invalid one with one warning. */
export function loadTrackFile(_trackId: number, _dir: string, _log?: Logger): Known<TrackFile> {
  throw new Error('not implemented');
}

/** Where a recording's track sidecar lives. */
export function trackSidecarPath(_recordingPath: string): string {
  throw new Error('not implemented');
}

/** A replay's track: the recording's sidecar if it has one (validated against `trackId`), else the committed file. */
export function recordingTrack(_recordingPath: string, _trackId: number, _dir: string, _log?: Logger): Known<TrackFile> {
  throw new Error('not implemented');
}
