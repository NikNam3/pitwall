// The planning job's echo stand-in (`planning-stub-job.ts`) that also keeps the input it was handed (SP4.3f Task 3): the
// round's tests check what the planning job is given (our cars, `planning.rainPct`, determinism, C38), so the worker
// writes its input, structured-cloned as `node:v8` serializes it, into the directory named by `CAPTURE_ENV` (one file
// per run, named by the process's monotonic clock so they sort in run order). Without the variable it is the echo.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { serialize } from 'node:v8';
import type { StrategyOutput } from '@pitwall/domain';
import { echo, type EchoInput } from './planning-stub-job.ts';

/** The environment variable naming the directory the inputs are written to (workers share the test's `process.env`). */
export const CAPTURE_ENV = 'PITWALL_TEST_PLANNING_CAPTURE';

export function run(input: EchoInput): StrategyOutput {
  const dir = process.env[CAPTURE_ENV];
  if (dir !== undefined) writeFileSync(join(dir, `${process.hrtime.bigint().toString().padStart(24, '0')}.bin`), serialize(input));
  return echo(input);
}
