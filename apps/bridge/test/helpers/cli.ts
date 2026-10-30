import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach } from 'vitest';
export const CLI = fileURLToPath(new URL('../../src/cli/pitwall.ts', import.meta.url));
export const SEGMENT = fileURLToPath(new URL('../../../../fixtures/segments/race-zandvoort-lap10.pwrec.gz', import.meta.url));
/** Every child started and not yet exited: a test that times out or throws must not leave a bridge running. */
const running = new Set<ChildProcess>();
const killAll = (): void => { for (const child of running) child.kill('SIGKILL'); running.clear(); };
afterEach(killAll);
process.once('exit', killAll);

export function startCli(args: string[], env: Record<string, string>) {
  const child = spawn(process.execPath, [CLI, ...args], { env: { ...process.env, ...env } });
  running.add(child); child.once('exit', () => running.delete(child));
  let out = '', err = '';
  child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { err += d; });
  const exited = new Promise<number | null>((r) => child.once('exit', (c) => r(c)));
  const waitFor = async (re: RegExp, ms = 10_000) => { const t0 = Date.now();
    while (Date.now() - t0 < ms) { const m = out.match(re); if (m) return m; await new Promise((r) => setTimeout(r, 20)); }
    child.kill('SIGKILL');
    throw new Error(`timeout waiting for ${re}; stdout=${out} stderr=${err}`); };
  return { child, exited, waitFor, stdout: () => out, stderr: () => err, stop: () => { child.kill('SIGTERM'); return exited; } };
}
export async function runCli(args: string[], env: Record<string, string> = {}) {
  const c = startCli(args, env); const code = await c.exited; return { code, stdout: c.stdout(), stderr: c.stderr() };
}
