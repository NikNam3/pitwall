// A stand-in for the planning job's worker module (`PLANNING_JOB.module`, SP4.3d2 Task 9), for the planning round's
// tests (Task 10): the round's tests check the bridge's trigger path, its topics and its store, not the model, so the job
// echoes its input. Per our car (`input.ourCars`) one ranked row per prepared slot (`input.slots[car].saved`, the slot
// on the row), else one `dp` row; `committed` is the car's active prepared policy. Pure, deterministic; it runs in the
// job's worker. `planning-slow-stub-job.ts` is the same output after a wait.
import { known, unknown, type CarId, type McRow, type Policy, type Slot, type StrategyOutput } from '@pitwall/domain';

/** What the stub reads of the job's input (`StrategyInput`). */
export type EchoInput = {
  ourCars: CarId[];
  committed?: Record<CarId, Policy | null>;
  slots?: Record<CarId, { saved: Partial<Record<Slot, Policy>>; active: Slot | null }>;
};

const DP_POLICY: Policy = { startCompound: 'medium', stops: [{ lap: 20, compound: 'hard' }] };

function row(rank: number, policy: Policy, slot: Slot | null, committed: boolean): McRow {
  return {
    policy,
    source: slot === null ? 'dp' : 'plan',
    positionPmf: [1],
    ePos: 1,
    ePoints: 25,
    meanMs: 5_400_000 + 1_000 * rank,
    quantiles: { p10: 1, p50: 2, p90: 3 },
    pGain: 0,
    diff: rank,
    se: 0,
    tie: false,
    committed,
    infeasible: null,
    rank: rank + 1,
    deltaLeaderMs: 0,
    deltaPlanMs: null,
    slot,
    diffPlan: unknown('notApplicable'),
    sePlan: unknown('notApplicable'),
    rule: null,
  };
}

/** The echo of `input`: per our car its prepared slots as rows. */
export function echo(input: EchoInput): StrategyOutput {
  const out: StrategyOutput = {};
  for (const car of input.ourCars) {
    const saved = Object.entries(input.slots?.[car]?.saved ?? {}) as Array<[Slot, Policy]>;
    const active = input.committed?.[car] ?? null;
    const same = (p: Policy): boolean => active !== null && JSON.stringify(p) === JSON.stringify(active);
    const rows = saved.length === 0 ? [row(0, DP_POLICY, null, false)] : saved.map(([slot, policy], i) => row(i, policy, slot, same(policy)));
    out[car] = known({
      rows, bestPerStops: {}, scenarios: 1, capHit: false, candidates: rows.length, hazard: known('ok', 0), unresolvedTie: false, currentPosition: 1,
      prefill: {}, planning: { gridPlace: unknown('notReceived'), laps: 0, rainPct: unknown('notReceived') },
    }, 0);
  }
  return out;
}

/** The job module's entry, as the worker calls it. */
export function run(input: EchoInput): StrategyOutput {
  return echo(input);
}
