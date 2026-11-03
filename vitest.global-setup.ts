// Vitest global setup (contract C84): every test run points `PITWALL_DATA_DIR` at a fresh, empty temporary directory, so
// no test reads the user's data dir (priors, storage). Tests that set it themselves (per test, or in a child's env) still do.
// It also sets `PITWALL_FREEZE_OUTPUTS`: the bridge then has its schedulers freeze every output deep (the engine's
// `freezeOutputs` option), so a unit that changes an output after returning it fails its tests.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export default function setup(): () => void {
  const dir = mkdtempSync(join(tmpdir(), 'pitwall-test-data-'));
  const previous = process.env.PITWALL_DATA_DIR;
  const previousFreeze = process.env.PITWALL_FREEZE_OUTPUTS;
  process.env.PITWALL_DATA_DIR = dir;
  process.env.PITWALL_FREEZE_OUTPUTS = '1';
  return () => {
    if (previousFreeze === undefined) delete process.env.PITWALL_FREEZE_OUTPUTS;
    else process.env.PITWALL_FREEZE_OUTPUTS = previousFreeze;
    if (previous === undefined) delete process.env.PITWALL_DATA_DIR;
    else process.env.PITWALL_DATA_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  };
}
