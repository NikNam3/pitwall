// `pitwall import` copies the recording's config sidecar with it; a failure of that copy leaves nothing behind, so the
// import can be tried again.
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sessionConfigPath } from '../../src/feature-config.ts';
import { dataDir } from '../../src/storage/data-dir.ts';
import { runCli, SEGMENT } from '../helpers/cli.ts';

const tmp = () => mkdtempSync(join(tmpdir(), 'pitwall-import-sidecar-'));

describe('pitwall import: the config sidecar', { timeout: 30_000 }, () => {
  it('copies <recording>.config.json next to the imported recording', async () => {
    const source = join(tmp(), basename(SEGMENT));
    copyFileSync(SEGMENT, source);
    writeFileSync(sessionConfigPath(source), '{}');
    const root = tmp();
    const r = await runCli(['import', source], { PITWALL_DATA_DIR: root });
    expect(r.code).toBe(0);
    expect(existsSync(sessionConfigPath(join(dataDir({ PITWALL_DATA_DIR: root }).recordings, basename(SEGMENT))))).toBe(true);
  });

  it('a sidecar that cannot be copied leaves no half-imported recording behind', async () => {
    const source = join(tmp(), basename(SEGMENT));
    copyFileSync(SEGMENT, source);
    writeFileSync(sessionConfigPath(source), '{}');
    const root = tmp();
    const { recordings } = dataDir({ PITWALL_DATA_DIR: root });
    mkdirSync(sessionConfigPath(join(recordings, basename(SEGMENT)))); // a directory where the copy belongs
    const r = await runCli(['import', source], { PITWALL_DATA_DIR: root });
    expect(r.code).toBe(1);
    expect(readdirSync(recordings).filter((name) => name.endsWith('.pwrec.gz'))).toEqual([]);
    expect(r.stderr).not.toContain('already imported');
  });
});
