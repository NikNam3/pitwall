import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '../..');
const depcruise = () => spawnSync('pnpm', ['-s', 'depcruise'], { cwd: ROOT, encoding: 'utf8' });
function withProbe(rel: string, source: string, fn: () => void): void {
  const file = join(ROOT, rel); writeFileSync(file, source);
  try { fn(); } finally { rmSync(file, { force: true }); }
}

describe('dependency-cruiser layer rules', { timeout: 60_000 }, () => {
  it('passes on the clean tree', () => { expect(depcruise().status).toBe(0); });
  it('protocol importing engine fails the build', () => {
    withProbe('packages/protocol/src/probe-layer.ts', "import '../../engine/src/index.ts';\n", () => {
      const r = depcruise();
      expect(r.status).not.toBe(0);
      expect(r.stdout).toContain('protocol-is-leaf');
    });
  });
  it('engine importing bridge fails the build', () => {
    withProbe('packages/engine/src/probe-layer.ts', "import '../../../apps/bridge/src/index.ts';\n", () => {
      expect(depcruise().stdout).toContain('engine-only-protocol-domain');
    });
  });
});

describe('purity lint for engine and strategy', () => {
  const lint = async (rel: string, code: string) =>
    (await new ESLint({ cwd: ROOT }).lintText(code, { filePath: join(ROOT, rel) }))[0]!.messages.map((m) => m.ruleId);
  it('rejects clock and Math.random in engine and strategy', async () => {
    expect(await lint('packages/engine/src/x.ts', 'export const t = Date.now();\n')).toContain('no-restricted-globals');
    expect(await lint('packages/engine/src/x.ts', 'export const t = performance.now();\n')).toContain('no-restricted-globals');
    expect(await lint('packages/strategy/src/x.ts', 'export const r = Math.random();\n')).toContain('no-restricted-properties');
    expect(await lint('packages/engine/src/x.ts', "import { readFileSync } from 'node:fs';\nexport const f = readFileSync;\n")).toContain('no-restricted-imports');
  });
  it('allows them in the bridge', async () => {
    expect(await lint('apps/bridge/src/x.ts', 'export const t = Date.now() + Math.random();\n')).toEqual([]);
  });
});

describe('workspace constraints', () => {
  it('tsconfig.base.json sets the global compiler flags', () => {
    const o = JSON.parse(readFileSync(join(ROOT, 'tsconfig.base.json'), 'utf8')).compilerOptions;
    expect(o).toMatchObject({ strict: true, noUncheckedIndexedAccess: true, exactOptionalPropertyTypes: true, noEmit: true,
      allowImportingTsExtensions: true, erasableSyntaxOnly: true, verbatimModuleSyntax: true, module: 'nodenext' });
  });
  it.each(['protocol', 'domain', 'contracts', 'engine', 'strategy'].map((p) => `packages/${p}`).concat('apps/bridge'))('%s is an ESM package exporting src/index.ts', (dir) => {
    const pkg = JSON.parse(readFileSync(join(ROOT, dir, 'package.json'), 'utf8'));
    expect(pkg).toMatchObject({ type: 'module', exports: { '.': './src/index.ts' } });
    expect(pkg.name).toBe(`@pitwall/${dir === 'apps/bridge' ? 'bridge' : dir.split('/')[1]}`);
  });
});
