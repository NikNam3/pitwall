// Vitest global setup (contract C84): every test run points `PITWALL_DATA_DIR` at a fresh, empty temporary directory, so
// no test reads the user's data dir (priors, storage). Tests that set it themselves (per test, or in a child's env) still do.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export default function setup(): () => void {
  const dir = mkdtempSync(join(tmpdir(), 'pitwall-test-data-'));
  const previous = process.env.PITWALL_DATA_DIR;
  process.env.PITWALL_DATA_DIR = dir;
  return () => {
    if (previous === undefined) delete process.env.PITWALL_DATA_DIR;
    else process.env.PITWALL_DATA_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  };
}
