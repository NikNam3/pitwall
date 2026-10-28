// The jobs of one feed (review F2): declared in features, triggered by the scheduler, run in worker threads.
import type { CalculatorId, Job, QuickCalculator, SchedulerResult } from '@pitwall/engine';
import { JobRunner, type ComputedFor, type JobResult } from './job-runner.ts';

/** The quick calculator that triggers the job `jobId`. */
export const jobCalculatorId = (jobId: string): CalculatorId => `job:${jobId}`;

/** Seed of every feed's runner, so a replay computes the same results. */
const JOB_SEED = 0;

/**
 * Turns each job into the quick calculator `job:<id>` (the job's `reads`, `cadence: trigger`, `compute: prepare`),
 * so the scheduler decides when a job is due and demand whether it is needed. When that calculator ran in a pass,
 * its output goes to the feed's own `JobRunner`, which runs the job in a worker and reports to `onResult`.
 */
export class FeedJobs {
  /** The trigger calculators, to register next to the features' calculators. */
  readonly calculators: QuickCalculator<unknown>[];
  readonly #jobs: ReadonlyMap<CalculatorId, Job<unknown, unknown>>;
  readonly #runner = new JobRunner({ seed: JOB_SEED });

  constructor(jobs: readonly Job<unknown, unknown>[], onResult: (result: JobResult) => void) {
    this.#jobs = new Map(jobs.map((job) => [jobCalculatorId(job.id), job]));
    this.calculators = jobs.map((job) => ({
      kind: 'quick',
      id: jobCalculatorId(job.id),
      reads: job.reads,
      cadence: job.trigger,
      compute: (view) => job.prepare(view),
    }));
    this.#runner.onResult(onResult);
  }

  /** After a scheduler pass: triggers every job whose calculator ran, on that calculator's output. */
  triggerRan(result: SchedulerResult, computedFor: ComputedFor): void {
    for (const id of result.ran) {
      const job = this.#jobs.get(id);
      if (job !== undefined) this.#runner.trigger(job, result.outputs.get(id), computedFor);
    }
  }

  /** The session ended: runs under way are dropped, their results belong to a session that is gone. */
  sessionEnded(): void {
    this.#runner.cancel();
  }

  /** Terminates every run; no result arrives afterwards. */
  close(): Promise<void> {
    return this.#runner.close();
  }
}
