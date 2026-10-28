import { copyFileSync, existsSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';
import { StartupError } from '../../startup-error.ts';
import { dataDir } from '../../storage/data-dir.ts';
import { openDatabase } from '../../storage/db.ts';
import { cliLogger, EXIT_INTERRUPTED, type CliIo } from '../io.ts';
import { processRecording } from '../process-recording.ts';
import { UsageError } from '../usage.ts';

/** `pitwall import <file>`: copies a recording into the data directory and processes it. A file is imported once. */
export async function run(positionals: string[], _values: object, io: CliIo): Promise<number> {
  const [file] = positionals;
  if (file === undefined) throw new UsageError('import needs a recording file');
  const name = basename(file);
  if (!name.endsWith('.pwrec.gz')) throw new StartupError(`${name} is not a .pwrec.gz recording`);
  if (!existsSync(file)) throw new StartupError(`recording ${file} not found`);
  const dirs = dataDir(io.env);
  const target = join(dirs.recordings, name);
  if (existsSync(target)) throw new StartupError(`${name} is already imported`);

  const db = openDatabase(dirs.dbPath);
  try {
    copyFileSync(file, target);
    try {
      await processRecording(target, db, cliLogger(io, 'warn'), io.signal);
    } catch (error) {
      rmSync(target, { force: true }); // a recording that cannot be processed (or was interrupted) is not imported
      if (!io.signal.aborted) throw error;
      io.err('pitwall: interrupted, nothing imported');
      return EXIT_INTERRUPTED;
    }
  } finally {
    db.close();
  }
  io.out(`imported ${name}`);
  return 0;
}
