// One committed-teammate rule for every job (SP4.3b2 Task 18f, review finding F1; C43, C3): `strategy`, `pit-sweep`,
// `undercut` and `sc-call` each pass the simulator the same committed field for our other car, from one function
// (`committedField`, `shared/strategy-input/`).
//
// How these tests read the jobs (the test agent's decisions, Task 18f):
// - Each job runs on `strategy`'s small generator race at the leader's lap `LAP`, from its own tests' view builder with
//   the same `ViewSpec` (decisions, sets, retired cars), as the worker computes it (a structured clone of the input).
// - Every simulator call is recorded through `race-monte-carlo`'s index with the real simulator running:
//   `raceMonteCarlo` for `strategy`, `scoreCalls` for the calls. A call "for our car `PLAYER`" is a `strategy` call that
//   plans `PLAYER` (its candidates not empty) or a `scoreCalls` call whose `car` is `PLAYER`.
// - In such a call our other car `TEAMMATE` is certain input when it is one of the call's own cars (`start.sets` has an
//   entry for it); what it follows is `committed[TEAMMATE]` (`null` or absent: not committed).
// - The membership rule (row 3): the planned field's (`plannedField`, as `strategy` and its final call use it): a car of
//   ours that cannot be planned (retired) is modelled like a rival even with a commit. The reverse (in the planned field
//   but not in the starting point's sets) cannot occur: the planned field is built from the starting point's sets.
// - Row 4 pins `strategy` unchanged: `committedField(input, car)[mate]` equals the policy `candidatesForRun` follows for
//   `mate` (`perCar.get(mate).followed`, strategy's former `followable` field).
import { type CarId, type Policy } from '@pitwall/domain';
import { createRng } from '@pitwall/engine/readers';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as mc from '../../../src/race-monte-carlo/index.ts';
import type { CallInput, McInput } from '../../../src/race-monte-carlo/index.ts';
import { startLapOf } from '../../../src/race-forecast/index.ts';
import { PIT_SWEEP_JOB } from '../../../src/pit-sweep/index.ts';
import { run as runPitSweep } from '../../../src/pit-sweep/job.ts';
import { SC_CALL_JOB } from '../../../src/sc-call/index.ts';
import { run as runScCall } from '../../../src/sc-call/job.ts';
import { committedField, strategyInputFrom, type StrategyInput } from '../../../src/shared/strategy-input/index.ts';
import { candidatesForRun, prepareStrategy, runStrategy } from '../../../src/strategy/index.ts';
import { UNDERCUT_JOB } from '../../../src/undercut/index.ts';
import { run as runUndercut } from '../../../src/undercut/job.ts';
import { sweepViewAt } from '../../pit-sweep/support.ts';
import { scViewAt } from '../../sc-call/support.ts';
import { json, PLAYER, RACE, SETS, TEAMMATE, viewAt, type ViewSpec } from '../../strategy/support.ts';
import { undercutView } from '../../undercut/support.ts';

type JobName = 'strategy' | 'pit-sweep' | 'undercut' | 'sc-call';
const JOBS: readonly JobName[] = ['strategy', 'pit-sweep', 'undercut', 'sc-call'];

const rec = vi.hoisted(() => ({
  job: '' as string,
  mc: [] as { job: string; input: McInput }[],
  calls: [] as { job: string; input: CallInput }[],
}));

vi.mock('../../../src/race-monte-carlo/index.ts', async (importOriginal) => {
  const real = await importOriginal<typeof mc>();
  return {
    ...real,
    raceMonteCarlo: (...args: Parameters<typeof real.raceMonteCarlo>) => {
      rec.mc.push({ job: rec.job, input: args[0] });
      return real.raceMonteCarlo(...args);
    },
    scoreCalls: (...args: Parameters<typeof real.scoreCalls>) => {
      rec.calls.push({ job: rec.job, input: args[0] });
      return real.scoreCalls(...args);
    },
  };
});

beforeEach(() => {
  rec.job = '';
  rec.mc = [];
  rec.calls = [];
});

const SEED = 1_521_242_746;
const LAP = 3;
/** `strategy`'s cap here: small, the teammate committed (no round 1). */
const STRATEGY_CAP = 100;

/** Runs job `job` on the view of `spec`, as the worker does, recording its simulator calls under its name. */
function runJob(job: JobName, spec: ViewSpec): void {
  const s: ViewSpec = { ...spec, config: { maxScenarioPolicies: STRATEGY_CAP, ...spec.config } };
  rec.job = job;
  const rng = createRng(SEED);
  if (job === 'strategy') runStrategy(structuredClone(prepareStrategy(viewAt(RACE(), LAP, s))), rng);
  else if (job === 'pit-sweep') runPitSweep(structuredClone(PIT_SWEEP_JOB.prepare(sweepViewAt(RACE(), LAP, s))), rng);
  else if (job === 'undercut') runUndercut(structuredClone(UNDERCUT_JOB.prepare(undercutView(LAP, s))), rng);
  else runScCall(structuredClone(SC_CALL_JOB.prepare(scViewAt(RACE(), LAP, s))), rng);
  rec.job = '';
}

/** What our other car is in one call for `PLAYER`: one of the call's cars or not, and what it follows. */
type Mate = { ours: boolean; follows: Policy | null };

