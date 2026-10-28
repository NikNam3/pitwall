import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TopicValue } from '@pitwall/contracts';
import { StartupError } from '../startup-error.ts';

/** The code map `pnpm gen` writes (spec 8.1). */
export type Catalogue = TopicValue<'dev.catalogue'>;

/** `catalogue.generated.json` at the repo root. */
export const DEFAULT_CATALOGUE_FILE = join(import.meta.dirname, '..', '..', '..', '..', 'catalogue.generated.json');

/** Reads and checks the catalogue file; a missing, unreadable or malformed file is a `StartupError` that points at `pnpm gen`. */
export function readCatalogue(file: string = DEFAULT_CATALOGUE_FILE): Catalogue {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    throw new StartupError(`catalogue file ${file} not found; run "pnpm gen"`);
  }
  let parsed: Partial<Catalogue>;
  try {
    parsed = JSON.parse(text) as Partial<Catalogue>;
  } catch {
    throw new StartupError(`catalogue file ${file} is not valid JSON; run "pnpm gen"`);
  }
  if (!Array.isArray(parsed.widgets) || !Array.isArray(parsed.topics) || !Array.isArray(parsed.features)) {
    throw new StartupError(`catalogue file ${file} lacks widgets, topics or features; run "pnpm gen"`);
  }
  return parsed as Catalogue;
}
