import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** The workbooks the bridge ships; the folder sits next to this module, so they travel with the source. */
export const DEFAULT_WORKBOOKS_DIR = join(import.meta.dirname, 'default-workbooks');

/** The file in the workbooks folder that records which defaults were copied; a dotfile, so it is not a workbook. */
export const SEEDED_MARKER = '.seeded-defaults.json';

async function readSeeded(path: string): Promise<Set<string>> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
    return new Set(Array.isArray(parsed) ? parsed.filter((name): name is string => typeof name === 'string') : []);
  } catch {
    return new Set();
  }
}

/**
 * Copies each file of `defaultsDir` into `<uiDir>/workbooks/` once: names recorded in the marker file are never copied
 * again, so a default the user deleted stays deleted, and a file already there is kept (and recorded). A default added
 * in a later release is copied on the next start. `serve` runs it before it opens the UI state.
 */
export async function seedDefaultWorkbooks(uiDir: string, defaultsDir: string): Promise<void> {
  const target = join(uiDir, 'workbooks');
  await mkdir(target, { recursive: true });
  const markerPath = join(target, SEEDED_MARKER);
  const seeded = await readSeeded(markerPath);
  const before = seeded.size;
  for (const name of await readdir(defaultsDir)) {
    if (seeded.has(name)) continue;
    // `force: false` with `errorOnExist: false` keeps an existing file as it is.
    await cp(join(defaultsDir, name), join(target, name), { force: false, errorOnExist: false });
    seeded.add(name);
  }
  if (seeded.size !== before) await writeFile(markerPath, `${JSON.stringify([...seeded].sort())}\n`);
}
