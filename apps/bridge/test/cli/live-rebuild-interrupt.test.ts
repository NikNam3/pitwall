// A rebuild of an outdated database that `live` stops early (signal or error) must not leave a database the next
// `live` accepts as complete.
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import type { CliIo } from '../../src/cli/io.ts';
import { main } from '../../src/cli/pitwall.ts';
import { dataDir } from '../../src/storage/data-dir.ts';
import { SCHEMA_VERSION } from '../../src/storage/db.ts';
import { SEGMENT, startCli } from '../helpers/cli.ts';

const LIVE_ENV = { PITWALL_WS_PORT: '0', PITWALL_UDP_PORT: '0' };
const tmp = () => mkdtempSync(join(tmpdir(), 'pitwall-live-rebuild-'));
/** A data dir with the segment in its recordings and a database of schema 999. */
function outdated() {
  const dir = tmp(); const dirs = dataDir({ PITWALL_DATA_DIR: dir });
  copyFileSync(SEGMENT, join(dirs.recordings, basename(SEGMENT)));
  const old = new Database(dirs.dbPath); old.pragma('user_version = 999'); old.close();
  return { dir, dirs };
}
const userVersion = (path: string) => {
  const db = new Database(path, { readonly: true });
  try { return db.pragma('user_version', { simple: true }) as number; } finally { db.close(); }
};
function memoryIo(dir: string, signal: AbortSignal) {
  const out: string[] = [], err: string[] = [];
  const io: CliIo = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ...LIVE_ENV, PITWALL_DATA_DIR: dir }, signal };
  return { io, out, err };
}
async function liveRebuildsAndServes(dir: string) {
  const live = startCli(['live'], { ...LIVE_ENV, PITWALL_DATA_DIR: dir });
  await live.waitFor(/listening ws:\/\/127\.0\.0\.1:\d+/);
  expect(live.stderr()).toContain('is outdated; rebuilding it from the recordings');
  expect(await live.stop()).toBe(0);
}

describe('pitwall live: a rebuild stopped early', { timeout: 30_000 }, () => {
  it('interrupted by the signal: exit 130, the database is not current, and the next live rebuilds it', async () => {
    const { dir, dirs } = outdated();
    const { io, out, err } = memoryIo(dir, AbortSignal.abort());
    expect(await main(['live'], io)).toBe(130);
    expect(err).toContain('pitwall: interrupted; the database is incomplete, run "pitwall reprocess" again');
    expect(out.join('\n')).not.toContain('listening');
    expect(userVersion(dirs.dbPath)).not.toBe(SCHEMA_VERSION);
    await liveRebuildsAndServes(dir);
    expect(userVersion(dirs.dbPath)).toBe(SCHEMA_VERSION);
  });
  it('failed on a broken recording: exit 1, the database is not current, and the next live rebuilds it', async () => {
    const { dir, dirs } = outdated();
    const broken = join(dirs.recordings, 'zz-broken.pwrec.gz');
    writeFileSync(broken, 'not a recording');
    const { io, out } = memoryIo(dir, new AbortController().signal);
    expect(await main(['live'], io)).toBe(1);
    expect(out.join('\n')).not.toContain('listening');
    expect(userVersion(dirs.dbPath)).not.toBe(SCHEMA_VERSION);
    rmSync(broken);
    await liveRebuildsAndServes(dir);
    expect(userVersion(dirs.dbPath)).toBe(SCHEMA_VERSION);
  });
});
