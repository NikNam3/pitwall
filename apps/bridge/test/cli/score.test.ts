// `pitwall score <recording> [--json <file>] [--compare <old.json>]` (SP4.3a spec 7.2, Task 20; C32, C38, C58, C84): it
// reprocesses the recording as `pitwall reprocess` does (its sidecars included), waits for the `forecastScore.report`
// job result of the final leader lap and prints one table per experiment and per forecast horizon, AI and human apart.
// It stores nothing: the data dir it is given stays empty.
//
// The printed shape these tests pin: each table starts with an unindented heading, its name for an experiment
// (`rejoin`, `undercut`, `scStop`) and `h<horizon> <basis> <lapTime|position|baselinePosition>` for a forecast; under it
// one indented line per driver type, `ai` and `human`, holding `n <count>`, the mean absolute error and the bias. With
// `--compare`, a number is printed as `<new> (was <old>, <signed change>)`.
//
// `race-rejoin` holds an AI car's box release to its pit exit, not its in lap (ruling R15): the tests assert the
// tables and their counts, not a scored case.
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ForecastScoreReport, ScoreTable } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import type { CliIo } from '../../src/cli/io.ts';
import { main } from '../../src/cli/pitwall.ts';
import { segmentPath } from '../fixtures/replay.ts';

/** An AI car's stop in the race (Task 22). */
const REJOIN = segmentPath('race-rejoin.pwrec.gz');
/** Everything before lights out: no lap is completed. */
const NO_LAPS = segmentPath('race-singapore-start.pwrec.gz');

const EXPERIMENTS = ['rejoin', 'undercut', 'scStop'] as const;
const HORIZONS = [1, 3, 5, 10] as const;

const temp = (name: string): string => mkdtempSync(join(tmpdir(), `pitwall-score-${name}-`));

/** Runs `pitwall score` with an empty temporary data dir (C84); `dataDir` is returned to check it stays empty. */
async function score(args: string[]) {
  const dataDir = temp('data');
  const out: string[] = [], err: string[] = [];
  const io: CliIo = { out: (l) => out.push(l), err: (l) => err.push(l), env: { PITWALL_DATA_DIR: dataDir }, signal: new AbortController().signal };
  const code = await main(['score', ...args], io);
  return { code, stdout: out.join('\n'), stderr: err.join('\n'), dataDir };
}

/** The lines of the table headed `heading`: from its heading to the next unindented line. */
function table(stdout: string, heading: string): string[] {
  const lines = stdout.split('\n');
  const start = lines.findIndex((l) => l === heading || l.startsWith(`${heading} `));
  expect(start, `a table headed "${heading}" in:\n${stdout}`).toBeGreaterThanOrEqual(0);
  const end = lines.findIndex((l, i) => i > start && l.length > 0 && !/^\s/.test(l));
  return lines.slice(start + 1, end === -1 ? undefined : end);
}

/** The line of driver type `driver` in a table's lines. */
function driverLine(lines: string[], driver: 'ai' | 'human'): string {
  const line = lines.find((l) => new RegExp(`^\\s+${driver}\\b`).test(l));
  expect(line, `an "${driver}" line in:\n${lines.join('\n')}`).toBeDefined();
  return line!;
}

/** The count printed on a driver line. */
function count(line: string): number {
  const m = /\bn (\d+)\b/.exec(line);
  expect(m, `"n <count>" in "${line}"`).not.toBeNull();
  return Number(m![1]);
}

/** Every table of a report: the experiments, then each forecast's three. */
function tables(report: ForecastScoreReport): ScoreTable[] {
  return [...EXPERIMENTS.map((e) => report.experiments[e]), ...report.forecasts.flatMap((f) => [f.lapTime, f.position, f.baselinePosition])];
}

describe('pitwall score', { timeout: 120_000 }, () => {
  it('prints the tables of the race-rejoin segment', async () => {
    const { code, stdout, stderr } = await score([REJOIN]);
    expect(code, stderr).toBe(0);
    for (const name of EXPERIMENTS) {
      const lines = table(stdout, name);
      expect(Number.isInteger(count(driverLine(lines, 'ai')))).toBe(true);
      expect(Number.isInteger(count(driverLine(lines, 'human')))).toBe(true);
    }
    for (const h of HORIZONS) {
      for (const basis of ['wear', 'age'] as const) {
        for (const kind of ['lapTime', 'position', 'baselinePosition'] as const) {
          const lines = table(stdout, `h${h} ${basis} ${kind}`);
          count(driverLine(lines, 'ai'));
          count(driverLine(lines, 'human'));
        }
      }
    }
  });

  it('--json writes the report; --compare prints old, new and change', async () => {
    const dir = temp('json');
    const file = join(dir, 'score.json');
    const first = await score([REJOIN, '--json', file]);
    expect(first.code, first.stderr).toBe(0);
    const text = readFileSync(file, 'utf8');
    const report = JSON.parse(text) as ForecastScoreReport;
    // the report without its cases
    expect(text).not.toContain('"cases"');
    expect(Object.keys(report.experiments).sort()).toEqual([...EXPERIMENTS].sort());
    for (const t of tables(report)) {
      expect(Number.isInteger(t.ai.n) && t.ai.n >= 0).toBe(true);
      expect(Number.isInteger(t.human.n) && t.human.n >= 0).toBe(true);
    }
    for (const f of report.forecasts) {
      expect(HORIZONS).toContain(f.horizon);
      expect(['wear', 'age']).toContain(f.basis);
    }
    // the printed counts are the report's
    const n = report.experiments.rejoin.ai.n;
    expect(count(driverLine(table(first.stdout, 'rejoin'), 'ai'))).toBe(n);

    // an old report whose rejoin AI count was 2 more: the line shows the new count beside the old with its change
    const old = structuredClone(report);
    old.experiments.rejoin.ai.n = n + 2;
    const oldFile = join(dir, 'old.json');
    writeFileSync(oldFile, JSON.stringify(old));
    const compared = await score([REJOIN, '--compare', oldFile]);
    expect(compared.code, compared.stderr).toBe(0);
    expect(driverLine(table(compared.stdout, 'rejoin'), 'ai')).toContain(`n ${n} (was ${n + 2}, -2)`);
  });

  it('writes nothing under the data dir', async () => {
    const file = join(temp('out'), 'score.json');
    const { code, stderr, dataDir } = await score([REJOIN, '--json', file]);
    expect(code, stderr).toBe(0);
    expect(readdirSync(dataDir)).toEqual([]);
  });

  it('a recording with 0 completed laps prints counts 0 and exits 0', async () => {
    const file = join(temp('empty'), 'score.json');
    const { code, stdout, stderr } = await score([NO_LAPS, '--json', file]);
    expect(code, stderr).toBe(0);
    for (const name of EXPERIMENTS) {
      const lines = table(stdout, name);
      expect(count(driverLine(lines, 'ai'))).toBe(0);
      expect(count(driverLine(lines, 'human'))).toBe(0);
    }
    for (const h of HORIZONS) expect(count(driverLine(table(stdout, `h${h} wear lapTime`), 'ai'))).toBe(0);
    const report = JSON.parse(readFileSync(file, 'utf8')) as ForecastScoreReport;
    for (const t of tables(report)) expect([t.ai.n, t.human.n]).toEqual([0, 0]);
  });
});
