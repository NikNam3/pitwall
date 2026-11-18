// Shared setup of the rebuild service's tests (SP4.3e Task 7d; C24, C60, C61): a temporary data dir per test (C84), a
// committed segment (C84) stored as a session an earlier bridge left behind, a log capture and the injected writer probe.
//
// The writer probe is the seam the tests assume of `createRebuildService` (the implement phase adds it): an optional
// `writeProbe(write, info)` through which the service runs every main-thread storage transaction of a rebuild, `info`
// naming the session and the step (`part`: one part of the rebuilt log written into the session's staging rows; `swap`:
// the one transaction that replaces the session's log by the staged one, C24). The probe calls `write` exactly once.
import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import type { SessionKey } from '../../src/storage/db.ts';
import { processRecording } from '../../src/cli/process-recording.ts';
import { loadFeatureConfig } from '../../src/feature-config.ts';
import { FEATURES } from '../../src/features/index.generated.ts';
import { createLogger, type Logger } from '../../src/log.ts';
import { dataDir, type DataDir } from '../../src/storage/data-dir.ts';
import { openDatabase, type Db } from '../../src/storage/db.ts';
import { segmentPath } from '../fixtures/replay.ts';

/** The rules version an earlier bridge stored its sessions with. */
export const OLD = 'rules-of-an-earlier-bridge';
/** The rules version the service rebuilds under (C61). */
export const NEW = 'rules-of-this-bridge';

export const silent = createLogger({ level: 'silent' });

/** A fresh data dir (C84) and its database. */
export function newPlace(): { dirs: DataDir; db: Db } {
  const dirs = dataDir({ PITWALL_DATA_DIR: mkdtempSync(join(tmpdir(), 'pitwall-rebuild-')) });
  return { dirs, db: openDatabase(dirs.dbPath) };
}

/** A stored session: its key and its recording in the data dir's recordings. */
export type StoredSession = { key: SessionKey; file: string };

/**
 * The committed segment `segment` as a session an earlier bridge stored under `rulesVersion`: copied into the data
 * dir's recordings and processed from there (its row's recording is the copy), stored complete.
 */
export async function storeSegment(place: { dirs: DataDir; db: Db }, segment: string, rulesVersion: string): Promise<StoredSession> {
  const file = join(place.dirs.recordings, basename(segment));
  copyFileSync(segmentPath(segment), file);
  await processRecording(file, place.db, silent, new AbortController().signal, loadFeatureConfig(place.dirs.root, FEATURES), rulesVersion);
  const rows = place.db.prepare('SELECT session_uid, weekend_id, player_car FROM sessions WHERE pwrec_path = ?').all(file) as Array<{ session_uid: string; weekend_id: string; player_car: number }>;
  if (rows.length !== 1) throw new Error(`${segment}: expected one stored session, got ${rows.length}`);
  const [row] = rows;
  return { key: { sessionUid: row!.session_uid, weekendId: row!.weekend_id, playerCar: row!.player_car } as SessionKey, file };
}

export const sameKey = (a: SessionKey, b: SessionKey): boolean => a.sessionUid === b.sessionUid && a.weekendId === b.weekendId && a.playerCar === b.playerCar;

type RowSql = { rules_version: string; complete: number; pwrec_path: string | null };
/** The session's row as stored. */
export const rowOf = (db: Db, key: SessionKey): RowSql | undefined =>
  db.prepare('SELECT rules_version, complete, pwrec_path FROM sessions WHERE session_uid = ? AND weekend_id = ? AND player_car = ?')
    .get(key.sessionUid, key.weekendId, key.playerCar) as RowSql | undefined;

/** The session's fact rows with their rowids: a rebuild replaces them, so equal rowids mean nothing was rebuilt. */
export const factsWithRowids = (db: Db, key: SessionKey): unknown[] =>
  db.prepare('SELECT rowid, * FROM facts WHERE session_uid = ? AND weekend_id = ? AND player_car = ? ORDER BY rowid')
    .all(key.sessionUid, key.weekendId, key.playerCar);

/** Everything stored, rowids included. */
export const dump = (db: Db) =>
  Object.fromEntries(['weekends', 'sessions', 'cars', 'facts'].map((t) => [t, db.prepare(`SELECT rowid, * FROM ${t} ORDER BY rowid`).all()]));

/** Makes the stored session stale again, as a changed rules version does (C61). */
export const markStale = (db: Db, key: SessionKey): void => {
  db.prepare('UPDATE sessions SET rules_version = ? WHERE session_uid = ? AND weekend_id = ? AND player_car = ?').run(OLD, key.sessionUid, key.weekendId, key.playerCar);
};

/** A logger whose records the test reads back, parsed. */
export function capturedLog(level = 'info'): { log: Logger; records: Array<Record<string, unknown>> } {
  const records: Array<Record<string, unknown>> = [];
  const log = createLogger({ level, destination: { write: (line: string) => void records.push(JSON.parse(line) as Record<string, unknown>) } });
  return { log, records };
}

/** One transaction the service ran through the probe. */
export type ProbeCall = { session: SessionKey; step: 'part' | 'swap'; ms: number };
export type WriteProbe = (write: () => void, info: { session: SessionKey; step: 'part' | 'swap' }) => void;

/**
 * A writer probe that runs each write, times it (the timer is the test's, not the code's), records it and then calls
 * `after` (still synchronous, before the service goes on).
 */
export function probe(after?: (call: ProbeCall) => void): { calls: ProbeCall[]; writeProbe: WriteProbe } {
  const calls: ProbeCall[] = [];
  const writeProbe: WriteProbe = (write, info) => {
    const t0 = performance.now();
    write();
    const call = { session: info.session, step: info.step, ms: performance.now() - t0 };
    calls.push(call);
    after?.(call);
  };
  return { calls, writeProbe };
}
