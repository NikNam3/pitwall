// The simulator dependency rule (C50; SP4.3a Task 5): a simulator unit (`packages/analysis/src/<simulator>/`, the
// folders whose `index.ts` exports a `SIMULATOR` marker, listed in the generated `simulators.generated.ts`) is
// imported only from the analysis package (its units, `shared/forecast-field`, job modules and its tests), never
// from `apps/`, `packages/engine` or `packages/contracts`. Rule name: `simulators-only-from-analyses-and-jobs`.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..');
const RULE = 'simulators-only-from-analyses-and-jobs';
const LEAF = readFileSync(join(import.meta.dirname, 'fixtures', 'depcruise', 'leaf.ts.txt'), 'utf8');

interface Violation { rule: { name: string }; from: string; to: string }

let sandbox: string | undefined;
afterEach(() => {
  if (sandbox) rmSync(sandbox, { recursive: true, force: true });
  sandbox = undefined;
});

/**
 * Places a leaf module at `target` and a probe at `entry` that imports it, both repo-relative, in a fresh temp
 * directory (nothing is written into the repo, so a parallel repo-wide depcruise never sees them).
 */
function place(entry: string, target: string): string {
  sandbox = mkdtempSync(join(tmpdir(), 'pitwall-simulator-rule-'));
  writeFileSync(join(sandbox, 'tsconfig.json'), JSON.stringify({ compilerOptions: { allowImportingTsExtensions: true, noEmit: true, module: 'nodenext' } }));
  if (existsSync(join(ROOT, 'node_modules'))) symlinkSync(join(ROOT, 'node_modules'), join(sandbox, 'node_modules'), 'dir');
  const write = (rel: string, source: string) => {
    const file = join(sandbox!, rel);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, source);
  };
  write(target, LEAF);
  const spec = relative(dirname(entry), target).split('\\').join('/');
  write(entry, `import '${spec.startsWith('.') ? spec : `./${spec}`}';\n`);
  return sandbox;
}

/** Runs the repo's depcruise config on the probe entry and returns every violation. */
function cruise(cwd: string, entry: string): Violation[] {
  const r = spawnSync('pnpm', ['exec', 'depcruise', '--config', join(ROOT, '.dependency-cruiser.cjs'), '--output-type', 'json', entry], {
    cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  return (JSON.parse(r.stdout) as { summary: { violations: Violation[] } }).summary.violations;
}
const hits = (entry: string, target: string) =>
  cruise(place(entry, target), entry).filter((v) => v.rule.name === RULE && v.from === entry && v.to === target);

const LAP_MODEL = 'packages/analysis/src/lap-model/leaf.ts';
const RACE_FORECAST = 'packages/analysis/src/race-forecast/leaf.ts';

describe(`depcruise ${RULE}`, { timeout: 120_000 }, () => {
  it.each([
    ['apps/bridge/src/__probe__/x.ts', LAP_MODEL],
    ['apps/bridge/src/__probe__/x.ts', RACE_FORECAST],
    ['apps/bridge/src/jobs/__probe__.ts', RACE_FORECAST],
    ['apps/ui/src/__probe__/x.ts', LAP_MODEL],
    ['packages/engine/src/__probe__/x.ts', LAP_MODEL],
    ['packages/contracts/src/__probe__/x.ts', RACE_FORECAST],
  ])('rejects %s importing %s', (entry, target) => {
    expect(hits(entry, target)).not.toEqual([]);
  });

  it.each([
    ['packages/analysis/src/__probe__/x.ts', LAP_MODEL],
    ['packages/analysis/src/shared/forecast-field/__probe__.ts', LAP_MODEL],
    ['packages/analysis/src/shared/forecast-field/__probe__.ts', RACE_FORECAST],
    ['packages/analysis/src/forecast-score/job.ts', RACE_FORECAST],
    ['packages/analysis/src/race-forecast/__probe__.ts', LAP_MODEL],
    ['packages/analysis/test/race-forecast/__probe__.ts', RACE_FORECAST],
  ])('accepts %s importing %s', (entry, target) => {
    expect(hits(entry, target)).toEqual([]);
  });

  it('leaves analysis units that are no simulator alone: the bridge may import them', () => {
    expect(hits('apps/bridge/src/__probe__/x.ts', 'packages/analysis/src/degradation/leaf.ts')).toEqual([]);
  });
});
