import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import Database from 'better-sqlite3';
import { expect, it } from 'vitest';
import { dataDir } from '../../src/storage/data-dir.ts';
import { openDatabase } from '../../src/storage/db.ts';
import { StorageWriter } from '../../src/storage/storage-writer.ts';
import { WeekendRepository } from '../../src/storage/weekend-repository.ts';
import { runCli, SEGMENT } from '../helpers/cli.ts';
import { all, history, key, lap, session as sessionRow } from '../storage/records.ts';

const read = <T>(dir: string, sql: string): T[] => {
  const db = new Database(dataDir({ PITWALL_DATA_DIR: dir }).dbPath, { readonly: true });
  try { return db.prepare(sql).all() as T[]; } finally { db.close(); }
};

it('reprocess --weekend finds the recordings of an imported session and leaves the stored laps unchanged', { timeout: 30_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cli-weekend-'));
  const env = { PITWALL_DATA_DIR: dir };
  expect(await runCli(['import', SEGMENT], env)).toMatchObject({ code: 0 });
  const [session] = read<{ weekend_id: string; pwrec_path: string | null }>(dir, 'SELECT weekend_id, pwrec_path FROM sessions');
  expect(session).toBeDefined();
  expect(session!.pwrec_path).toBe(join(dataDir(env).recordings, basename(SEGMENT)));
  const lapsSql = 'SELECT session_uid, car_id, lap_number, lap_time_ms, record FROM laps ORDER BY session_uid, car_id, lap_number';
  const before = read(dir, lapsSql); expect(before.length).toBeGreaterThan(0);

  const r = await runCli(['reprocess', '--weekend', session!.weekend_id], env);
  expect(r).toMatchObject({ code: 0, stdout: expect.stringContaining('reprocessed 1 recordings') });
  expect(read(dir, lapsSql)).toEqual(before);
});

it('reprocess --weekend removes the stored rows the new run no longer produces', { timeout: 30_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cli-weekend-'));
  const env = { PITWALL_DATA_DIR: dir };
  expect(await runCli(['import', SEGMENT], env)).toMatchObject({ code: 0 });
  const [session] = read<{ session_uid: string; weekend_id: string }>(dir, 'SELECT session_uid, weekend_id FROM sessions');
  const db = new Database(dataDir(env).dbPath);
  try {
    db.prepare('INSERT INTO events (session_uid, weekend_id, seq, car_id, record) VALUES (?, ?, 999999, NULL, ?)').run(session!.session_uid, session!.weekend_id, '{"stale":true}');
  } finally { db.close(); }
  expect(read(dir, 'SELECT seq FROM events WHERE seq = 999999')).toHaveLength(1);

  expect(await runCli(['reprocess', '--weekend', session!.weekend_id], env)).toMatchObject({ code: 0 });
  expect(read(dir, 'SELECT seq FROM events WHERE seq = 999999')).toEqual([]);
});

it('reprocess --weekend with an id no stored session has exits 1 with a message', { timeout: 30_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cli-weekend-'));
  const r = await runCli(['reprocess', '--weekend', '4242'], { PITWALL_DATA_DIR: dir });
  expect(r).toMatchObject({ code: 1, stderr: expect.stringContaining('pitwall: no stored sessions of weekend 4242') });
  expect(r.stdout).not.toContain('reprocessed');
});

it('reprocess --weekend keeps the session with the same uid stored for another weekend', { timeout: 30_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cli-weekend-'));
  const env = { PITWALL_DATA_DIR: dir };
  expect(await runCli(['import', SEGMENT], env)).toMatchObject({ code: 0 });
  const [imported] = read<{ session_uid: string; weekend_id: string }>(dir, 'SELECT session_uid, weekend_id FROM sessions');
  const other = sessionRow(imported!.session_uid, { weekendId: `${imported!.weekend_id}0` });   // the game reused the uid in a new weekend
  const h = history({ laps: [lap(0, 1)] });
  const db = openDatabase(dataDir(env).dbPath);
  try {
    const writer = new StorageWriter(db, { onError: (e) => { throw e; } });
    writer.upsertSession(other);
    writer.writeConfirmed(key(other.sessionUid, other.weekendId), h, all(h));
  } finally { db.close(); }

  expect(await runCli(['reprocess', '--weekend', imported!.weekend_id], env)).toMatchObject({ code: 0 });
  const after = openDatabase(dataDir(env).dbPath);
  try {
    const repo = new WeekendRepository(after);
    expect(repo.sessionsOf(other.weekendId)).toEqual([other]);
    expect(repo.lapsOf(key(other.sessionUid, other.weekendId))).toEqual(h.laps);
    expect(repo.sessionsOf(imported!.weekend_id).map((s) => s.sessionUid)).toEqual([imported!.session_uid]);
  } finally { after.close(); }
});
