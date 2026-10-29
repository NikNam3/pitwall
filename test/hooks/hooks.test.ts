import { spawnSync } from 'node:child_process';
import { accessSync, constants, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// Each test runs a hook script in a fresh shell (bash, jq, git); seconds each while `pnpm check` runs every suite.
vi.setConfig({ testTimeout: 30_000 });

const ROOT = resolve(import.meta.dirname, '../..');
const abs = (rel: string) => join(ROOT, rel);
function runHook(script: string, filePath: string, env: Record<string, string> = {}, projectDir = ROOT, toolName = 'Edit') {
  const input = JSON.stringify({ hook_event_name: 'PreToolUse', cwd: projectDir, tool_name: toolName, tool_input: { file_path: filePath } });
  const { PITWALL_WORKER_SCOPE: _s, PITWALL_PHASE: _p, PITWALL_WORKER_UNIT: _u, ...base } = process.env;
  const r = spawnSync(join(ROOT, '.claude/hooks', script), { input, encoding: 'utf8', env: { ...base, CLAUDE_PROJECT_DIR: projectDir, ...env } });
  return { code: r.status, stderr: r.stderr };
}

describe('settings.json', () => {
  it('wires the three hooks to existing executable scripts', () => {
    const s = JSON.parse(readFileSync(abs('.claude/settings.json'), 'utf8'));
    expect(s.hooks.PreToolUse[0].matcher).toBe('Edit|Write|MultiEdit|NotebookEdit');
    expect(s.hooks.PostToolUse[0].matcher).toBe('Edit|Write|MultiEdit');
    const commands: string[] = [...s.hooks.PreToolUse, ...s.hooks.PostToolUse].flatMap((m: { hooks: Array<{ command: string }> }) => m.hooks.map((h) => h.command));
    expect(commands.map((c) => c.split('/').at(-1))).toEqual(['guard-scope.sh', 'guard-tests.sh', 'typecheck.sh']);
    for (const c of commands) accessSync(abs(c.replace('"$CLAUDE_PROJECT_DIR"/', '')), constants.X_OK);
  });
});

describe('guard-scope.sh', () => {
  const scope = { PITWALL_WORKER_SCOPE: 'packages/protocol:apps/bridge/src/pwrec' };
  it('allows everything when PITWALL_WORKER_SCOPE is unset', () => {
    expect(runHook('guard-scope.sh', abs('packages/engine/src/x.ts')).code).toBe(0);
  });
  it('allows files inside any scope folder', () => {
    expect(runHook('guard-scope.sh', abs('packages/protocol/src/decode.ts'), scope).code).toBe(0);
    expect(runHook('guard-scope.sh', abs('apps/bridge/src/pwrec/reader.ts'), scope).code).toBe(0);
  });
  it('blocks a file outside the scope with exit 2 and a reason', () => {
    const r = runHook('guard-scope.sh', abs('packages/engine/src/x.ts'), scope);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('packages/engine/src/x.ts is outside your task scope (packages/protocol:apps/bridge/src/pwrec)');
  });
  it('does not treat a shared prefix as inside', () => {
    expect(runHook('guard-scope.sh', abs('packages/protocolx/a.ts'), scope).code).toBe(2);
  });
  it('blocks paths outside the repository', () => {
    expect(runHook('guard-scope.sh', '/etc/hosts', scope).code).toBe(2);
  });
  it.each(['packages/protocol/package.json', 'pnpm-lock.yaml', 'packages/domain/src/known.ts', 'packages/contracts/src/topics.ts', 'packages/engine/src/state/engine-state.ts'])(
    'blocks supervisor-owned %s even inside the scope', (rel) => {
      const r = runHook('guard-scope.sh', abs(rel), { PITWALL_WORKER_SCOPE: 'packages:pnpm-lock.yaml' });
      expect(r.code).toBe(2);
      expect(r.stderr).toContain('supervisor-owned');
    });
  it('reads notebook_path for NotebookEdit', () => {
    const input = JSON.stringify({ tool_name: 'NotebookEdit', cwd: ROOT, tool_input: { notebook_path: abs('packages/engine/n.ipynb') } });
    const r = spawnSync(abs('.claude/hooks/guard-scope.sh'), { input, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: ROOT, ...scope } });
    expect(r.status).toBe(2);
  });
});

