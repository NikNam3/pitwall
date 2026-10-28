import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import { feedId } from '@pitwall/domain';
import { loadConfig } from '../../config.ts';
import { PwrecSource } from '../../input/pwrec-source.ts';
import { StartupError } from '../../startup-error.ts';
import { dataDir } from '../../storage/data-dir.ts';
import type { CliIo } from '../io.ts';
import { serve } from '../serve.ts';
import { UsageError } from '../usage.ts';

/** `pitwall replay <file> [--realtime]`: serves a recording as if it were live; nothing is stored. */
export async function run(positionals: string[], values: { realtime?: boolean | undefined }, io: CliIo): Promise<number> {
  const [file] = positionals;
  if (file === undefined) throw new UsageError('replay needs a recording file');
  if (!existsSync(file)) throw new StartupError(`recording ${file} not found`);
  const { wsPort } = loadConfig(io.env);
  const dirs = dataDir(io.env);
  const id = feedId('replay');
  return serve({
    source: new PwrecSource({ feedId: id, path: file, mode: values.realtime ? 'realtime' : 'asFastAsPossible' }),
    feed: { kind: 'replay', label: basename(file) },
    wsPort,
    dumpsDir: dirs.dumps,
    onDone: () => io.err('pitwall: replay finished'),
    io,
  });
}
