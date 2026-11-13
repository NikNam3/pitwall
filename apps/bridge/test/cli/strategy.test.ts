// `pitwall strategy <recording> --at-lap n [--car id] [--json <file>]` (SP4.3b spec §8.3, plan 4.3b1 Task 21; C32, C38,
// C58, C84): it reprocesses the recording as `pitwall score` does, up to the frame of our car's crossing of lap n (the
// frame its lap n is completed on; `--car` default: the player car), with `strategy.plans` subscribed, waits for that
// frame's job result and prints per our car its ranked rows and the run's metadata. `--json` writes the
// `StrategyOutput`. It stores nothing: the data dir it is given holds only the test's `config.json` afterwards. No
// result: an empty report, exit 0 (R50).
//
// Speed (SP4.3b2 Task 18c): every row runs with small caps through `<data dir>/config.json` (C47), and on the 0.5 MB
// segment `race-zandvoort-lap10` (C84), not the 7.8 MB full lap: each run reprocesses the whole segment (a lap beyond
// the race reads it to its end), so the segment's length is the file's time.
//
// The segment: `race-zandvoort-lap10`, car 1 the player (teammate 4), its lap 9 completed at 723.381, the segment's
// only crossing of car 1. No committed segment holds enough of a race for the real job to rank a policy (each car's
// estimates need the laps before the segment), so rows 1 and 2 stand in for the job's worker module with
// `strategy-stub-job.ts` (a fixed output: ranked rows for car 1, `insufficientData` for car 4). For that the command
// module exports `run(positionals, values, io, features?)`, `features` defaulting to the generated feature index; the
// tests replace the `strategy` job's `module` and keep everything else (its `prepare`, its trigger, its binding).
// Rows 3 and 4 run the real job through `main`.
//
// The printed shape these tests pin: per our car an unindented heading `car <id>`; under it indented lines. A ranked
// car has one metadata line holding `scenarios <n>` and `candidates <n>`, and one line per row in rank order, each
// starting with its rank (1, 2, …) and then its source, and holding: each stop as `L<lap> <compound>`, each trigger by
// its kind, `E[pos] <2 decimals>`, `E[points] <2 decimals>`, the position pmf as `pmf ` and the whole percentages
// (P1 first) separated by single spaces, the word `tie` only on a tied row and the word `committed` only on the
// committed row. A car without a result has one indented line holding its reason. An empty report has no car heading.
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { carId, type StrategyOutput } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import type { Feature } from '../../src/features/feature.ts';
import { FEATURES } from '../../src/features/index.generated.ts';
import type { CliIo } from '../../src/cli/io.ts';
import { main } from '../../src/cli/pitwall.ts';
import { segmentPath } from '../fixtures/replay.ts';
import { STUB_META, STUB_ROWS, stubOutput } from './strategy-stub-job.ts';

/** Car 1 (the player) completes lap 9 at 723.381, its last crossing of the segment. */
const SEGMENT = segmentPath('race-zandvoort-lap10.pwrec.gz');
const LAST_LAP = '9';
const PLAYER = 1;
const TEAMMATE = 4;

/** The command module, written by the implement phase (loaded by a computed specifier, so its absence fails at run time). */
type StrategyCommand = {
  run(positionals: string[], values: { 'at-lap'?: string; car?: string; json?: string }, io: CliIo, features?: readonly Feature[]): Promise<number>;
};
const COMMAND: string = new URL('../../src/cli/commands/strategy.ts', import.meta.url).href;
const command = async (): Promise<StrategyCommand> => (await import(/* @vite-ignore */ COMMAND)) as StrategyCommand;

/** The features with the `strategy` job's worker module replaced by the stub. */
const STUBBED: Feature[] = FEATURES.map((f) =>
  f.jobs === undefined
    ? f
    : { ...f, jobs: f.jobs.map((job) => (job.id === 'strategy' ? { ...job, module: new URL('./strategy-stub-job.ts', import.meta.url) } : job)) },
);

const temp = (name: string): string => mkdtempSync(join(tmpdir(), `pitwall-strategy-${name}-`));

/**
 * The test's `config.json` (C47): small caps, so a job run takes milliseconds instead of the production caps' seconds
 * (Task 18c). Enough for every row: the real job still runs to a result; the stubbed one reads no cap.
 */
const SMALL_CAPS = {
  strategy: { maxScenarioPolicies: 200, n0: 10, dpPlansMax: 2, rescoreTop: 2 },
  'sc-call': { maxScenarioPolicies: 100 },
  undercut: { maxScenarioPolicies: 100 },
  'pit-sweep': { maxScenarioPolicies: 100 },
};
const CONFIG_TEXT = `${JSON.stringify(SMALL_CAPS, null, 2)}\n`;

