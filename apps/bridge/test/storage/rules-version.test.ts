// The rules version (Task 28; C61, C90): a hash of the source of every module that can change the log, computed, never
// kept by hand. Its sources are every `.ts` file the dependency-cruiser walk reaches from the entries (the step, the
// runner, the frame assembler, the session tracker and the bridge's decision placement, which decides the frame a
// decision fact records: Task a1, F7, ruling R28), through `@pitwall/protocol` and `@pitwall/domain`, the gitignored
// generated indexes the walk reaches included. The version rows change files in a scratch copy of the tree
// in a temp dir, never in the worktree (C84). Every computation runs on a scratch tree with an empty `node_modules` of its
// own, so the walk's cache (`<root>/node_modules/.cache/pitwall/`) is never the worktree's and never shared by two trees.
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { rulesSources, rulesVersion, walkRulesSources } from '../../src/storage/rules-version.ts';

/** The worktree's root. */
const REPO = fileURLToPath(new URL('../../../../', import.meta.url));

const ENTRIES = [
  'packages/engine/src/step/step.ts',
  'packages/engine/src/runner/session-runner.ts',
  'packages/engine/src/frame/assembler.ts',
  'packages/engine/src/frame/session-tracker.ts',
];

/** The bridge's one module that can change the log: where a committed decision lands, by record index (F7, ruling R28). */
const PLACEMENT = 'apps/bridge/src/pipeline/decision-placement.ts';

/** The gitignored generated indexes the walk reaches (M2 N7). */
const GENERATED = [
  'packages/engine/src/situations/index.generated.ts',
  'packages/engine/src/situations/span-tags.generated.ts',
  'packages/domain/src/situations/index.generated.ts',
];

/** Reached files, one per folder area of the walk: protocol, domain, and each engine folder of the four steps. */
const REACHED = [
  'packages/protocol/src/wire.ts',
  'packages/protocol/src/packets/lap-data.ts',
  'packages/protocol/src/schema/codec.ts',
  'packages/domain/src/ids.ts',
  'packages/domain/src/situations/car-status.ts',
  'packages/domain/src/analyses/index.ts',
  'packages/engine/src/frame/assembler.ts',
  'packages/engine/src/frame/session-tracker.ts',
  'packages/engine/src/log/log.ts',
  'packages/engine/src/recorders/laps.ts',
  'packages/engine/src/runner/session-runner.ts',
  'packages/engine/src/runner/snapshots.ts',
  'packages/engine/src/signals/read.ts',
  'packages/engine/src/situations/registry.ts',
  'packages/engine/src/situations/car-status/slots.ts',
  'packages/engine/src/state/live-state.ts',
  'packages/engine/src/step/step.ts',
  'packages/engine/src/step/state-update/timing.ts',
  'packages/engine/src/util/deep-readonly.ts',
];

/** Files no import from the entries reaches: units, the scheduler, the readers' entry, the bridge, tests. */
const OUTSIDE = [
  'packages/engine/src/calc/scheduler.ts',
  'packages/engine/src/util/rng.ts',
  'packages/engine/src/readers.ts',
  'packages/analysis/src/index.ts',
  'packages/contracts/src/index.ts',
  'apps/bridge/src/cli/serve.ts',
  'packages/engine/test/builders/scenario.ts',
];

/** What the scratch copy holds: the root configs, every package and the bridge's source. */
const COPIED = ['package.json', 'pnpm-workspace.yaml', 'tsconfig.json', 'tsconfig.base.json', '.dependency-cruiser.cjs', 'packages', 'apps/bridge/package.json', 'apps/bridge/src'];

/** A package's workspace links (`packages/<pkg>/node_modules/@pitwall/<name>`), kept as the relative links they are. */
const WORKSPACE_LINK = /^packages\/[^/]+\/node_modules(\/@pitwall(\/[^/]+)?)?$/;

const copied = (src: string): boolean => {
  const rel = relative(REPO, src).split(sep).join('/');
  if (rel.split('/').includes('node_modules')) return WORKSPACE_LINK.test(rel);
  return !rel.split('/').some((part) => part.startsWith('.vite') || part === '.stryker-tmp' || part === 'reports');
};

/**
 * A scratch copy of the tree in a temp dir: the files the walk can reach (the gitignored generated indexes as they are
 * in the worktree), each package's workspace links, and an empty root `node_modules` of its own (its cache stays in the
 * temp dir). It has no `.git`.
 */
function scratchTree(): string {
  const root = mkdtempSync(join(tmpdir(), 'rules-version-'));
  for (const path of COPIED) cpSync(join(REPO, path), join(root, path), { recursive: true, verbatimSymlinks: true, filter: copied });
  mkdirSync(join(root, 'node_modules'));
  return root;
}

/** The version of `root` with `path` changed by `change`; the file is restored afterwards. */
async function versionWith(root: string, path: string, change: (file: string) => void): Promise<string> {
  const file = join(root, path);
  const original = readFileSync(file);
  try {
    change(file);
    return await rulesVersion(root);
  } finally {
    writeFileSync(file, original);
  }
}

