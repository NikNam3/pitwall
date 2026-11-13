// The good-selection reference's source hash (SP4.3b spec §7.4; plan 4.3b1 Task 20b step 1): sha256 over
// `packages/analysis/src/**` (tests excluded) and `test-support/race-generator/**`, so a change to the model or the
// generator makes the stored reference stale and a change to a test does not.
//
// How these tests read the script (the test agent's decisions, Task 20b report): `strategyReferenceHash(root?)` hashes
// the two trees under `root` (default the repo root) by their paths relative to `root` and their contents; a test file
// (`*.test.ts`) is excluded wherever it lies. Temporary copies of the two trees, so the repo is never touched.
import { appendFileSync, cpSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { strategyReferenceHash } from './gen-strategy-reference.ts';

const ROOT = join(import.meta.dirname, '..');

/** A temporary root with copies of the hashed trees and of `packages/analysis/test`. */
function copy(): string {
  const root = mkdtempSync(join(tmpdir(), 'strategy-reference-'));
  for (const dir of ['packages/analysis/src', 'packages/analysis/test', 'test-support/race-generator']) cpSync(join(ROOT, dir), join(root, dir), { recursive: true });
  return root;
}

describe('strategyReferenceHash', () => {
  it('strategyReferenceHash changes when a source under packages/analysis/src or the generator changes, not when a test file changes', () => {
    const root = copy();
    const base = strategyReferenceHash(root);
    expect(base).toMatch(/^[0-9a-f]{64}$/);
    // by relative paths: a copy hashes as the repo does
    expect(strategyReferenceHash()).toBe(base);

    // a test file: in the analysis package's tests, in the generator's folder, a new one
    appendFileSync(join(root, 'packages/analysis/test/strategy/strategy.test.ts'), '\n// edited\n');
    appendFileSync(join(root, 'test-support/race-generator/generator.test.ts'), '\n// edited\n');
    writeFileSync(join(root, 'packages/analysis/test/strategy/new.test.ts'), 'export {};\n');
    expect(strategyReferenceHash(root)).toBe(base);

    // a source under packages/analysis/src (a comment counts)
    appendFileSync(join(root, 'packages/analysis/src/race-monte-carlo/search.ts'), '\n// edited\n');
    const afterSource = strategyReferenceHash(root);
    expect(afterSource).not.toBe(base);

    // a generator source
    appendFileSync(join(root, 'test-support/race-generator/simulate.ts'), '\n// edited\n');
    const afterGenerator = strategyReferenceHash(root);
    expect(afterGenerator).not.toBe(afterSource);

    // a new source file
    writeFileSync(join(root, 'packages/analysis/src/strategy/extra.ts'), 'export const x = 1;\n');
    expect(strategyReferenceHash(root)).not.toBe(afterGenerator);
  });
});
