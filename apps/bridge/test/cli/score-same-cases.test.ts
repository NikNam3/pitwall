// `pitwall score`'s like-for-like lines (SP4.3b1 Task 27; C3): under each `h<horizon> <basis> crps` block, one indented
// line per driver type with `forecastScore.report`'s `sameCases` of that horizon and basis, the CRPS beside the point
// forecast's and the baseline's mean absolute position error on the same cases:
//
//   same ai    n <count>  crps <mean>  point <mean>  gaps stay <mean>
//
// numbers only, in the places format (two decimals, `unknown` without a case). `--json` writes `sameCases` with each
// forecast; `--compare` against an old report from before Task 27 (its forecasts without `sameCases`) prints the new
// numbers alone, with no "was", as it does for an old report without `crps`.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ForecastScoreReport, Known } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import type { CliIo } from '../../src/cli/io.ts';
import { main } from '../../src/cli/pitwall.ts';
import { segmentPath } from '../fixtures/replay.ts';

/** An AI car's stop in the race (as score.test.ts). */
const REJOIN = segmentPath('race-rejoin.pwrec.gz');
const HORIZONS = [1, 3, 5, 10] as const;
const BASES = ['wear', 'age'] as const;
const DRIVERS = ['ai', 'human'] as const;

const temp = (name: string): string => mkdtempSync(join(tmpdir(), `pitwall-score-same-${name}-`));

/** Runs `pitwall score` with an empty temporary data dir (C84). */
async function score(args: string[]) {
  const out: string[] = [], err: string[] = [];
  const io: CliIo = { out: (l) => out.push(l), err: (l) => err.push(l), env: { PITWALL_DATA_DIR: temp('data') }, signal: new AbortController().signal };
  const code = await main(['score', ...args], io);
  return { code, stdout: out.join('\n'), stderr: err.join('\n') };
}

/** The lines of the block headed `heading`: from its heading to the next unindented line. */
function block(stdout: string, heading: string): string[] {
  const lines = stdout.split('\n');
  const start = lines.findIndex((l) => l === heading || l.startsWith(`${heading} `));
  expect(start, `a block headed "${heading}" in:\n${stdout}`).toBeGreaterThanOrEqual(0);
  const end = lines.findIndex((l, i) => i > start && l.length > 0 && !/^\s/.test(l));
  return lines.slice(start + 1, end === -1 ? undefined : end);
}

/** A mean as the places tables print it. */
const places = (v: Known<number>): string => (v.known ? v.value.toFixed(2) : 'unknown');

/** The like-for-like line of `driver` in a crps block's lines. */
function sameLine(lines: string[], driver: (typeof DRIVERS)[number]): string {
  const line = lines.find((l) => new RegExp(`^\\s+same ${driver}\\b`).test(l));
  expect(line, `a "same ${driver}" line in:\n${lines.join('\n')}`).toBeDefined();
  return line!;
}

/** The line `sameCases` gives for `driver`: count, CRPS, point and baseline ("gaps stay") means. */
const expectedLine = (same: ForecastScoreReport['forecasts'][number]['sameCases'], driver: (typeof DRIVERS)[number]): RegExp =>
  new RegExp(
    `^\\s+same ${driver}\\s+n ${same.crps[driver].n}  crps ${places(same.crps[driver].meanAbs)}  point ${places(same.position[driver].meanAbs)}  gaps stay ${places(same.baseline[driver].meanAbs)}$`,
  );

/** The first run, with `--json`, shared by both tests (it takes seconds on the segment). */
let first: Promise<{ code: number; stdout: string; stderr: string; report: ForecastScoreReport }> | undefined;
const firstRun = () =>
  (first ??= (async () => {
    const file = join(temp('json'), 'score.json');
    const r = await score([REJOIN, '--json', file]);
    return { ...r, report: JSON.parse(readFileSync(file, 'utf8')) as ForecastScoreReport };
  })());

describe('pitwall score sameCases', { timeout: 120_000 }, () => {
  it('pitwall score prints under each crps block a like-for-like line per driver type: n, crps, point, gaps stay', async () => {
    const { code, stdout, stderr, report } = await firstRun();
    expect(code, stderr).toBe(0);
    for (const h of HORIZONS) {
      for (const basis of BASES) {
        const f = report.forecasts.find((x) => x.horizon === h && x.basis === basis);
        expect(f, `h${h} ${basis} in the --json report`).toBeDefined();
        expect(f!.sameCases, `h${h} ${basis}: --json writes sameCases`).toBeDefined();
        const lines = block(stdout, `h${h} ${basis} crps`);
        for (const driver of DRIVERS) expect(sameLine(lines, driver), `h${h} ${basis} ${driver}`).toMatch(expectedLine(f!.sameCases, driver));
      }
    }
  });

  it('--compare against an old report without sameCases prints the new numbers with no "was"', async () => {
    const { code, stderr, report } = await firstRun();
    expect(code, stderr).toBe(0);
    // the old report: the new one without sameCases, as a report from before Task 27
    const old = structuredClone(report) as unknown as { forecasts: Record<string, unknown>[] };
    for (const f of old.forecasts) delete f['sameCases'];
    const oldFile = join(temp('old'), 'old.json');
    writeFileSync(oldFile, JSON.stringify(old));

    const compared = await score([REJOIN, '--compare', oldFile]);
    expect(compared.code, compared.stderr).toBe(0);
    for (const h of HORIZONS) {
      for (const basis of BASES) {
        const f = report.forecasts.find((x) => x.horizon === h && x.basis === basis)!;
        const lines = block(compared.stdout, `h${h} ${basis} crps`);
        for (const driver of DRIVERS) {
          const line = sameLine(lines, driver);
          expect(line, `h${h} ${basis} ${driver}`).not.toContain('was');
          expect(line, `h${h} ${basis} ${driver}`).toMatch(expectedLine(f.sameCases, driver));
        }
        // the old report's crps is still compared
        expect(lines.find((l) => /^\s+ai\b/.test(l)), `h${h} ${basis} crps ai`).toContain('(was ');
      }
    }
  });
});
