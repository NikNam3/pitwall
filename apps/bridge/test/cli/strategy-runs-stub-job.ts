// A stand-in for the `strategy` job's worker module for the `pitwall strategy --runs` tests (SP4.3c Task 22a, C47): it
// echoes the run counts the job's input carries. `run(input)` returns `stubOutput(input.ourCars)` with the first car's
// metadata `scenarios` set to the input config's `strategy.n0` and `candidates` to its `strategy.maxScenarioPolicies`,
// so the printed metadata line shows the counts the job saw. Pure, deterministic; it runs in the job's worker.
import { known, type CarId, type StrategyOutput } from '@pitwall/domain';
import { stubOutput } from './strategy-stub-job.ts';

type Input = { ourCars: CarId[]; config: Record<string, Record<string, unknown> | undefined> };

/** The job module's entry, as the worker calls it. */
export function run(input: Input): StrategyOutput {
  const out = stubOutput(input.ourCars);
  const first = input.ourCars[0];
  const result = first === undefined ? undefined : out[first];
  if (first !== undefined && result !== undefined && result.known) {
    const strategy = input.config['strategy'] ?? {};
    out[first] = known({ ...result.value, scenarios: Number(strategy['n0']), candidates: Number(strategy['maxScenarioPolicies']) }, 0);
  }
  return out;
}
