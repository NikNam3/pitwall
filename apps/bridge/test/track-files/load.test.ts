// Loading a session's track file (C62b, spec 4): the committed file of its track id, or a recording's sidecar in a
// replay. A file that is missing or fails validation is `notApplicable`; a failing one leaves one warning on the
// bridge's log (no insight, C52). Temporary directories only, never the data dir (C84).
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { unknown, type TrackFile } from '@pitwall/domain';
import { zandvoortTrackFile } from '../../../../test-support/track.ts';
import { createLogger, type Logger } from '../../src/log.ts';
import { loadTrackFile, recordingTrack } from '../../src/track-files/load.ts';

const ZANDVOORT = 26;
const tmp = () => mkdtempSync(join(tmpdir(), 'track-files-'));
const NOT_APPLICABLE = unknown('notApplicable');

/** A logger that keeps its warnings (and anything above) as parsed lines. */
function capturingLog(): { log: Logger; warnings: Array<Record<string, unknown>> } {
  const lines: Array<Record<string, unknown>> = [];
  const destination = new Writable({ write(chunk, _encoding, done) { lines.push(JSON.parse(String(chunk)) as Record<string, unknown>); done(); } });
  return { log: createLogger({ level: 'warn', destination }), warnings: lines };
}

/** `file` as JSON at `path`. */
const writeJson = (path: string, file: unknown): void => writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`);

/** A directory of committed track files holding `files` as `<trackId>.json`. */
function tracksDir(...files: TrackFile[]): string {
  const dir = tmp();
  for (const file of files) writeJson(join(dir, `${file.trackId}.json`), file);
  return dir;
}

/** A Zandvoort file told apart from the others by its name. */
const zandvoortNamed = (name: string): TrackFile => ({ ...zandvoortTrackFile(), name });

/** A Zandvoort file that fails validation: its name is no string. */
const invalidZandvoort = (): unknown => ({ ...zandvoortTrackFile(), name: 42 });

/** A recording path in a fresh directory; the recording itself need not exist, only its sidecar is read. */
const recordingIn = (dir = tmp()): string => join(dir, 'session.pwrec.gz');

const loaded = (file: TrackFile) => ({ known: true, value: file, at: expect.any(Number) });

describe('loadTrackFile', () => {
  it('a valid file loads', () => {
    const file = zandvoortTrackFile();
    const { log, warnings } = capturingLog();
    expect(loadTrackFile(ZANDVOORT, tracksDir(file), log)).toEqual(loaded(file));
    expect(warnings).toEqual([]);
  });

  it('a missing file is notApplicable', () => {
    const { log, warnings } = capturingLog();
    expect(loadTrackFile(ZANDVOORT, tracksDir(), log)).toEqual(NOT_APPLICABLE);
    // a track without a file is no fault: many tracks have none
    expect(warnings).toEqual([]);
  });

  it.each([
    ['fails validation', `${JSON.stringify(invalidZandvoort())}\n`, 'name: not a string'],
    ['is no JSON', '{ "trackId": 26, ', undefined],
  ])('an invalid file is notApplicable and logs one warning (a file that %s)', (_what, content, error) => {
    const dir = tmp();
    writeFileSync(join(dir, `${ZANDVOORT}.json`), content);
    const { log, warnings } = capturingLog();
    expect(loadTrackFile(ZANDVOORT, dir, log)).toEqual(NOT_APPLICABLE);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ level: 40 });
    if (error !== undefined) expect(JSON.stringify(warnings[0])).toContain(error);
  });
});

describe('recordingTrack', () => {
  it('prefers a valid sidecar of the same track id over the committed file', () => {
    const sidecar = zandvoortNamed('from the sidecar');
    const recording = recordingIn();
    writeJson(`${recording}.track.json`, sidecar);
    const { log, warnings } = capturingLog();
    expect(recordingTrack(recording, ZANDVOORT, tracksDir(zandvoortNamed('committed')), log)).toEqual(loaded(sidecar));
    expect(warnings).toEqual([]);
  });

  it('with a sidecar of another track id is notApplicable and logs one warning, although a committed file for the session\'s track exists', () => {
    const recording = recordingIn();
    writeJson(`${recording}.track.json`, { ...zandvoortTrackFile(), trackId: 27 });
    const { log, warnings } = capturingLog();
    expect(recordingTrack(recording, ZANDVOORT, tracksDir(zandvoortNamed('committed')), log)).toEqual(NOT_APPLICABLE);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ level: 40 });
  });

  it('with an invalid sidecar is notApplicable and logs one warning, although a committed file exists', () => {
    const recording = recordingIn();
    writeJson(`${recording}.track.json`, invalidZandvoort());
    const { log, warnings } = capturingLog();
    expect(recordingTrack(recording, ZANDVOORT, tracksDir(zandvoortNamed('committed')), log)).toEqual(NOT_APPLICABLE);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ level: 40 });
    expect(JSON.stringify(warnings[0])).toContain('name: not a string');
  });

  it('without a sidecar loads the committed file', () => {
    const committed = zandvoortNamed('committed');
    const { log, warnings } = capturingLog();
    expect(recordingTrack(recordingIn(), ZANDVOORT, tracksDir(committed), log)).toEqual(loaded(committed));
    expect(warnings).toEqual([]);
  });
});
