// `pitwall reprocess --weekend` (Task 27, C24, C61): each session of the weekend is rebuilt from its recording, and its
// log replaced as a whole in one transaction. Nothing is deleted before the run, so an interrupted reprocess leaves the
// old log.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import Database from 'better-sqlite3';
import { expect, it } from 'vitest';
import type { CliIo } from '../../src/cli/io.ts';
import { main } from '../../src/cli/pitwall.ts';
import { dataDir } from '../../src/storage/data-dir.ts';
import { openDatabase } from '../../src/storage/db.ts';
import { StorageWriter } from '../../src/storage/storage-writer.ts';
import { WeekendRepository } from '../../src/storage/weekend-repository.ts';
import { runCli, SEGMENT } from '../helpers/cli.ts';
import { car, keyOf, lap, log, projected, session as sessionRow, stored } from '../storage/records.ts';

const read = <T>(dir: string, sql: string): T[] => {
  const db = new Database(dataDir({ PITWALL_DATA_DIR: dir }).dbPath, { readonly: true });
  try { return db.prepare(sql).all() as T[]; } finally { db.close(); }
};
const FACTS = 'SELECT session_uid, weekend_id, player_car, list, seq, car_id, record FROM facts ORDER BY session_uid, weekend_id, player_car, list, seq';

it('reprocess --weekend finds the recordings of an imported session and leaves the stored log unchanged', { timeout: 30_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cli-weekend-'));
  const env = { PITWALL_DATA_DIR: dir };
  expect(await runCli(['import', SEGMENT], env)).toMatchObject({ code: 0 });
  const [session] = read<{ weekend_id: string; pwrec_path: string | null }>(dir, 'SELECT weekend_id, pwrec_path FROM sessions');
  expect(session).toBeDefined();
  expect(session!.pwrec_path).toBe(join(dataDir(env).recordings, basename(SEGMENT)));
  const before = read(dir, FACTS); expect(before.length).toBeGreaterThan(0);

  const r = await runCli(['reprocess', '--weekend', session!.weekend_id], env);
  expect(r).toMatchObject({ code: 0, stdout: expect.stringContaining('reprocessed 1 recordings') });
  expect(read(dir, FACTS)).toEqual(before);
});

it('reprocess --weekend removes the stored rows the new run no longer produces', { timeout: 30_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cli-weekend-'));
  const env = { PITWALL_DATA_DIR: dir };
  expect(await runCli(['import', SEGMENT], env)).toMatchObject({ code: 0 });
  const [session] = read<{ session_uid: string; weekend_id: string; player_car: number }>(dir, 'SELECT session_uid, weekend_id, player_car FROM sessions');
  const db = new Database(dataDir(env).dbPath);
  try {
    db.prepare("INSERT INTO facts (session_uid, weekend_id, player_car, list, seq, car_id, record) VALUES (?, ?, ?, 'events', 999999, NULL, ?)")
      .run(session!.session_uid, session!.weekend_id, session!.player_car, '{"stale":true}');
  } finally { db.close(); }
  expect(read(dir, 'SELECT seq FROM facts WHERE seq = 999999')).toHaveLength(1);

  expect(await runCli(['reprocess', '--weekend', session!.weekend_id], env)).toMatchObject({ code: 0 });
  expect(read(dir, 'SELECT seq FROM facts WHERE seq = 999999')).toEqual([]);
});

it('reprocess --weekend with an id no stored session has exits 1 with a message', { timeout: 30_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cli-weekend-'));
  const r = await runCli(['reprocess', '--weekend', '4242'], { PITWALL_DATA_DIR: dir });
  expect(r).toMatchObject({ code: 1, stderr: expect.stringContaining('pitwall: no stored sessions of weekend 4242') });
  expect(r.stdout).not.toContain('reprocessed');
});

it('an interrupted reprocess --weekend leaves the old log (C24)', { timeout: 30_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cli-weekend-'));
  const env = { PITWALL_DATA_DIR: dir };
  expect(await runCli(['import', SEGMENT], env)).toMatchObject({ code: 0 });
  const [session] = read<{ weekend_id: string }>(dir, 'SELECT weekend_id FROM sessions');
  const rows = read(dir, 'SELECT * FROM sessions');
  const cars = read(dir, 'SELECT * FROM cars ORDER BY car_id');
  const facts = read(dir, FACTS);
  expect(facts.length).toBeGreaterThan(0);

  const err: string[] = [];
  const io: CliIo = { out: () => {}, err: (l) => err.push(l), env, signal: AbortSignal.abort() };
  expect(await main(['reprocess', '--weekend', session!.weekend_id], io)).toBe(130);
  expect(read(dir, 'SELECT * FROM sessions')).toEqual(rows);
  expect(read(dir, 'SELECT * FROM cars ORDER BY car_id')).toEqual(cars);
  expect(read(dir, FACTS)).toEqual(facts);
});

it('reprocess --weekend keeps the session with the same uid stored for another weekend', { timeout: 30_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cli-weekend-'));
  const env = { PITWALL_DATA_DIR: dir };
  expect(await runCli(['import', SEGMENT], env)).toMatchObject({ code: 0 });
  const [imported] = read<{ session_uid: string; weekend_id: string }>(dir, 'SELECT session_uid, weekend_id FROM sessions');
  const other = sessionRow(imported!.session_uid, { weekendId: `${imported!.weekend_id}0`, playerCar: car(1) });   // the game reused the uid in a new weekend
  const l = log({ laps: [lap(0, 1)] });
  const db = openDatabase(dataDir(env).dbPath);
  try {
    const writer = new StorageWriter(db, { onError: (e) => { throw e; }, rulesVersion: 'unversioned' });
    writer.upsertSession(other);
    writer.writeLog(keyOf(other), l);
    writer.complete(keyOf(other));
  } finally { db.close(); }

  expect(await runCli(['reprocess', '--weekend', imported!.weekend_id], env)).toMatchObject({ code: 0 });
  const after = openDatabase(dataDir(env).dbPath);
  try {
    const repo = new WeekendRepository(after);
    expect(repo.sessionsOf(other.weekendId)).toEqual([stored(other, true)]);
    expect(await repo.projectionOf(keyOf(other))).toEqual(projected(l));
    expect(repo.sessionsOf(imported!.weekend_id).map((s) => s.sessionUid)).toEqual([imported!.session_uid]);
  } finally { after.close(); }
});
