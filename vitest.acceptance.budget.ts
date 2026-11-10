// The acceptance gate's wall-time budget (docs/testing.md, speed targets): the files run in parallel, so the slowest file
// sets the gate's wall time. At the run's end this reporter prints every file's time and the run's against the budget and
// fails the run when one exceeds it. Wall time, not best of passes: it is measured at the gate, on an idle machine; a
// load-induced failure is rerun idle, never answered by raising the budget.
import type { Reporter, TestModule } from 'vitest/node';

/** At most this long per acceptance file and for the whole run. */
export const ACCEPTANCE_BUDGET_MS = 300_000;

export default class AcceptanceBudget implements Reporter {
  #startedAt = 0;

  onTestRunStart(): void {
    this.#startedAt = performance.now();
  }

  onTestRunEnd(modules: ReadonlyArray<TestModule>): void {
    const runMs = performance.now() - this.#startedAt;
    const files = modules.map((m) => ({ file: m.relativeModuleId, ms: m.diagnostic().duration })).sort((a, b) => b.ms - a.ms);
    const over = files.filter((f) => f.ms > ACCEPTANCE_BUDGET_MS);
    const s = (ms: number) => `${(ms / 1000).toFixed(0)} s`;
    console.info(`\n[acceptance budget] ${s(ACCEPTANCE_BUDGET_MS)} per file and per run`);
    for (const f of files) console.info(`  ${f.ms > ACCEPTANCE_BUDGET_MS ? 'OVER' : 'ok  '} ${s(f.ms).padStart(6)}  ${f.file}`);
    console.info(`  ${runMs > ACCEPTANCE_BUDGET_MS ? 'OVER' : 'ok  '} ${s(runMs).padStart(6)}  whole run`);
    if (over.length > 0 || runMs > ACCEPTANCE_BUDGET_MS) {
      console.error(`[acceptance budget] FAILED: ${over.length} file(s) over budget, whole run ${s(runMs)}`);
      process.exitCode = 1;
    }
  }
}
