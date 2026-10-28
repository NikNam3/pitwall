import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import Database from 'better-sqlite3';
import { expect, it } from 'vitest';
import { dataDir } from '../../src/storage/data-dir.ts';
import { runCli, SEGMENT } from '../helpers/cli.ts';

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
