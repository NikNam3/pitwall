import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DevSupervisor, type SpawnChild } from '../../dev/dev-supervisor.ts';
import { whenAborted, type CliIo } from '../io.ts';
import { UsageError } from '../usage.ts';

type DevFlags = { replay?: string | undefined; 'at-lap'?: string | undefined; 'at-time'?: string | undefined };

const ROOT = new URL('../../../../../', import.meta.url);
/** The source folders whose changes restart the bridge. */
const WATCHED = ['apps/bridge/src', 'packages/engine/src', 'packages/strategy/src', 'packages/domain/src', 'packages/contracts/src'];
const PITWALL = fileURLToPath(new URL('../pitwall.ts', import.meta.url));

const spawnPitwall: SpawnChild = (args) => {
  const child = spawn(process.execPath, [PITWALL, ...args], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
  return {
    onMessage: (cb) => child.on('message', cb),
    onExit: (cb) => child.once('exit', (code) => cb(code)),
    kill: (signal) => child.kill(signal),
  };
};

/** `pitwall dev --replay <file> [--at-lap n | --at-time ms]`: replays a recording and restarts the bridge at the same moment whenever its source changes. */
export async function run(_positionals: string[], values: DevFlags, io: CliIo): Promise<number> {
  const { replay, 'at-lap': atLap, 'at-time': atTime } = values;
  if (replay === undefined) throw new UsageError('dev needs --replay <file>');
  const supervisor = new DevSupervisor({
    file: replay,
    watch: WATCHED.map((dir) => fileURLToPath(new URL(dir, ROOT))),
    spawn: spawnPitwall,
    firstArgs: [...(atLap !== undefined ? ['--at-lap', atLap] : []), ...(atTime !== undefined ? ['--at-time', atTime] : [])],
  });
  supervisor.start();
  await whenAborted(io.signal);
  await supervisor.stop();
  return 0;
}
