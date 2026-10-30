// spec 9.4, acceptance criterion 5
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { beforeAll, describe, expect, it } from 'vitest';
import { fixturePath } from '../../../../test-support/fixtures.ts';
import { dataDir } from '../../src/storage/data-dir.ts';
import { trackFile } from '../fixtures/replay.ts';
import { runCli } from '../helpers/cli.ts';

// file-name order = reprocess order; the two practices share a session uid (the game reused it in a new weekend)
const files = (['menuOnly', 'raceSingapore', 'practiceZandvoortOnline', 'practiceZandvoortUidReuse'] as const).map((n) => fixturePath(n));

/** Every session the recordings open, as its storage key `uid/weekend` (decimal, like the stored columns), sorted. */
async function sessionKeysOf(paths: readonly string[]): Promise<string[]> {
  const keys = new Set<string>();
  for (const path of paths) {
    for (const e of (await trackFile(path)).lifecycle) if (e.type === 'sessionStarted') keys.add(`${e.sessionUid}/${e.session.weekendLinkIdentifier}`);
  }
  return [...keys].sort();
}
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

/** The CLI logs bugs to stderr as JSON lines instead of throwing them: an error-level line is a failure. */
async function runClean(args: string[], env: Record<string, string>) {
  const r = await runCli(args, env);
  const errors = r.stderr.split('\n').filter((l) => {
    try { return ((JSON.parse(l) as { level?: number }).level ?? 0) >= 50; } catch { return false; }
  });
  expect(errors, `pitwall ${args.join(' ')}`).toEqual([]);
  return r;
}

describe.skipIf(files.some((f) => f === undefined))('acceptance: pitwall import + reprocess', () => {
  let env: { PITWALL_DATA_DIR: string };
  let imported: ReturnType<typeof dumpDb>;
  beforeAll(async () => {
    env = { PITWALL_DATA_DIR: mkdtempSync(join(tmpdir(), 'pitwall-acc-')) };
    for (const f of files) expect(await runClean(['import', f!], env)).toMatchObject({ code: 0 });
    imported = dumpDb(env.PITWALL_DATA_DIR);
  });

  it('every session the recordings open is stored as its own (session_uid, weekend_id) row, also when two share a uid', async () => {
    const rows = imported.tables['sessions'] as Array<{ session_uid: string; weekend_id: string }>;
    expect(rows.map((r) => `${r.session_uid}/${r.weekend_id}`).sort()).toEqual(await sessionKeysOf(files as string[]));
  });
  it('reprocess rebuilds the database identically, twice', async () => {
    expect(await runClean(['reprocess'], env)).toMatchObject({ code: 0, stdout: expect.stringContaining(`reprocessed ${files.length} recordings`) });
    const first = dumpDb(env.PITWALL_DATA_DIR);
    expect((await runClean(['reprocess'], env)).code).toBe(0);
    expect(first).toEqual(imported);
    expect(dumpDb(env.PITWALL_DATA_DIR)).toEqual(first);
  });
});