describe('guard-scope.sh with PITWALL_WORKER_UNIT', () => {
  const withUnit = (unit: string) => ({ PITWALL_WORKER_SCOPE: 'docs', PITWALL_WORKER_UNIT: unit });
  it.each([
    'apps/ui/src/widgets/undercut-card/Card.svelte',
    'apps/bridge/src/features/undercut-card/register.ts',
    'apps/bridge/test/features/undercut-card/register.test.ts',
    'packages/analysis/src/undercut-card/calc.ts',
    'packages/analysis/test/undercut-card/calc.test.ts',
    'packages/contracts/src/topics/undercutCard.projection.ts',
    'docs/x.md',
  ])('allows %s for a multi-word unit', (rel) => {
    expect(runHook('guard-scope.sh', abs(rel), withUnit('undercut-card')).code).toBe(0);
  });
  it('uses the topicPrefix camelCase for the contracts file, also for a single-word unit', () => {
    expect(runHook('guard-scope.sh', abs('packages/contracts/src/topics/rejoin.projection.ts'), withUnit('rejoin')).code).toBe(0);
    expect(runHook('guard-scope.sh', abs('apps/ui/src/widgets/rejoin/W.svelte'), withUnit('rejoin')).code).toBe(0);
  });
  it.each([
    'packages/contracts/src/topics/rejoin.projection.ts',
    'packages/contracts/src/topics/undercut-card.projection.ts',
    'packages/contracts/src/topics/undercutCardX.projection.ts',
    'packages/contracts/src/topics.ts',
    'packages/contracts/package.json',
    'apps/ui/src/kit/x.ts',
    'apps/ui/src/widgets/other/x.ts',
    'apps/ui/src/widgets/undercut-cardx/x.ts',
  ])('still blocks %s', (rel) => {
    expect(runHook('guard-scope.sh', abs(rel), withUnit('undercut-card')).code).toBe(2);
  });
  it('does not widen access to another unit\'s contracts file', () => {
    expect(runHook('guard-scope.sh', abs('packages/contracts/src/topics/undercutCard.projection.ts'), withUnit('rejoin')).code).toBe(2);
  });
  it('with the unit alone, restricts writes to the unit\'s paths', () => {
    const unit = { PITWALL_WORKER_UNIT: 'undercut-card' };
    expect(runHook('guard-scope.sh', abs('apps/ui/src/kit/x.ts'), unit).code).toBe(2);
    expect(runHook('guard-scope.sh', abs('docs/x.md'), unit).code).toBe(2);
    expect(runHook('guard-scope.sh', abs('apps/ui/src/widgets/other/x.ts'), unit).code).toBe(2);
    expect(runHook('guard-scope.sh', abs('apps/ui/src/widgets/undercut-card/Card.svelte'), unit).code).toBe(0);
    expect(runHook('guard-scope.sh', abs('apps/bridge/src/features/undercut-card/register.ts'), unit).code).toBe(0);
    expect(runHook('guard-scope.sh', abs('packages/contracts/src/topics/undercutCard.projection.ts'), unit).code).toBe(0);
  });
  it('with the unit alone, still blocks supervisor-owned files', () => {
    const r = runHook('guard-scope.sh', abs('packages/domain/src/known.ts'), { PITWALL_WORKER_UNIT: 'undercut-card' });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('supervisor-owned');
  });
  it.each(['Undercut', 'a b', 'a.*', '../x', 'a/b', '-a', 'a-', 'a--b', '(x'])('rejects the unit name %j (kebab-case only)', (unit) => {
    const r = runHook('guard-scope.sh', abs('apps/ui/src/widgets/x/x.ts'), { PITWALL_WORKER_UNIT: unit, PITWALL_WORKER_SCOPE: 'apps' });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('unit');
  });
  it('allows everything when neither PITWALL_WORKER_SCOPE nor PITWALL_WORKER_UNIT is set', () => {
    expect(runHook('guard-scope.sh', abs('apps/ui/src/kit/x.ts')).code).toBe(0);
  });
});

