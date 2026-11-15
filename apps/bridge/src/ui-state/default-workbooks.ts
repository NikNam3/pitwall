import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { replaceKeepingBackup, sha256 } from './ui-files.ts';

/** The workbooks the bridge ships; the folder sits next to this module, so they travel with the source. */
export const DEFAULT_WORKBOOKS_DIR = join(import.meta.dirname, 'default-workbooks');

/**
 * The file in the workbooks folder that records the sha256 of each default as it was last copied; a dotfile, so it is
 * not a workbook.
 */
export const SEEDED_MARKER = '.seeded-defaults.json';

/** File name to the recorded hash; `undefined` for a name of an earlier release's list-form marker (hash unknown). */
type Seeded = Map<string, string | undefined>;

async function readSeeded(path: string): Promise<Seeded> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return new Map();
  }
  if (Array.isArray(parsed)) return new Map(parsed.filter((name): name is string => typeof name === 'string').map((name) => [name, undefined]));
  if (typeof parsed !== 'object' || parsed === null) return new Map();
  return new Map(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
}

/**
 * Brings the shipped defaults of `defaultsDir` into `<uiDir>/workbooks/`. A default that is new, or whose shipped text's
 * hash differs from the recorded one, is copied over the user's file (a different file there is kept as
 * `<name>.bak-<now()>`) and its hash recorded; an unchanged default leaves the user's file as it is, so an edit is kept
 * and a deleted file stays deleted. `serve` runs it before it opens the UI state.
 */
export async function seedDefaultWorkbooks(uiDir: string, defaultsDir: string, now: () => string): Promise<void> {
  const target = join(uiDir, 'workbooks');
  await mkdir(target, { recursive: true });
  const markerPath = join(target, SEEDED_MARKER);
  const seeded = await readSeeded(markerPath);
  const recorded: Record<string, string> = {};
  let changed = false;
  for (const name of (await readdir(defaultsDir)).sort()) {
    const text = await readFile(join(defaultsDir, name), 'utf8');
    const hash = sha256(text);
    recorded[name] = hash;
    if (seeded.get(name) === hash) continue;
    replaceKeepingBackup(join(target, name), text, now());
    changed = true;
  }
  // A name no longer shipped is dropped from the marker.
  if (changed || [...seeded.keys()].some((name) => !(name in recorded))) await writeFile(markerPath, `${JSON.stringify(recorded, null, 2)}\n`);
}