/** Per job, `TEAMMATE` in each of its calls for `PLAYER`; fails the test when a job made none. */
function mateInEveryJob(spec: ViewSpec): Record<JobName, Mate[]> {
  const out = {} as Record<JobName, Mate[]>;
  for (const job of JOBS) {
    runJob(job, spec);
    const inputs: (McInput | CallInput)[] =
      job === 'strategy'
        ? rec.mc.filter((c) => c.job === job && (c.input.candidates[PLAYER]?.length ?? 0) > 0).map((c) => c.input)
        : rec.calls.filter((c) => c.job === job && c.input.car === PLAYER).map((c) => c.input);
    expect(inputs.length, `${job}: its simulator calls for car ${PLAYER}`).toBeGreaterThan(0);
    out[job] = inputs.map((input) => ({ ours: Object.hasOwn(input.start.sets, TEAMMATE), follows: input.committed[TEAMMATE] ?? null }));
  }
  return out;
}

/** The strategy input on the view of `spec` (its starting point known). */
function strategyInput(spec: ViewSpec = {}): StrategyInput {
  return structuredClone(strategyInputFrom(viewAt(RACE(), LAP, spec)));
}

/** `TEAMMATE`'s lap the DP and the calls play from (`startLapOf` on the starting point). */
function mateLap(): number {
  const s = strategyInput().start;
  expect(s.known, json(s)).toBe(true);
  return s.known ? startLapOf(s.value, TEAMMATE) : (undefined as never);
}

const committed = (carId: CarId, policy: Policy): NonNullable<ViewSpec['decisions']> => [{ kind: 'planCommitted', carId, policy }];

describe('one committed-teammate rule for every job', () => {
  // row 1
  it('a committed teammate whose planned stop lap has passed boxes this lap, in every job', () => {
    const lap = mateLap();
    const passed: Policy = { stops: [{ lap: lap - 2, compound: 'hard' }, { lap: lap + 8, compound: 'medium' }], triggers: [] };
    const followed: Policy = { stops: [{ lap, compound: 'hard' }, { lap: lap + 8, compound: 'medium' }], triggers: [] };
    const byJob = mateInEveryJob({ decisions: committed(TEAMMATE, passed) });
    for (const job of JOBS) for (const m of byJob[job]) expect.soft(m, job).toEqual({ ours: true, follows: followed });
  });

  // row 2
  it('a committed stop onto a compound without a set is dropped, in every job', () => {
    const lap = mateLap();
    const noHard = SETS.filter((s) => s.visualCompound !== 'hard');
    const onHard: Policy = { stops: [{ lap: lap + 4, compound: 'hard' }], triggers: [] };
    const byJob = mateInEveryJob({ sets: { [TEAMMATE]: noHard }, decisions: committed(TEAMMATE, onHard) });
    for (const job of JOBS) for (const m of byJob[job]) expect.soft(m, job).toEqual({ ours: true, follows: { stops: [], triggers: [] } });
  });

  // row 3
  it('the same membership rule in every job', () => {
    // the teammate retired: in the starting point (its sets known) but not in the planned field, its commit kept
    const spec: ViewSpec = { retired: [TEAMMATE], decisions: committed(TEAMMATE, { stops: [{ lap: mateLap() + 4, compound: 'hard' }], triggers: [] }) };
    const s = strategyInput(spec).start;
    expect(s.known && s.value.sets[TEAMMATE] !== undefined, 'the retired teammate is in the starting point with its sets').toBe(true);
    const byJob = mateInEveryJob(spec);
    // modelled like a rival in every job: not one of the call's cars, no committed policy
    for (const job of JOBS) for (const m of byJob[job]) expect.soft(m, job).toEqual({ ours: false, follows: null });
  });

  // row 4
  it("committedField equals strategy's former followable field on the builder race", () => {
    const lap = mateLap();
    const noHard = SETS.filter((s) => s.visualCompound !== 'hard');
    const cases: [string, ViewSpec][] = [
      ['no commit', {}],
      ['a followable commit', { decisions: committed(TEAMMATE, { stops: [{ lap: lap + 5, compound: 'hard' }], triggers: [] }) }],
      ['a passed stop', { decisions: committed(TEAMMATE, { stops: [{ lap: lap - 2, compound: 'hard' }, { lap: lap + 8, compound: 'medium' }], triggers: [] }) }],
      ['no set left', { sets: { [TEAMMATE]: noHard }, decisions: committed(TEAMMATE, { stops: [{ lap: lap + 4, compound: 'hard' }], triggers: [] }) }],
      [
        'both committed',
        {
          decisions: [
            { kind: 'planCommitted', carId: PLAYER, policy: { stops: [{ lap: lap - 1, compound: 'soft' }], triggers: [] } },
            { kind: 'planCommitted', carId: TEAMMATE, policy: { stops: [{ lap: lap + 6, compound: 'medium' }], triggers: [] } },
          ],
        },
      ],
    ];
    for (const [name, spec] of cases) {
      const input = strategyInput(spec);
      const { perCar } = candidatesForRun(structuredClone(input), createRng(SEED));
      for (const [car, mate] of [
        [PLAYER, TEAMMATE],
        [TEAMMATE, PLAYER],
      ] as const) {
        const field = committedField(input, car);
        const former = perCar.get(mate)?.followed ?? null;
        expect(field[mate] ?? null, `${name}: car ${car}'s field, car ${mate}`).toEqual(former);
        // only our cars: no rival in the committed field
        for (const key of Object.keys(field)) expect(input.ourCars, `${name}: car ${car}'s field`).toContain(Number(key));
      }
    }
  });
});
