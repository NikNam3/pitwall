import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dataDir } from '../../src/storage/data-dir.ts';
import { StartupError } from '../../src/startup-error.ts';
const tmp = () => mkdtempSync(join(tmpdir(), 'data-'));

describe('dataDir', () => {
  it('honors PITWALL_DATA_DIR and creates the subdirectories', () => {
    const root = join(tmp(), 'pw');
    expect(dataDir({ PITWALL_DATA_DIR: root })).toEqual({ root, recordings: join(root, 'recordings'), dumps: join(root, 'dumps'), dbPath: join(root, 'pitwall.db') });
    expect(existsSync(join(root, 'recordings')) && existsSync(join(root, 'dumps'))).toBe(true);
  });
  it('defaults to ~/.local/share/pitwall', () => {
    const home = tmp();
    expect(dataDir({ HOME: home }).root).toBe(join(home, '.local', 'share', 'pitwall'));
  });
  it('treats an empty PITWALL_DATA_DIR as unset', () => {
    const home = tmp();
    expect(dataDir({ PITWALL_DATA_DIR: '', HOME: home }).root).toBe(join(home, '.local', 'share', 'pitwall'));
  });
  it('throws StartupError naming the path when it cannot be created or written', () => {
    const blocker = join(tmp(), 'a-file');
    writeFileSync(blocker, '');
    expect(() => dataDir({ PITWALL_DATA_DIR: join(blocker, 'pw') })).toThrow(StartupError);
    expect(() => dataDir({ PITWALL_DATA_DIR: join(blocker, 'pw') })).toThrow(/data directory .*a-file\/pw is not writable/);
  });
});
