import { accessSync, constants, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { StartupError } from '../startup-error.ts';

export type DataDir = { root: string; recordings: string; dumps: string; dbPath: string; ui: string };

/** Resolves `PITWALL_DATA_DIR` (default `~/.local/share/pitwall`, also when it is empty) and makes sure it and its subdirectories exist and are writable. */
export function dataDir(env: Readonly<Record<string, string | undefined>>): DataDir {
  const root = env['PITWALL_DATA_DIR'] || join(env['HOME'] ?? homedir(), '.local', 'share', 'pitwall');
  const dirs = { root, recordings: join(root, 'recordings'), dumps: join(root, 'dumps'), dbPath: join(root, 'pitwall.db'), ui: join(root, 'ui') };
  try {
    for (const dir of [dirs.root, dirs.recordings, dirs.dumps, dirs.ui]) {
      mkdirSync(dir, { recursive: true });
      accessSync(dir, constants.W_OK);
    }
  } catch (error) {
    throw new StartupError(`data directory ${root} is not writable: ${error instanceof Error ? error.message : String(error)}`);
  }
  return dirs;
}
