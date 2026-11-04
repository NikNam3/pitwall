// The rules version (C61, C90): a hash of the source of every module that can change the log, computed, never kept
// by hand.
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The root of the tree this bridge runs from. */
export const SOURCE_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

/**
 * The modules that can change the log, each with everything it imports: the four steps (with their sub-machines and
 * recorders, and the log), the runner, frame assembly and its session tracker. Protocol decoding is reached through
 * frame assembly.
 */
const ENTRIES = [
  'packages/engine/src/step/step.ts',
  'packages/engine/src/runner/session-runner.ts',
  'packages/engine/src/frame/assembler.ts',
  'packages/engine/src/frame/session-tracker.ts',
];

/**
 * Every `.ts` file the import walk from the entries reaches under `root`, through `@pitwall/protocol` and
 * `@pitwall/domain`: repo-relative, sorted. Type-only imports count, and so do the generated indexes the walk reaches
 * (gitignored, so no git state is consulted). Uncached; dependency-cruiser is loaded only here.
 */
export async function walkRulesSources(root: string): Promise<string[]> {
  const { cruise } = await import('dependency-cruiser');
  const result = await cruise(ENTRIES, {
    baseDir: root,
    tsPreCompilationDeps: true,
    doNotFollow: { path: 'node_modules' },
    enhancedResolveOptions: { exportsFields: ['exports'], conditionNames: ['import', 'default'], extensions: ['.ts', '.js'] },
  });
  if (typeof result.output === 'string') throw new Error('dependency-cruiser returned a report, not a cruise result');
  const sources = result.output.modules.map((m) => m.source).filter((source) => source.endsWith('.ts') && !source.split('/').includes('node_modules'));
  return [...new Set(sources)].sort();
}

/** The folders whose `.ts` files are the cache key: every file the walk can reach lies in them. */
const KEYED = ['packages/protocol/src', 'packages/domain/src', 'packages/engine/src'];
/** Where the walk's file list is cached, under the tree's root. */
const CACHE = 'node_modules/.cache/pitwall/rules-sources.json';

type RulesOptions = {
  /** The walk run on a cache miss. Default: `walkRulesSources`. */
  walk?: (root: string) => Promise<string[]>;
};
type CacheEntry = { key: string; sources: string[] };

const repoPath = (root: string, file: string): string => relative(root, file).split(sep).join('/');

/** A content hash of every `.ts` file under the keyed folders (the generated indexes included), with its path. */
async function cacheKey(root: string): Promise<string> {
  const paths: string[] = [];
  for (const dir of KEYED) {
    const entries = await readdir(join(root, dir), { recursive: true, withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.ts')) paths.push(repoPath(root, join(entry.parentPath, entry.name)));
    }
  }
  const hash = createHash('sha256');
  for (const path of paths.sort()) hash.update(path).update('\0').update(await readFile(join(root, path))).update('\0');
  return hash.digest('hex');
}

/** The cached entry, or `undefined` when the file is missing or not a cache entry. */
async function readCache(file: string): Promise<CacheEntry | undefined> {
  try {
    const entry: unknown = JSON.parse(await readFile(file, 'utf8'));
    if (typeof entry !== 'object' || entry === null) return undefined;
    const { key, sources } = entry as Partial<CacheEntry>;
    if (typeof key !== 'string' || !Array.isArray(sources) || !sources.every((s) => typeof s === 'string')) return undefined;
    return { key, sources };
  } catch {
    return undefined;
  }
}

/** Writes the entry atomically (a temp file, then a rename), so parallel runs on one tree never read a partial file. */
async function writeCache(file: string, entry: CacheEntry): Promise<void> {
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(temp, JSON.stringify(entry));
    await rename(temp, file);
  } catch {
    // a cache that cannot be written is only a slower next start
    await rm(temp, { force: true });
  }
}

/**
 * `walkRulesSources(root)`, cached in `<root>/node_modules/.cache/pitwall/rules-sources.json` by a content key of the
 * keyed folders: on a hit the walk (and dependency-cruiser) is skipped. A missing or corrupt cache walks again. A walk
 * that reaches a file outside the keyed folders is not cached, since the key would not cover it.
 */
export async function rulesSources(root: string, opts: RulesOptions = {}): Promise<string[]> {
  const file = join(root, CACHE);
  const key = await cacheKey(root);
  const cached = await readCache(file);
  if (cached?.key === key) return cached.sources;
  const sources = await (opts.walk ?? walkRulesSources)(root);
  if (sources.every((path) => KEYED.some((dir) => path.startsWith(`${dir}/`)))) await writeCache(file, { key, sources });
  return sources;
}

/** The sha256 over the paths and contents of `rulesSources(root)`, in their order, computed every time (C90). */
export async function rulesVersion(root: string, opts: RulesOptions = {}): Promise<string> {
  const hash = createHash('sha256');
  for (const path of await rulesSources(root, opts)) {
    hash.update(path).update('\0').update(await readFile(join(root, path))).update('\0');
  }
  return hash.digest('hex');
}
