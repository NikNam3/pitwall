// `pit-sweep`'s job in one part per car (SP4.3b2 Task 8c, Q9 A; C2, C32, C49, C51): `PIT_SWEEP_JOB.parts.split` cuts
// the prepared input into one part per our car, `run` sweeps the part's car, `merge` joins the parts' outputs into the
// same `PitSweepOutput` keyed by car. Mirrors `strategy`'s parts (`../strategy/parts.test.ts`).
//
// How these tests read the parts (the test agent's decisions, Task 8c report):
// - A part is the input with `cars` cut to that car's entry: `{ ...input, cars: { [car]: input.cars[car] } }`; the
//   shared `strategy` input (a committed teammate is a certain input of the call, as before) and the config stay whole.
// - The parts come in `input.strategy.ourCars`' order, one per our car with a `cars` entry, also for a car the
//   behaviour table rules out (its part gives its `notApplicable` entry, as before). An input without any such car is
//   one part, unchanged (the job runner needs at least one).
// - A run without parts equals the merge of the parts run one after another with the same generator.
import { carId, unknown, type CarId } from '@pitwall/domain';
import { createRng } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { PIT_SWEEP_JOB, type PitSweepInput, type PitSweepOutput } from '../../src/pit-sweep/index.ts';
import { run } from '../../src/pit-sweep/job.ts';
import { json, OURS, PLAYER, RACE, sweepViewAt, TEAMMATE, type SweepSpec } from './support.ts';

const SEED = 640_118_293;
const LAP = 3;

/** The job's parts; fails the test when the job declares none. */
function jobParts(): NonNullable<typeof PIT_SWEEP_JOB.parts> {
  const parts = PIT_SWEEP_JOB.parts;
  if (parts === undefined) throw new Error('PIT_SWEEP_JOB declares no parts (Task 8c: one part per our car)');
  return parts;
}

/** The prepared input on the race's view at the leader's lap `LAP`, as the worker receives it. */
const inputOf = (spec: SweepSpec = {}): PitSweepInput => structuredClone(PIT_SWEEP_JOB.prepare(sweepViewAt(RACE(), LAP, spec)));

/** The input cut to car `car`. */
const cutTo = (input: PitSweepInput, car: CarId): PitSweepInput => ({ ...input, cars: { [car]: input.cars[car]! } });

/** The parts run one after another with one generator, merged. */
function mergedRun(input: PitSweepInput, seed = SEED): PitSweepOutput {
  const rng = createRng(seed);
  return jobParts().merge(jobParts().split(input).map((part) => run(structuredClone(part), rng)));
}

describe('pit-sweep: one part per car (Task 8c)', () => {
  // row 1
  it('the job declares parts: one per our car, each holding only that car\'s input', () => {
    const both = inputOf();
    expect(Object.keys(both.cars).map(Number).sort(), 'the prepared input holds both our cars').toEqual([...OURS].sort());
    const parts = jobParts().split(both);
    expect(parts).toStrictEqual([cutTo(both, PLAYER), cutTo(both, TEAMMATE)]);
    for (const part of parts) {
      expect(part.strategy, 'the shared strategy input whole').toStrictEqual(both.strategy);
      expect(part.config, 'the config whole').toStrictEqual(both.config);
      // a part's run sweeps its car only
      expect(Object.keys(run(structuredClone(part), createRng(SEED))).map(Number)).toEqual(Object.keys(part.cars).map(Number));
    }

    // one car of ours (no teammate): one part
    const one = inputOf({ teammate: null });
    expect(jobParts().split(one)).toStrictEqual([cutTo(one, PLAYER)]);

    // no car of ours to sweep: one part, the input unchanged
    const none: PitSweepInput = { ...both, cars: {} };
    expect(jobParts().split(none)).toStrictEqual([none]);
  });

  // row 2
  it('merge of the parts equals the output of a run without parts for the same seed', () => {
    const cases: [string, SweepSpec][] = [
      ['both cars', {}],
      ['stint.latest unknown, one compound', { window: { compounds: ['hard'], latestIn: null } }],
      ['one car of ours', { teammate: null }],
    ];
    for (const [name, spec] of cases) {
      const input = inputOf(spec);
      const whole = run(structuredClone(input), createRng(SEED));
      expect(Object.keys(whole).length, `${name}: the run sweeps a car`).toBeGreaterThan(0);
      expect(mergedRun(input), name).toEqual(whole);
    }

    // merge keys each car from its part
    const input = inputOf();
    const outs = jobParts()
      .split(input)
      .map((part) => run(structuredClone(part), createRng(SEED)));
    const merged = jobParts().merge(outs);
    expect(Object.keys(merged).map(Number).sort()).toEqual([...OURS].sort());
    expect(merged[PLAYER], 'the player from its part').toEqual(outs[0]![PLAYER]);
    expect(merged[TEAMMATE], 'the teammate from its part').toEqual(outs[1]![TEAMMATE]);
  });

  // row 3
  it('a car without a part (a rival) is absent; our car outside the race phase is present with unknown', () => {
    const rival = carId(0);
    expect(OURS.includes(rival), 'car 0 is a rival').toBe(false);

    const racing = mergedRun(inputOf());
    expect(Object.hasOwn(racing, rival), `a rival is absent: ${json(Object.keys(racing))}`).toBe(false);
    expect(Object.keys(racing).map(Number).sort()).toEqual([...OURS].sort());

    const qualifying = inputOf({ weekendPhase: 'qualifying' });
    expect(jobParts().split(qualifying), 'one part per our car outside the race phase too').toHaveLength(OURS.length);
    const out = mergedRun(qualifying);
    expect(Object.keys(out).map(Number).sort()).toEqual([...OURS].sort());
    for (const car of OURS) expect(out[car], `qualifying, car ${car}`).toMatchObject({ carId: car, auto: unknown('notApplicable'), byCompound: {} });
  });
});
