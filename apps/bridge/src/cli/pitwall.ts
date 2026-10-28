#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { StartupError } from '../startup-error.ts';
import { SchemaVersionError } from '../storage/db.ts';
import { run as importRecording } from './commands/import.ts';
import { run as live } from './commands/live.ts';
import { run as replay } from './commands/replay.ts';
import { run as reprocess } from './commands/reprocess.ts';
import { run as tap } from './commands/tap.ts';
import { defaultIo, type CliIo } from './io.ts';
import { USAGE, UsageError } from './usage.ts';

const OPTIONS = {
  realtime: { type: 'boolean' },
  carId: { type: 'string' },
  url: { type: 'string' },
  feed: { type: 'string' },
  weekend: { type: 'string' },
  help: { type: 'boolean', short: 'h' },
} as const;

type Values = ReturnType<typeof parseArgs<{ options: typeof OPTIONS }>>['values'];
type Command = (positionals: string[], values: Values, io: CliIo) => Promise<number>;

const COMMANDS: Record<string, Command> = { live, replay, tap, reprocess, import: importRecording };

/** SQLite codes of a file that is not (or no longer) a database. */
const BROKEN_DATABASE_CODES = ['SQLITE_NOTADB', 'SQLITE_CORRUPT'];

/** The message for a problem the user can act on, or undefined for a bug. */
function startupMessage(error: unknown): string | undefined {
  if (error instanceof StartupError) return error.message;
  if (error instanceof SchemaVersionError) return `${error.message}; run "pitwall reprocess"`;
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && BROKEN_DATABASE_CODES.includes(code)) {
    return 'the database file is not a valid SQLite database; run "pitwall reprocess" to rebuild it';
  }
  return undefined;
}

/** Runs the command line and returns the exit code. */
export async function main(argv: readonly string[], io: CliIo = defaultIo()): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({ args: [...argv], allowPositionals: true, strict: true, options: OPTIONS });
  } catch (error) {
    io.err(`pitwall: ${error instanceof Error ? error.message : String(error)}`);
    io.err(USAGE);
    return 1;
  }
  const [name, ...positionals] = parsed.positionals;
  if (parsed.values.help) {
    io.out(USAGE);
    return 0;
  }
  const command = name === undefined || !Object.hasOwn(COMMANDS, name) ? undefined : COMMANDS[name];
  if (command === undefined) {
    if (name !== undefined) io.err(`pitwall: unknown command "${name}"`);
    io.err(USAGE);
    return 1;
  }
  try {
    return await command(positionals, parsed.values, io);
  } catch (error) {
    if (error instanceof UsageError) {
      io.err(`pitwall: ${error.message}`);
      io.err(USAGE);
      return 1;
    }
    const message = startupMessage(error);
    if (message !== undefined) io.err(`pitwall: ${message}`);
    else io.err(`pitwall: unexpected error (a bug)\n${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
    return 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
