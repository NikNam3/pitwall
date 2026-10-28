// Ctrl-C (SIGINT) or SIGTERM during reprocess and import: the io's signal is aborted; the command stops with exit code 130.
import { copyFileSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import type { CliIo } from '../../src/cli/io.ts';
import { main } from '../../src/cli/pitwall.ts';
import { dataDir } from '../../src/storage/data-dir.ts';
import { SEGMENT } from '../helpers/cli.ts';

const tmp = () => mkdtempSync(join(tmpdir(), 'pitwall-interrupt-'));
function memoryIo(dataDirectory: string, signal: AbortSignal) {
  const out: string[] = [], err: string[] = [];
  const io: CliIo = { out: (l) => out.push(l), err: (l) => err.push(l), env: { PITWALL_DATA_DIR: dataDirectory }, signal };
  return { io, out, err };
}
const storedSessions = (dir: string) => {
  const path = dataDir({ PITWALL_DATA_DIR: dir }).dbPath;
  if (!existsSync(path)) return 0;
  const db = new Database(path, { readonly: true });
  try { return (db.prepare('SELECT count(*) FROM sessions').pluck().get() as number); } finally { db.close(); }
};

describe('pitwall CLI: interrupted by a signal', { timeout: 30_000 }, () => {
  it('reprocess with the signal already aborted processes no recording and exits 130', async () => {
    const dir = tmp();
    copyFileSync(SEGMENT, join(dataDir({ PITWALL_DATA_DIR: dir }).recordings, basename(SEGMENT)));
    const { io, out, err } = memoryIo(dir, AbortSignal.abort());
    expect(await main(['reprocess'], io)).toBe(130);
    expect(err).toContain('pitwall: interrupted; the database is incomplete, run "pitwall reprocess" again');
    expect(out.join('\n')).not.toContain('reprocessed');
    expect(storedSessions(dir)).toBe(0);
  });
  it('import with the signal already aborted exits 130, leaves no copied file, and a retry imports it', async () => {
    const dir = tmp();
    const target = join(dataDir({ PITWALL_DATA_DIR: dir }).recordings, basename(SEGMENT));
    const interrupted = memoryIo(dir, AbortSignal.abort());
    expect(await main(['import', SEGMENT], interrupted.io)).toBe(130);
    expect(interrupted.err).toContain('pitwall: interrupted, nothing imported');
    expect(interrupted.out.join('\n')).not.toContain('imported');
    expect(existsSync(target)).toBe(false);

    const retry = memoryIo(dir, new AbortController().signal);
    expect(await main(['import', SEGMENT], retry.io)).toBe(0);
    expect(existsSync(target)).toBe(true);
    expect(storedSessions(dir)).toBe(1);
  });
});
