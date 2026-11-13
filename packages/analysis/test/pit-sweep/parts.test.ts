// `pit-sweep`'s job in one part per our car and compound (SP4.3b2 Task 18q, Q10 A; before: one part per car, Task 8c;
// C2, C32, C49, C51): `PIT_SWEEP_JOB.parts.split` cuts the prepared input into one part per (our car, compound with a
// new set), `run` sweeps the part's car and compound, `merge` rebuilds the same `PitSweepOutput` keyed by car, its
// `byCompound` joined from the car's parts.
//
// How these tests read the parts (the test agent's decisions, Tasks 8c and 18q):
// - A part's input holds one car in `cars`, whose `compounds` is the part's one compound; the shared `strategy` input
//   (a committed teammate is a certain input of the call, as before) and the config stay whole. What else a part's car
//   entry holds (its windows per compound, Task 18q B) is the job's.
// - The parts come in `input.strategy.ourCars`' order and, per car, in its `compounds`' order. A car the behaviour table
//   rules out, or one without a compound, gets one part (it yields the car's entry: `notApplicable`, or no table). An
//   input without any car of ours is one part, unchanged (the job runner needs at least one).
// - A run without parts equals the merge of the parts run one after another with the same generator (the same draws
//   per car and compound).
import { carId, unknown, type CarId } from '@pitwall/domain';
import { createRng } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { PIT_SWEEP_JOB, type PitSweepInput, type PitSweepOutput } from '../../src/pit-sweep/index.ts';
import { run } from '../../src/pit-sweep/job.ts';
import { json, OURS, PLAYER, RACE, sweepViewAt, type SweepSpec } from './support.ts';

const SEED = 640_118_293;
const LAP = 3;

/** The job's parts; fails the test when the job declares none. */
function jobParts(): NonNullable<typeof PIT_SWEEP_JOB.parts> {
  const parts = PIT_SWEEP_JOB.parts;
  if (parts === undefined) throw new Error('PIT_SWEEP_JOB declares no parts (Task 18q: one part per our car and compound)');
  return parts;
}

/** The prepared input on the race's view at the leader's lap `LAP`, as the worker receives it. */
const inputOf = (spec: SweepSpec = {}): PitSweepInput => structuredClone(PIT_SWEEP_JOB.prepare(sweepViewAt(RACE(), LAP, spec)));

/** The parts run one after another with one generator, merged. */
function mergedRun(input: PitSweepInput, seed = SEED): PitSweepOutput {
  const rng = createRng(seed);
  return jobParts().merge(jobParts().split(input).map((part) => run(structuredClone(part), rng)));
}

/** A part's (car, compound): its one car and, where it sweeps one, its one compound. */
function keyOf(part: PitSweepInput): { car: CarId; compounds: readonly string[] } {
  const cars = Object.keys(part.cars).map((k) => Number(k) as CarId);
  expect(cars, `a part holds one car: ${json(cars)}`).toHaveLength(1);
  return { car: cars[0]!, compounds: part.cars[cars[0]!]!.compounds };
}

