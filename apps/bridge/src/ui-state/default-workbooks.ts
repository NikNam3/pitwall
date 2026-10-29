import { cp, mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';

/** The workbooks the bridge ships; the folder sits next to this module, so they travel with the source. */
export const DEFAULT_WORKBOOKS_DIR = join(import.meta.dirname, 'default-workbooks');

/**
 * Copies every file of `defaultsDir` into `<uiDir>/workbooks/` unless a file of that name is already there, so a
 * first start has workbooks to open and an edited one is never overwritten. `serve` runs it before it opens the UI state.
 */
export async function seedDefaultWorkbooks(uiDir: string, defaultsDir: string): Promise<void> {
  const target = join(uiDir, 'workbooks');
  await mkdir(target, { recursive: true });
  for (const name of await readdir(defaultsDir)) {
    // `force: false` with `errorOnExist: false` keeps an existing file as it is.
    await cp(join(defaultsDir, name), join(target, name), { force: false, errorOnExist: false });
  }
}
