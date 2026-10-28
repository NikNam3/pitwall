import { spawnSync } from 'node:child_process';
import { accessSync, constants, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '../..');
const abs = (rel: string) => join(ROOT, rel);
function runHook(script: string, filePath: string, env: Record<string, string> = {}, projectDir = ROOT, toolName = 'Edit') {
  const input = JSON.stringify({ hook_event_name: 'PreToolUse', cwd: projectDir, tool_name: toolName, tool_input: { file_path: filePath } });
  const { PITWALL_WORKER_SCOPE: _s, PITWALL_PHASE: _p, ...base } = process.env;
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

describe('guard-tests.sh', () => {
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
