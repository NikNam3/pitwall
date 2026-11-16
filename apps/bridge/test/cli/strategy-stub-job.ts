// A stand-in for the `strategy` job's worker module (`STRATEGY_JOB.module`), for the `pitwall strategy` tests: no
// committed segment holds enough of a race for the real job to rank anything (each car's estimates need laps before the
// segment, C84), so the printing is tested on a fixed output. `run(input)` returns `stubOutput(input.ourCars)`: ranked
// rows for the first of our cars, `insufficientData` for the other. Pure, deterministic; it runs in the job's worker.
import { known, unknown, type CarId, type McRow, type StrategyOutput } from '@pitwall/domain';

/** A row of the stub's output. */
function row(rank: number, source: McRow['source'], over: Partial<McRow>): McRow {
  return {
    policy: { stops: [{ lap: 20 + rank, compound: 'hard' }] },
    source,
    positionPmf: [0.5 - 0.1 * rank, 0.3, 0.2 + 0.1 * rank],
    ePos: 1.7 + 0.2 * rank,
    ePoints: 20.5 - rank,
    meanMs: 5_400_000 + 1_000 * rank,
    quantiles: { p10: 1, p50: 2, p90: 3 },
    pGain: 0.1,
    diff: 0.2 * rank,
    se: 0.05,
    tie: false,
    committed: false,
    infeasible: null,
    rank: rank + 1,
    deltaLeaderMs: 0,
    deltaPlanMs: null,
    slot: null,
    diffPlan: unknown('notApplicable'),
    sePlan: unknown('notApplicable'),
    rule: null,
    ...over,
  };
}

/** The ranked rows the stub gives the first of our cars: a DP plan, a tied neighbour, the committed plan. */
export const STUB_ROWS: McRow[] = [
  row(0, 'dp', {}),
  row(1, 'neighbour', {
    tie: true,
    policy: { stops: [{ lap: 22, compound: 'medium' }] },
  }),
  row(2, 'committed', { committed: true, policy: { stops: [{ lap: 18, compound: 'medium' }, { lap: 40, compound: 'soft' }] } }),
];

/** The run's metadata of the first of our cars. */
export const STUB_META = { scenarios: 1_234, capHit: true, candidates: 17, unresolvedTie: false, currentPosition: 8, prefill: {}, planning: null } as const;

/** The output for our cars: the first ranked, the other `insufficientData`. */
export function stubOutput(ourCars: readonly CarId[]): StrategyOutput {
  const out: StrategyOutput = {};
  ourCars.forEach((car, i) => {
    out[car] = i === 0 ? known({ rows: STUB_ROWS, bestPerStops: {}, ...STUB_META, hazard: known('ok', 0) }, 0) : unknown('insufficientData');
  });
  return out;
}

/** The job module's entry, as the worker calls it. */
export function run(input: { ourCars: CarId[] }): StrategyOutput {
  return stubOutput(input.ourCars);
}
