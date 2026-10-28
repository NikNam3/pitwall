import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import { feedId } from '@pitwall/domain';
import { loadConfig } from '../../config.ts';
import { loadFeatureConfig, recordingConfig } from '../../feature-config.ts';
import { FEATURES } from '../../features/index.generated.ts';
import { PwrecSource } from '../../input/pwrec-source.ts';
import { StartupError } from '../../startup-error.ts';
import { dataDir } from '../../storage/data-dir.ts';
import { cliLogger, type CliIo } from '../io.ts';
import { serve } from '../serve.ts';
import { UsageError } from '../usage.ts';

/** `pitwall replay <file> [--realtime] [--dev]`: serves a recording as if it were live with its own config (`<file>.config.json`) if it has one; nothing is stored. */
export async function run(positionals: string[], values: { realtime?: boolean | undefined; dev?: boolean | undefined }, io: CliIo): Promise<number> {
  const [file] = positionals;
  if (file === undefined) throw new UsageError('replay needs a recording file');
  if (!existsSync(file)) throw new StartupError(`recording ${file} not found`);
  const { wsPort } = loadConfig(io.env);
  const dirs = dataDir(io.env);
  // The config the recording ran with if it has one, else the current one; fixed for the run (a runtime change from the UI comes later).
  const config = recordingConfig(file, FEATURES, loadFeatureConfig(dirs.root, FEATURES), cliLogger(io, 'warn'));
  const id = feedId('replay');
  return serve({
    source: new PwrecSource({ feedId: id, path: file, mode: values.realtime ? 'realtime' : 'asFastAsPossible' }),
    feed: { kind: 'replay', label: basename(file) },
    wsPort,
    dumpsDir: dirs.dumps,
    uiDir: dirs.ui,
    config,
    onDone: () => io.err('pitwall: replay finished'),
    ...(values.dev && { dev: true }),
    io,
  });
}