/** An io with a temporary data dir (C84) holding only the small caps' `config.json`; `dataDir` is returned to check nothing else appears. */
function ioOf() {
  const dataDir = temp('data');
  writeFileSync(join(dataDir, 'config.json'), CONFIG_TEXT);
  const out: string[] = [], err: string[] = [];
  const io: CliIo = { out: (l) => out.push(l), err: (l) => err.push(l), env: { PITWALL_DATA_DIR: dataDir }, signal: new AbortController().signal };
  return { io, dataDir, stdout: () => out.join('\n'), stderr: () => err.join('\n') };
}

/** Runs the command with the stubbed job. */
async function stubbed(values: { 'at-lap'?: string; car?: string; json?: string }) {
  const { io, dataDir, stdout, stderr } = ioOf();
  const code = await (await command()).run([SEGMENT], values, io, STUBBED);
  return { code, stdout: stdout(), stderr: stderr(), dataDir };
}

/** Runs `pitwall strategy` through the CLI, with the real job. */
async function cli(args: string[]) {
  const { io, dataDir, stdout, stderr } = ioOf();
  const code = await main(['strategy', ...args], io);
  return { code, stdout: stdout(), stderr: stderr(), dataDir };
}

/** The indented lines under the heading `car <id>`: up to the next unindented line. */
function carBlock(stdout: string, car: number): string[] {
  const lines = stdout.split('\n');
  const start = lines.findIndex((l) => l === `car ${car}` || l.startsWith(`car ${car} `));
  expect(start, `a heading "car ${car}" in:\n${stdout}`).toBeGreaterThanOrEqual(0);
  const end = lines.findIndex((l, i) => i > start && l.length > 0 && !/^\s/.test(l));
  return lines.slice(start + 1, end === -1 ? undefined : end);
}

const pmfText = (pmf: number[]): string => `pmf ${pmf.map((p) => Math.round(p * 100)).join(' ')}`;

describe('pitwall strategy', { timeout: 180_000 }, () => {
  it('prints ranked rows for a segment race at its last lap', async () => {
    const { code, stdout, stderr } = await stubbed({ 'at-lap': LAST_LAP });
    expect(code, stderr).toBe(0);
    const block = carBlock(stdout, PLAYER);
    const meta = block.find((l) => /\bscenarios \d+/.test(l));
    expect(meta, `a metadata line in:\n${block.join('\n')}`).toBeDefined();
    expect(meta).toContain(`scenarios ${STUB_META.scenarios}`);
    expect(meta).toContain(`candidates ${STUB_META.candidates}`);
    const rows = block.filter((l) => /^\s+\d+\b/.test(l));
    expect(rows, block.join('\n')).toHaveLength(STUB_ROWS.length);
    STUB_ROWS.forEach((r, i) => {
      const line = rows[i]!;
      expect(line).toMatch(new RegExp(`^\\s+${i + 1}\\b\\D*\\b${r.source}\\b`));
      for (const stop of r.policy.stops) expect(line).toContain(`L${stop.lap} ${stop.compound}`);
      for (const t of r.policy.triggers) expect(line).toContain(t.kind);
      expect(line).toContain(`E[pos] ${r.ePos.toFixed(2)}`);
      expect(line).toContain(`E[points] ${r.ePoints.toFixed(2)}`);
      expect(line).toContain(pmfText(r.positionPmf));
      expect(/\btie\b/.test(line), line).toBe(r.tie);
      expect(/\bcommitted\b/.test(line), line).toBe(r.committed);
    });
    // the teammate without a result: its reason
    expect(carBlock(stdout, TEAMMATE).some((l) => l.includes('insufficientData'))).toBe(true);
  });

  it('--json writes the output', async () => {
    const file = join(temp('json'), 'strategy.json');
    const { code, stderr } = await stubbed({ 'at-lap': LAST_LAP, json: file });
    expect(code, stderr).toBe(0);
    const output = JSON.parse(readFileSync(file, 'utf8')) as StrategyOutput;
    expect(output).toEqual(JSON.parse(JSON.stringify(stubOutput([carId(PLAYER), carId(TEAMMATE)]))));
  });

  it('writes nothing under the data dir', async () => {
    const file = join(temp('out'), 'strategy.json');
    const { code, stderr, dataDir } = await cli([SEGMENT, '--at-lap', LAST_LAP, '--json', file]);
    expect(code, stderr).toBe(0);
    expect(readdirSync(dataDir)).toEqual(['config.json']);
    expect(readFileSync(join(dataDir, 'config.json'), 'utf8')).toBe(CONFIG_TEXT);
  });

  it('a lap beyond the race prints an empty report and exits 0', async () => {
    const file = join(temp('empty'), 'strategy.json');
    const { code, stdout, stderr } = await cli([SEGMENT, '--at-lap', '99', '--json', file]);
    expect(code, stderr).toBe(0);
    expect(stdout.split('\n').filter((l) => /^car \d+/.test(l))).toEqual([]);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({});
  });
});
