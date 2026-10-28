#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { cutRecords } from '../pwrec/cut.ts';
import { readPwrec } from '../pwrec/reader.ts';
import type { PwrecMeta, PwrecRecord, PwrecSummary } from '../pwrec/types.ts';
import { PwrecWriter } from '../pwrec/writer.ts';

const USAGE = 'usage: pwrec-cut <in.pwrec.gz> <out.pwrec.gz> --from <sessionTimeS> --to <sessionTimeS>';

export interface CliIo {
  out(line: string): void;
  err(line: string): void;
}

const consoleIo: CliIo = { out: (line) => console.log(line), err: (line) => console.error(line) };

type Args = { input: string; output: string; fromS: number; toS: number };

function parseSeconds(text: string | undefined): number | undefined {
  if (text === undefined || text.trim() === '') return undefined;
  const seconds = Number(text);
  return Number.isFinite(seconds) ? seconds : undefined;
}

function parseCliArgs(argv: readonly string[]): Args | undefined {
  try {
    const { values, positionals } = parseArgs({
      args: [...argv],
      allowPositionals: true,
      strict: true,
      options: { from: { type: 'string' }, to: { type: 'string' } },
    });
    const [input, output] = positionals;
    const fromS = parseSeconds(values.from);
    const toS = parseSeconds(values.to);
    if (positionals.length !== 2 || input === undefined || output === undefined) return undefined;
    return fromS === undefined || toS === undefined ? undefined : { input, output, fromS, toS };
  } catch {
    return undefined;
  }
}

/** Streams the records of `input` and hands the file summary (the metadata) back through `summary`. */
async function* readWithSummary(input: string, summary: { value?: PwrecSummary }): AsyncGenerator<PwrecRecord> {
  summary.value = yield* readPwrec(input);
}

function cutMeta(meta: PwrecMeta, { input, fromS, toS }: Args, firstT: number, contextPackets: number): PwrecMeta {
  return {
    ...meta,
    startedAt: new Date(Date.parse(meta.startedAt) + Math.round(firstT)).toISOString(),
    cut: { source: basename(input), fromS, toS, contextPackets },
  };
}

/** `pwrec-cut <in> <out> --from <s> --to <s>`: copies the records in a session time window into a new recording. */
export async function main(argv: readonly string[], io: CliIo = consoleIo): Promise<number> {
  const fail = (message: string): number => {
    io.err(`pwrec-cut: ${message}`);
    return 1;
  };
  const args = parseCliArgs(argv);
  if (args === undefined) return fail(USAGE);
  const { input, output, fromS, toS } = args;
  if (fromS > toS) return fail(`--from ${fromS} is after --to ${toS}`);
  if (existsSync(output)) return fail(`${output} already exists`);

  const source: { value?: PwrecSummary } = {};
  try {
    const cut = await cutRecords(readWithSummary(input, source), { fromS, toS });
    if (cut.firstT === undefined || source.value === undefined) {
      return fail(`no records with sessionTime in [${fromS}, ${toS}] s`);
    }
    const writer = PwrecWriter.create(output, cutMeta(source.value.meta, args, cut.firstT, cut.contextPackets));
    for (const { t, payload } of cut.records) writer.write(t, payload);
    await writer.close(cut.durationMs);
    io.out(`wrote ${output}: ${cut.records.length} records (${cut.contextPackets} context), ${cut.durationMs} ms`);
    return 0;
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
