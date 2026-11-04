// The rules sources walk is cached by a content key (Task 28 fix round 1; C61, C90). The dependency-cruiser walk costs
// about 1.4 s per start, so its file list is cached in `<root>/node_modules/.cache/pitwall/rules-sources.json`, keyed by
// a content hash of every `.ts` file under `packages/{protocol,domain,engine}/src` (the generated indexes included). On
// a hit the walk is skipped; the version is still the sha256 of the walked files' contents, computed every time.
// The walk is observed through the injected walker `{ walk }` (default `walkRulesSources`, the uncached walk). Every
// tree here is a scratch copy in a temp dir with a `node_modules` of its own, so no cache is shared (C84).
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { rulesSources, rulesVersion, walkRulesSources } from '../../src/storage/rules-version.ts';

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
const CACHE = 'node_modules/.cache/pitwall/rules-sources.json';

/** What the scratch copy holds: the root configs, every package and the bridge's source. */
const COPIED = ['package.json', 'pnpm-workspace.yaml', 'tsconfig.json', 'tsconfig.base.json', '.dependency-cruiser.cjs', 'packages', 'apps/bridge/package.json', 'apps/bridge/src'];
/** A package's workspace links (`packages/<pkg>/node_modules/@pitwall/<name>`), kept as the relative links they are. */
const WORKSPACE_LINK = /^packages\/[^/]+\/node_modules(\/@pitwall(\/[^/]+)?)?$/;
const copied = (src: string): boolean => {
  const rel = relative(REPO, src).split(sep).join('/');
  if (rel.split('/').includes('node_modules')) return WORKSPACE_LINK.test(rel);
  return !rel.split('/').some((part) => part.startsWith('.vite') || part === '.stryker-tmp' || part === 'reports');
};

/** A scratch copy of the tree with an empty `node_modules` of its own, so its cache is its own. */
function scratchTree(): string {
  const root = mkdtempSync(join(tmpdir(), 'rules-cache-'));
  for (const path of COPIED) cpSync(join(REPO, path), join(root, path), { recursive: true, verbatimSymlinks: true, filter: copied });
  mkdirSync(join(root, 'node_modules'));
  return root;
}

/** Sources the walk reaches: protocol, domain, an entry, a sub-machine and the generated indexes. */
const SOURCES = [
  'packages/protocol/src/wire.ts',
  'packages/domain/src/ids.ts',
  'packages/engine/src/step/step.ts',
  'packages/engine/src/situations/car-status/slots.ts',
  'packages/engine/src/situations/index.generated.ts',
  'packages/engine/src/situations/span-tags.generated.ts',
  'packages/domain/src/situations/index.generated.ts',
];
/** Files under the keyed package dirs that the walk does not reach. */
const KEYED_NOT_SOURCES = ['packages/engine/src/calc/scheduler.ts', 'packages/engine/src/util/rng.ts', 'packages/engine/src/readers.ts'];
/** Files outside the keyed package dirs. */
const UNKEYED = ['packages/analysis/src/index.ts', 'apps/bridge/src/cli/serve.ts', 'packages/engine/test/builders/scenario.ts'];

const appendComment = (file: string): void => appendFileSync(file, '\n// a comment, nothing else\n');

describe('rulesSources: the walk is cached by a content key', () => {
  let root: string;
  /** The version of the untouched tree, computed without a cache. */
  let base: string;
  const walk = vi.fn(walkRulesSources);

  beforeAll(async () => {
    root = scratchTree();
    base = await rulesVersion(root, { walk });
  });

  /** A computation on a warm cache: the walk count is reset first. */
  async function warm(): Promise<void> {
    await rulesVersion(root, { walk });
    walk.mockClear();
  }

  /** The version of `root` with `path` changed by appending a comment, and whether the walk ran; restored afterwards. */
  async function versionWithComment(path: string): Promise<{ version: string; walked: number }> {
    await warm();
    const file = join(root, path);
    const original = readFileSync(file);
    try {
      appendComment(file);
      const version = await rulesVersion(root, { walk });
      return { version, walked: walk.mock.calls.length };
    } finally {
      writeFileSync(file, original);
    }
  }

  it('the first computation walks and writes the cache file; a second with an unchanged tree does not walk', async () => {
    const fresh = scratchTree();
    const counted = vi.fn(walkRulesSources);
    const first = await rulesVersion(fresh, { walk: counted });
    expect(counted).toHaveBeenCalledOnce();
    expect(existsSync(join(fresh, CACHE))).toBe(true);
    expect(await rulesVersion(fresh, { walk: counted })).toBe(first);
    expect(await rulesSources(fresh, { walk: counted })).toEqual(await walkRulesSources(fresh));
    expect(counted).toHaveBeenCalledOnce();
  });

  it('the cached and uncached versions are equal', async () => {
    await warm();
    expect(await rulesVersion(root, { walk })).toBe(base);
    expect(walk).not.toHaveBeenCalled();
    // a tree that never had a cache
    expect(await rulesVersion(scratchTree())).toBe(base);
    expect(await rulesSources(root, { walk })).toEqual(await walkRulesSources(root));
    expect(walk).not.toHaveBeenCalled();
  });

  it.each(SOURCES)('changing the source %s, a comment included, re-runs the walk and changes the version', async (path) => {
    const { version, walked } = await versionWithComment(path);
    expect(walked).toBe(1);
    expect(version).not.toBe(base);
  });

  it.each(KEYED_NOT_SOURCES)('changing %s, under the keyed dirs but no source, re-runs the walk and leaves the version', async (path) => {
    const { version, walked } = await versionWithComment(path);
    expect(walked).toBe(1);
    expect(version).toBe(base);
  });

  it.each(UNKEYED)('changing %s, outside the keyed dirs, neither walks nor changes the version', async (path) => {
    const { version, walked } = await versionWithComment(path);
    expect(walked).toBe(0);
    expect(version).toBe(base);
  });

  it('a new file under the keyed dirs re-runs the walk', async () => {
    await warm();
    const path = join(root, 'packages/engine/src/step/unreached.ts');
    writeFileSync(path, 'export const unreached = 1;\n');
    try {
      expect(await rulesVersion(root, { walk })).toBe(base);
      expect(walk).toHaveBeenCalledOnce();
    } finally {
      rmSync(path);
    }
  });

  it('after a change and its revert, the version is the base one again', async () => {
    await versionWithComment('packages/engine/src/step/step.ts');
    expect(await rulesVersion(root, { walk })).toBe(base);
  });

  it('a missing cache file re-runs the walk, and the version is the same', async () => {
    await warm();
    rmSync(join(root, CACHE));
    expect(await rulesVersion(root, { walk })).toBe(base);
    expect(walk).toHaveBeenCalledOnce();
    // the walk wrote the cache again
    expect(await rulesVersion(root, { walk })).toBe(base);
    expect(walk).toHaveBeenCalledOnce();
  });

  it.each([
    ['not JSON', 'not json {'],
    ['JSON of another shape', JSON.stringify({ hello: 'world' })],
    ['an empty file', ''],
  ])('a corrupt cache file (%s) re-runs the walk, and the version is the same', async (_what, content) => {
    await warm();
    mkdirSync(dirname(join(root, CACHE)), { recursive: true });
    writeFileSync(join(root, CACHE), content);
    expect(await rulesVersion(root, { walk })).toBe(base);
    expect(walk).toHaveBeenCalledOnce();
  });
});
