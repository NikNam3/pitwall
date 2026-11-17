// The planning job's stand-in (`planning-stub-job.ts`) that holds its worker for `SLOW_MS` first, so a test can load the
// race while a planning job runs (SP4.3d2 Task 10 row 7). A cancelled run's worker is terminated during the wait.
import type { StrategyOutput } from '@pitwall/domain';
import { echo, type EchoInput } from './planning-stub-job.ts';

/** How long the worker holds before it answers. */
export const SLOW_MS = 4_000;

export async function run(input: EchoInput): Promise<StrategyOutput> {
  await new Promise((resolve) => setTimeout(resolve, SLOW_MS));
  return echo(input);
}