describe('pit-sweep: one part per car and compound (Task 18q)', () => {
  // Task 18q row 1
  it('the job declares one part per our car and compound with a new set; a ruled-out car gets one part', () => {
    const both = inputOf();
    expect(Object.keys(both.cars).map(Number).sort(), 'the prepared input holds both our cars').toEqual([...OURS].sort());
    const parts = jobParts().split(both);
    const expected = OURS.flatMap((car) => both.cars[car]!.compounds.map((compound) => ({ car, compounds: [compound] })));
    expect(both.cars[PLAYER]!.compounds.length, 'the player has three compounds').toBe(3);
    expect(parts.map(keyOf), 'one part per (car, compound), in our cars\' and their compounds\' order').toEqual(expected);
    parts.forEach((part) => {
      const { car } = keyOf(part);
      const whole = both.cars[car]!;
      expect(part.strategy, 'the shared strategy input whole').toStrictEqual(both.strategy);
      expect(part.config, 'the config whole').toStrictEqual(both.config);
      expect(part.cars[car], `car ${car}: lap, applies, auto, flag and latest as prepared`).toMatchObject({
        lap: whole.lap,
        applies: whole.applies,
        auto: whole.auto,
        flag: whole.flag,
        latest: whole.latest,
        greenRejoin: whole.greenRejoin,
      });
      // a part's run sweeps its car and its compound only
      const out = run(structuredClone(part), createRng(SEED));
      expect(Object.keys(out).map(Number)).toEqual([car]);
      expect(Object.keys(out[car]!.byCompound), `car ${car}`).toEqual(part.cars[car]!.compounds);
    });

    // one car of ours (no teammate): its compounds only
    const one = inputOf({ teammate: null });
    expect(jobParts().split(one).map(keyOf).map((k) => k.car)).toEqual(one.cars[PLAYER]!.compounds.map(() => PLAYER));

    // a ruled-out car (qualifying; our car in the pit lane): one part each, whatever its compounds
    for (const [name, spec] of [
      ['qualifying', { weekendPhase: 'qualifying' }],
      ['boxStop', { spans: [{ machine: 'car-activity-race', carId: PLAYER, kind: 'boxStop' }] }],
    ] as [string, SweepSpec][]) {
      const input = inputOf(spec);
      const ruledOut = OURS.filter((car) => !input.cars[car]!.applies);
      expect(ruledOut.length, `${name}: a car is ruled out`).toBeGreaterThan(0);
      const cars = jobParts().split(input).map((p) => keyOf(p).car);
      for (const car of ruledOut) expect(cars.filter((c) => c === car), `${name}: car ${car}`).toHaveLength(1);
      const out = mergedRun(input);
      for (const car of ruledOut) expect(out[car], `${name}: car ${car}`).toMatchObject({ carId: car, auto: unknown('notApplicable'), byCompound: {} });
    }

    // a car without a compound (pit-window names no set): one part, its entry without a table
    const bare = inputOf({ window: { compounds: [] } });
    expect(jobParts().split(bare).map((p) => keyOf(p).car)).toEqual([...OURS]);
    for (const car of OURS) expect(mergedRun(bare)[car], `car ${car} without a set`).toMatchObject({ carId: car, byCompound: {} });

    // no car of ours to sweep: one part, the input unchanged
    const none: PitSweepInput = { ...both, cars: {} };
    expect(jobParts().split(none)).toStrictEqual([none]);
  });

  // Task 18q row 2
  it('merge of the parts equals a run without parts for the same seed', () => {
    const cases: [string, SweepSpec][] = [
      ['both cars', {}],
      ['stint.latest unknown, one compound', { window: { compounds: ['hard'], latestIn: null } }],
      ['windows of their own', { window: { latestIn: 6, earliestIn: 5, earliestBy: { soft: 6 }, noWindow: ['hard'] } }],
      ['one car of ours', { teammate: null }],
      ['the player in the pit lane', { spans: [{ machine: 'car-activity-race', carId: PLAYER, kind: 'boxStop' }] }],
    ];
    for (const [name, spec] of cases) {
      const input = inputOf(spec);
      const whole = run(structuredClone(input), createRng(SEED));
      expect(Object.keys(whole).length, `${name}: the run sweeps a car`).toBeGreaterThan(0);
      const merged = mergedRun(input);
      expect(merged, name).toEqual(whole);
      expect(json(merged), `${name}: bit-identical`).toBe(json(whole));
    }

    // merge rebuilds each car from its parts: lap, position and auto once, byCompound joined
    const input = inputOf();
    const parts = jobParts().split(input);
    const outs = parts.map((part) => run(structuredClone(part), createRng(SEED)));
    const merged = jobParts().merge(outs);
    expect(Object.keys(merged).map(Number).sort()).toEqual([...OURS].sort());
    for (const car of OURS) {
      const mine = outs.filter((_, i) => keyOf(parts[i]!).car === car);
      expect(mine.length, `car ${car}: its parts`).toBe(input.cars[car]!.compounds.length);
      const m = merged[car]!;
      expect({ carId: m.carId, lap: m.lap, position: m.position, auto: m.auto }, `car ${car}`).toEqual({
        carId: mine[0]![car]!.carId,
        lap: mine[0]![car]!.lap,
        position: mine[0]![car]!.position,
        auto: mine[0]![car]!.auto,
      });
      expect(m.byCompound, `car ${car}: byCompound joined`).toEqual(Object.assign({}, ...mine.map((o) => o[car]!.byCompound)));
    }
  });

  // Task 8c row 3 (kept)
  it('a car without a part (a rival) is absent; our car outside the race phase is present with unknown', () => {
    const rival = carId(0);
    expect(OURS.includes(rival), 'car 0 is a rival').toBe(false);

    const racing = mergedRun(inputOf());
    expect(Object.hasOwn(racing, rival), `a rival is absent: ${json(Object.keys(racing))}`).toBe(false);
    expect(Object.keys(racing).map(Number).sort()).toEqual([...OURS].sort());

    const qualifying = inputOf({ weekendPhase: 'qualifying' });
    expect(jobParts().split(qualifying), 'one part per our car outside the race phase').toHaveLength(OURS.length);
    const out = mergedRun(qualifying);
    expect(Object.keys(out).map(Number).sort()).toEqual([...OURS].sort());
    for (const car of OURS) expect(out[car], `qualifying, car ${car}`).toMatchObject({ carId: car, auto: unknown('notApplicable'), byCompound: {} });
  });
});
