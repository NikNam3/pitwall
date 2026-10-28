// spec 9.4, acceptance criterion 5
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { fixturePath } from '../../../../test-support/fixtures.ts';
import { dataDir } from '../../src/storage/data-dir.ts';
import { runCli } from '../helpers/cli.ts';

const files = (['menuOnly', 'ttZandvoort', 'raceSingapore'] as const).map((n) => fixturePath(n)); // file-name order = reprocess order
function dumpDb(dir: string) {
  const db = new Database(dataDir({ PITWALL_DATA_DIR: dir }).dbPath, { readonly: true });
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").pluck().all() as string[];
  const dump = {
    userVersion: db.pragma('user_version', { simple: true }),
    tables: Object.fromEntries(tables.map((t) => [t, db.prepare(`SELECT * FROM "${t}" ORDER BY rowid`).all()])) as Record<string, unknown[]>,
  };
  db.close();
  return dump;
}

describe.skipIf(files.some((f) => f === undefined))('acceptance: pitwall import + reprocess', () => {
  it('reprocess rebuilds the database identically, twice', async () => {
    const env = { PITWALL_DATA_DIR: mkdtempSync(join(tmpdir(), 'pitwall-acc-')) };
    for (const f of files) expect(await runCli(['import', f!], env)).toMatchObject({ code: 0 });
    const imported = dumpDb(env.PITWALL_DATA_DIR);
    expect(imported.tables['sessions']).toHaveLength(2); // menuOnly opens no session
    expect(imported.tables['laps']).toHaveLength(15); // TT confirmed laps; Singapore completed none
    expect(await runCli(['reprocess'], env)).toMatchObject({ code: 0, stdout: expect.stringContaining('reprocessed 3 recordings') });
    const first = dumpDb(env.PITWALL_DATA_DIR);
    expect((await runCli(['reprocess'], env)).code).toBe(0);
    expect(first).toEqual(imported);
    expect(dumpDb(env.PITWALL_DATA_DIR)).toEqual(first);
  });
});
