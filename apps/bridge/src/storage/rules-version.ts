// The rules version (C61, C90): a hash of the source of every module that can change the log, computed, never kept
// by hand.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cruise } from 'dependency-cruiser';

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
 * (gitignored, so no git state is consulted).
 */
export async function rulesSources(root: string): Promise<string[]> {
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

/** The sha256 over the paths and contents of `rulesSources(root)`, in their order. */
export async function rulesVersion(root: string): Promise<string> {
  const hash = createHash('sha256');
  for (const path of await rulesSources(root)) {
    hash.update(path).update('\0').update(await readFile(join(root, path))).update('\0');
  }
  return hash.digest('hex');
}
