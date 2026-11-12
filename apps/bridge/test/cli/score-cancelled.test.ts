// `pitwall score` when a job run never delivers (SP4.3a final review F6, ruling R33): on China (2026-11-02_15-17-14) a
// forecast-score run was triggered at lap 10 and then cancelled (a flashback or the session's end drops the runs under
// way, `FeedJobs.flashback` / `sessionEnded`) with no trigger after it; the command waited for that run's result
// forever and ended on a pending promise (exit 13, "unsettled top-level await"). A run that is cancelled delivers
// nothing: the command goes on, and with no job result at all it prints the all-zero report and exits 0.
//
// The reproduction on a committed segment: every triggered run is cancelled at once, as a flashback right after it
// would, so no job result ever arrives.
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ForecastScoreReport, ScoreTable } from '@pitwall/domain';
import { describe, expect, it, vi } from 'vitest';
import type { CliIo } from '../../src/cli/io.ts';
import { main } from '../../src/cli/pitwall.ts';
import type * as FeedJobsModule from '../../src/jobs/feed-jobs.ts';
import { segmentPath } from '../fixtures/replay.ts';

vi.mock('../../src/jobs/feed-jobs.ts', async (importOriginal) => {
  const original = await importOriginal<typeof FeedJobsModule>();
  /** Every run triggered is dropped at once, as by a flashback right after its trigger. */
  class CancellingFeedJobs extends original.FeedJobs {
    override triggerRan(...args: Parameters<InstanceType<typeof original.FeedJobs>['triggerRan']>): void {
      super.triggerRan(...args);
      if (args[0].ran.some((id) => this.isTrigger(id))) this.flashback();
    }
  }
  return { ...original, FeedJobs: CancellingFeedJobs };
});

/** An AI car's stop in the race: its forecast-score job is triggered (it delivers a report without the mock). */
const REJOIN = segmentPath('race-rejoin.pwrec.gz');
/** The command must settle well within this (it settles in seconds on the segment). */
const SETTLE_MS = 60_000;

const temp = (name: string): string => mkdtempSync(join(tmpdir(), `pitwall-score-${name}-`));

/** Every table of a report: the experiments, then each forecast's three. */
const tables = (report: ForecastScoreReport): Omit<ScoreTable, 'cases'>[] => [
  report.experiments.rejoin,
  report.experiments.undercut,
  report.experiments.scStop,
  ...report.forecasts.flatMap((f) => [f.lapTime, f.position, f.baselinePosition]),
];

describe('pitwall score: a cancelled job run (F6, R33)', { timeout: 120_000 }, () => {
  it('no job result arrives: prints the all-zero report and exits 0, never waits forever', async () => {
    const dataDir = temp('data');
    const file = join(temp('json'), 'score.json');
    const out: string[] = [];
    const err: string[] = [];
    const io: CliIo = { out: (l) => out.push(l), err: (l) => err.push(l), env: { PITWALL_DATA_DIR: dataDir }, signal: new AbortController().signal };
    let timer: NodeJS.Timeout | undefined;
    const pending = new Promise<'pending'>((resolve) => {
      timer = setTimeout(() => resolve('pending'), SETTLE_MS);
    });
    const code = await Promise.race([main(['score', REJOIN, '--json', file], io), pending]);
    clearTimeout(timer);

    expect(code, `pitwall score settled within ${SETTLE_MS / 1000} s (stderr: ${err.join(' | ')})`).not.toBe('pending');
    expect(code, err.join('\n')).toBe(0);
    expect(out.join('\n')).toMatch(/^rejoin \(places\)$/m);
    const report = JSON.parse(readFileSync(file, 'utf8')) as ForecastScoreReport;
    expect(report.forecasts.map((f) => f.horizon)).toEqual([1, 1, 3, 3, 5, 5, 10, 10]);
    for (const t of tables(report)) {
      expect([t.ai.n, t.human.n], t.name).toEqual([0, 0]);
      expect([t.ai.meanAbs.known, t.human.meanAbs.known], t.name).toEqual([false, false]);
    }
  });
});