const appendComment = (file: string): void => appendFileSync(file, '\n// a comment, nothing else\n');

describe('rulesSources: the files of every module that can change the log (C61)', () => {
  // on a scratch copy of the worktree as it is: the same files, so the same sources
  let root: string;
  let sources: string[];
  beforeAll(async () => {
    root = scratchTree();
    sources = await rulesSources(root);
  });

  it('holds the four entries, `packages/domain/src/ids.ts` and `packages/engine/src/util/deep-readonly.ts`, no file of `packages/analysis` and of `apps/` only the decision placement', () => {
    expect(sources).toEqual(expect.arrayContaining([...ENTRIES, 'packages/domain/src/ids.ts', 'packages/engine/src/util/deep-readonly.ts']));
    expect(sources.filter((path) => path.startsWith('packages/analysis/'))).toEqual([]);
    expect(sources.filter((path) => path.startsWith('apps/'))).toEqual([PLACEMENT]);
  });

  it('holds the three generated indexes', () => {
    expect(sources).toEqual(expect.arrayContaining(GENERATED));
  });

  it('is the repo-relative paths of `.ts` source files, sorted, each once; no test file and no node_modules', () => {
    expect(sources).toEqual([...new Set(sources)].sort());
    expect(sources.filter((path) => path !== PLACEMENT && !/^packages\/[a-z-]+\/src\/.+\.ts$/.test(path))).toEqual([]);
    expect(sources.filter((path) => path.includes('node_modules') || path.endsWith('.test.ts'))).toEqual([]);
    expect(sources.filter((path) => !existsSync(join(root, path)))).toEqual([]);
  });

  it('holds every reached file the version rows change, and none of the outside ones', () => {
    expect(sources).toEqual(expect.arrayContaining(REACHED));
    expect(sources.filter((path) => OUTSIDE.includes(path))).toEqual([]);
  });
});

describe('rulesVersion: a sha256 over the sorted paths and contents of rulesSources (C61, C90)', () => {
  let root: string;
  let base: string;
  beforeAll(async () => {
    root = scratchTree();
    base = await rulesVersion(root);
  });

  it('is a sha256, and the same tree gives the same version wherever it lies (the paths are repo-relative)', async () => {
    expect(base).toMatch(/^[0-9a-f]{64}$/);
    expect(await rulesVersion(scratchTree())).toBe(base);
    expect(await rulesVersion(root)).toBe(base);
  });

  it.each(REACHED)('changing %s, a comment included, changes the rules version', async (path) => {
    expect(await versionWith(root, path, appendComment)).not.toBe(base);
    expect(await rulesVersion(root)).toBe(base);
  });

  it.each(OUTSIDE)('changing %s, outside rulesSources, does not change it', async (path) => {
    expect(await versionWith(root, path, appendComment)).toBe(base);
  });

  it('a file no import reaches changes nothing', async () => {
    const path = 'packages/engine/src/step/unreached.ts';
    writeFileSync(join(root, path), 'export const unreached = 1;\n');
    expect(await rulesSources(root)).not.toContain(path);
    expect(await rulesVersion(root)).toBe(base);
  });

  it('the decision placement module is in the rules-version walk', async () => {
    // the bridge places a decision on a frame (live and replay alike), which decides the frame number its fact records
    expect(await walkRulesSources(root)).toContain(PLACEMENT);
    expect(await rulesSources(root)).toContain(PLACEMENT);
    expect(await versionWith(root, PLACEMENT, appendComment)).not.toBe(base);
    expect(await rulesVersion(root)).toBe(base);
  });

  it.each(GENERATED)('the generated index %s, which the walk reaches, changes the version', async (path) => {
    expect(await versionWith(root, path, appendComment)).not.toBe(base);
  });

  // The set follows the code: a module joins it by being imported, also by a type-only import (ruling 1).
  it.each([
    ['an import', 'newly-imported.ts', 'export const newlyImported = 1;\n', "\nexport { newlyImported } from './newly-imported.ts';\n"],
    ['a type-only import', 'type-only.ts', 'export type Only = { only: true };\n', "\nimport type { Only } from './type-only.ts';\nexport type TypeOnly = Only;\n"],
  ])('a file a reached module starts to reach by %s joins rulesSources, and then changing it changes the version', async (_how, name, content, reference) => {
    const path = `packages/engine/src/step/${name}`;
    writeFileSync(join(root, path), content);
    expect(await rulesSources(root)).not.toContain(path);
    const step = join(root, 'packages/engine/src/step/step.ts');
    const original = readFileSync(step);
    try {
      appendFileSync(step, reference);
      expect(await rulesSources(root)).toContain(path);
      const withReference = await rulesVersion(root);
      expect(await versionWith(root, path, appendComment)).not.toBe(withReference);
    } finally {
      writeFileSync(step, original);
    }
  });
});
