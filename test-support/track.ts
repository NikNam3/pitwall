// The committed Zandvoort track file (a copy of data/tracks/26.json, C84) for tests that need a track (spec 9).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TrackData, TrackFile } from '../packages/domain/src/index.ts';

/** The Zandvoort track file as committed: the data plus its provenance. */
export const zandvoortTrackFile = (): TrackFile =>
  JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures/track-zandvoort.json'), 'utf8')) as TrackFile;

/** The Zandvoort track as `view.track` holds it: the file without `source` (C35); no validation, which is Task 3's. */
export const zandvoortTrack = (): TrackData => {
  const { source: _source, ...data } = zandvoortTrackFile();
  return data;
};
