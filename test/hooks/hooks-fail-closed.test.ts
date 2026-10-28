import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '../..');
const GUARDS = ['guard-scope.sh', 'guard-tests.sh'];

function runGuard(script: string, stdin: string, env: Record<string, string>) {
  const { PITWALL_WORKER_SCOPE: _s, PITWALL_PHASE: _p, ...base } = process.env;
  const r = spawnSync(join(ROOT, '.claude/hooks', script), {
    input: stdin,
    encoding: 'utf8',
    maxBuffer: 1 << 20,
    env: { ...base, CLAUDE_PROJECT_DIR: ROOT, ...env },
  });
  return { code: r.status, stderr: r.stderr };
}

describe('PreToolUse guards fail closed', () => {
  it.each(GUARDS)('%s blocks a payload that is not JSON', (script) => {
    const env = { PITWALL_WORKER_SCOPE: 'packages/protocol', PITWALL_PHASE: 'implement' };
    expect(runGuard(script, 'not json', env).code).toBe(2);
  });
  it.each(GUARDS)('%s blocks an empty payload', (script) => {
    const env = { PITWALL_WORKER_SCOPE: 'packages/protocol', PITWALL_PHASE: 'implement' };
    expect(runGuard(script, '', env).code).toBe(2);
  });
});

describe('guards handle large payloads', () => {
  const big = (rel: string) =>
    JSON.stringify({ tool_name: 'Write', cwd: ROOT, tool_input: { file_path: join(ROOT, rel), content: 'x'.repeat(200_000) } });

  it('guard-scope.sh blocks a 200 KB write outside the scope', () => {
    const r = runGuard('guard-scope.sh', big('packages/engine/src/big.ts'), { PITWALL_WORKER_SCOPE: 'packages/protocol' });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('is outside your task scope');
  });
  it('guard-scope.sh allows a 200 KB write inside the scope', () => {
    expect(runGuard('guard-scope.sh', big('packages/protocol/src/big.ts'), { PITWALL_WORKER_SCOPE: 'packages/protocol' }).code).toBe(0);
  });
  it('guard-tests.sh blocks a 200 KB write to a test file in the implement phase', () => {
    expect(runGuard('guard-tests.sh', big('packages/protocol/src/big.test.ts'), { PITWALL_PHASE: 'implement' }).code).toBe(2);
  });
});
