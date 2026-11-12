import type { CliIo } from '../io.ts';

/**
 * `pitwall score <recording> [--json <file>] [--compare <old.json>]` (SP4.3a spec 7.2): reprocesses the recording as
 * `pitwall reprocess` does, its sidecars included, waits for the `forecastScore.report` job result of the final leader
 * lap and prints the tables; stores nothing (C32).
 */
export async function run(_positionals: string[], _values: { json?: string | undefined; compare?: string | undefined }, _io: CliIo): Promise<number> {
  throw new Error('not implemented');
}