describe('guard-tests.sh', () => {
  it.each(['apps/ui/src/widgets/undercut-card/x.test.ts', 'apps/ui/src/widgets/undercut-card/gallery.ts'])(
    'blocks widget test file %s when PITWALL_PHASE=implement', (rel) => {
      const r = runHook('guard-tests.sh', abs(rel), { PITWALL_PHASE: 'implement' });
      expect(r.code).toBe(2);
      expect(r.stderr).toContain('PITWALL_PHASE=implement');
    });
  it('allows widget sources and gallery.ts in the test phase', () => {
    expect(runHook('guard-tests.sh', abs('apps/ui/src/widgets/undercut-card/Card.svelte'), { PITWALL_PHASE: 'implement' }).code).toBe(0);
    expect(runHook('guard-tests.sh', abs('apps/ui/src/widgets/undercut-card/gallery.ts'), { PITWALL_PHASE: 'test' }).code).toBe(0);
  });
  it.each(['packages/protocol/src/decode.test.ts', 'packages/engine/test/builders/scenario.ts', 'test-support/fixtures.ts', 'test/hooks/hooks.test.ts'])(
    'blocks %s when PITWALL_PHASE=implement', (rel) => {
      const r = runHook('guard-tests.sh', abs(rel), { PITWALL_PHASE: 'implement' });
      expect(r.code).toBe(2);
      expect(r.stderr).toContain('PITWALL_PHASE=implement');
    });
  it('allows source files in the implement phase and tests in the test phase', () => {
    expect(runHook('guard-tests.sh', abs('packages/protocol/src/decode.ts'), { PITWALL_PHASE: 'implement' }).code).toBe(0);
    expect(runHook('guard-tests.sh', abs('packages/protocol/src/latest.ts'), { PITWALL_PHASE: 'implement' }).code).toBe(0);
    expect(runHook('guard-tests.sh', abs('packages/protocol/src/decode.test.ts'), { PITWALL_PHASE: 'test' }).code).toBe(0);
    expect(runHook('guard-tests.sh', abs('packages/protocol/src/decode.test.ts')).code).toBe(0);
  });
});

// Real tsc runs (up to three per test) do not fit the 5 s default while the whole suite runs in parallel.
describe('typecheck.sh', { timeout: 30_000 }, () => {
  function tempPackage(source: string): { root: string; file: string } {
    const root = mkdtempSync(join(tmpdir(), 'pitwall-hook-'));
    const pkg = join(root, 'packages/demo');
    mkdirSync(join(pkg, 'src'), { recursive: true });
    writeFileSync(join(pkg, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, noEmit: true, types: [] }, include: ['src'] }));
    writeFileSync(join(pkg, 'src/a.ts'), source);
    return { root, file: join(pkg, 'src/a.ts') };
  }
  it('reports a type error in the touched package with exit 2', () => {
    const { root, file } = tempPackage('export const n: number = "x";\n');
    const r = runHook('typecheck.sh', file, {}, root, 'Write');
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('typecheck failed in packages/demo');
    expect(r.stderr).toContain('TS2322');
  });
  it('passes a clean package and ignores non-TS files and files outside a package', () => {
    const { root, file } = tempPackage('export const n: number = 1;\n');
    expect(runHook('typecheck.sh', file, {}, root, 'Write').code).toBe(0);
    expect(runHook('typecheck.sh', join(root, 'packages/demo/README.md'), {}, root, 'Write').code).toBe(0);
    expect(runHook('typecheck.sh', join(root, 'notes.ts'), {}, root, 'Write').code).toBe(0);
  });
});
