import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe } from 'vitest';

/** Full recordings used as fixtures, keyed by name. Mirrors `fixtures/index.json`. */
export const FIXTURES = {
  ttZandvoort: '2026-10-27_23-31-43_1a4f5531395c7884.pwrec.gz',
  raceSingapore: '2026-10-28_00-15-04_b3cd07e2790bdcbe.pwrec.gz',
  menuOnly: '2026-10-27_22-50-28_5cc4798807ebe7a5.pwrec.gz',
  qualifyingSingapore: '2026-10-28_23-53-34_d2b06401967cd89c.pwrec.gz',
  raceSingaporeWet: '2026-10-29_00-04-08_095e1bf6add44b18.pwrec.gz',
  practiceZandvoortOnline: '2026-10-29_22-39-31_0022670294e098af.pwrec.gz',
  raceZandvoortOnline: '2026-10-29_22-48-50_bbda17a651868614.pwrec.gz',
  practiceZandvoortUidReuse: '2026-10-29_22-54-58_0022670294e098af.pwrec.gz',
} as const;

export type FixtureName = keyof typeof FIXTURES;

const REPO_ROOT = resolve(import.meta.dirname, '..');

export function fixturesDir(env: NodeJS.ProcessEnv = process.env): string {
  return env['PITWALL_FIXTURES_DIR'] ?? join(REPO_ROOT, 'recordings');
}

/** The recording's path, or `undefined` when the file is not present. */
export function fixturePath(name: FixtureName, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const path = join(fixturesDir(env), FIXTURES[name]);
  return existsSync(path) ? path : undefined;
}

/**
 * Runs `fn` as a suite when the recording is present. Otherwise the suite is skipped
 * with a note, because the recordings are not committed. The body is still collected,
 * so `fn` must not do I/O outside `it`.
 */
export function describeWithFixture(name: FixtureName, title: string, fn: (path: string) => void): void {
  const path = fixturePath(name);
  if (path !== undefined) {
    describe(title, () => fn(path));
    return;
  }
  const expected = join(fixturesDir(), FIXTURES[name]);
  console.info(`[fixtures] skipping "${title}": ${expected} not found (set PITWALL_FIXTURES_DIR)`);
  describe.skip(title, () => fn(expected));
}
