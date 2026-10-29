// The files under `PITWALL_DATA_DIR/ui/` (ADR 0013): atomic writes, content hashes, tolerant reads.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

/** Writes a temp file next to `path`, then renames it over `path`, so a reader never sees half a file. */
export function writeAtomic(path: string, text: string): void {
  const temp = `${path}.tmp`;
  writeFileSync(temp, text);
  renameSync(temp, path);
}

/** The file's text, or `undefined` when it does not exist or cannot be read. */
export function readText(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
}

/** The result of parsing JSON text: a value or the parser's message. */
export type Parsed = { ok: true; value: unknown } | { ok: false; message: string };

export function parseJson(text: string): Parsed {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

/** The names (without `.json`) of the workbook files in `dir`, sorted. Temp files and dotfiles (the seeding marker) are not workbooks. */
export function workbookNames(dir: string): string[] {
  try {
    return readdirSync(dir).filter((file) => file.endsWith('.json') && !file.startsWith('.')).map((file) => file.slice(0, -'.json'.length)).sort();
  } catch {
    return [];
  }
}

export const ensureDir = (dir: string): void => {
  mkdirSync(dir, { recursive: true });
};

export const workbookPath = (ui: string, name: string): string => join(ui, 'workbooks', `${name}.json`);
