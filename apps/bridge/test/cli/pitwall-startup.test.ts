import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dataDir } from '../../src/storage/data-dir.ts';
import { runCli } from '../helpers/cli.ts';

describe('pitwall CLI startup problems', { timeout: 30_000 }, () => {
  it('live: a database file that is not SQLite → clear message pointing at reprocess, exit 1, nothing started', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pitwall-cli-'));
    writeFileSync(dataDir({ PITWALL_DATA_DIR: root }).dbPath, 'this is not a database file '.repeat(20));
    const r = await runCli(['live'], { PITWALL_WS_PORT: '0', PITWALL_UDP_PORT: '0', PITWALL_DATA_DIR: root });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('pitwall: the database file is not a valid SQLite database');
    expect(r.stderr).toContain('pitwall reprocess');
    expect(r.stdout).not.toContain('listening');
  });
});
