// The CLI loads the module of the command it runs and no other (`pitwall.ts`). `pitwall tap` is a WebSocket client:
// loading the engine, the analyses and every feature, as the other commands need, doubled its start, and the replay
// tests start a tap per status they read. A resolve hook in the child lists every module of the workspace it loads.
import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { CLI } from '../helpers/cli.ts';

const HOOK = `data:text/javascript,${encodeURIComponent(
  'import { registerHooks } from "node:module";' +
    'registerHooks({ resolve(specifier, context, next) { const r = next(specifier, context);' +
    ' if (!r.url.includes("/node_modules/") && r.url.startsWith("file:")) process.stderr.write(`loaded ${r.url}\\n`); return r; } });',
)}`;

/** The workspace modules the CLI loads for `args`. */
async function loaded(args: string[]): Promise<string[]> {
  const child = spawn(process.execPath, ['--import', HOOK, CLI, ...args], { env: { ...process.env, PITWALL_WS_PORT: '0' } });
  let err = '';
  child.stderr.on('data', (d) => (err += d));
  await new Promise((resolve) => child.once('exit', resolve));
  return [...err.matchAll(/^loaded (\S+)$/gm)].map((m) => m[1]!);
}

describe('pitwall: one command, its modules', { timeout: 30_000 }, () => {
  it('pitwall tap loads neither the engine, the analyses nor the features, nor another command', async () => {
    const modules = await loaded(['tap']);
    expect(modules.some((url) => url.endsWith('/cli/commands/tap.ts'))).toBe(true);
    expect(modules.filter((url) => /\/packages\/(engine|analysis)\/|\/apps\/bridge\/src\/features\//.test(url))).toEqual([]);
    expect(modules.filter((url) => /\/cli\/commands\/(?!tap\.ts)/.test(url))).toEqual([]);
  });

  it('pitwall --help loads no command', async () => {
    expect((await loaded(['--help'])).filter((url) => url.includes('/cli/commands/'))).toEqual([]);
  });
});
