// `strategy`'s job in one part per car (SP4.3b Q4 D; spec §7.3 item 4, §8.1 run step 3; plan 4.3b1 Task 25; C51, C2):
// `STRATEGY_JOB.parts.split` cuts the prepared input into one part per our car planned, `run` plans the part's car with
// the whole cap, `merge` joins the parts' outputs. Every `race-monte-carlo` call is recorded with the cap it is handed
// (its third argument; the real search runs).
//
// How these tests read the parts (the test agent's decisions, Task 25 report):
// - The cars "that can be planned" are those `run` ranks (a `Known` entry in its output): in the race, running, sets
//   known, a lap left. Their parts come in `input.ourCars`' order; each part is `{ ...input, planCar }`.
// - A part's calls, in order: with the teammate planned and uncommitted, round 1 is one call planning the teammate at
//   `floor(cap × round1Share)` (our car followed at its commit if it has one, else modelled like a rival: absent from
//   `start.sets`), then one call ranking the part's car against the teammate's round-1 best (`rows[0]`) at the rest.
//   With the teammate committed, or no teammate planned, one call at the whole cap.
// - The part's output is its car's entry from its last call (rows, scenarios), as `run` builds it today.
import { carId, unknown, type CarId, type StrategyOutput } from '@pitwall/domain';
import { createRng } from '@pitwall/engine/readers';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as mc from '../../src/race-monte-carlo/index.ts';
import type { McInput, McResult } from '../../src/race-monte-carlo/index.ts';
import { prepareStrategy, runStrategy, STRATEGY_CONFIG, type StrategyInput } from '../../src/strategy/index.ts';
import { fixedIn, jobParts, json, oursIn, plannedIn, PLAYER, RACE, stopIn, TEAMMATE, TEST_CAP, TRACK, viewAt, type ViewSpec } from './support.ts';

const calls = vi.hoisted(() => ({ list: [] as { input: McInput; cap: number; result: McResult }[] }));

vi.mock('../../src/race-monte-carlo/index.ts', async (importOriginal) => {
  const real = await importOriginal<typeof mc>();
  return {
    ...real,
    raceMonteCarlo: (...args: Parameters<typeof real.raceMonteCarlo>) => {
      const result = real.raceMonteCarlo(...args);
      calls.list.push({ input: args[0], cap: args[2], result });
      return result;
    },
  };
});

beforeEach(() => {
  calls.list = [];
});

const SEED = 1_521_242_744;
const LAP = 3;

/** The prepared input on the race's view at the leader's lap `LAP`, as the worker receives it. */
const inputOf = (spec: ViewSpec = {}): StrategyInput => structuredClone(prepareStrategy(viewAt(RACE(), LAP, spec)));

/** The part of `input` that plans `car`. */
function partFor(input: StrategyInput, car: CarId): StrategyInput {
  const part = jobParts().split(input).find((p) => p.planCar === car);
  expect(part, `a part plans car ${car}`).toBeDefined();
  return part!;
}

const rowsOf = (out: StrategyOutput, car: CarId) => {
  const r = out[car];
  expect(r?.known, `car ${car}: ${json(r)}`).toBe(true);
  return r!.known ? r!.value : (undefined as never);
};

describe('strategy: one part per car (Task 25)', () => {
  // row 1
  it('split gives one part per our car planned, each with planCar; one part, unchanged, when no car can be planned', () => {
    const both = inputOf();
    expect(jobParts().split(both)).toStrictEqual([
      { ...both, planCar: PLAYER },
      { ...both, planCar: TEAMMATE },
    ]);

    // one car planned (the other retired)
    const one = inputOf({ retired: [PLAYER] });
    expect(jobParts().split(one)).toStrictEqual([{ ...one, planCar: TEAMMATE }]);

    // no car can be planned: outside the race, the starting point unknown
    const track = TRACK.known ? TRACK.value : (undefined as never);
    const cases: [string, ViewSpec][] = [
      ['qualifying', { weekendPhase: 'qualifying' }],
      ['no track file', { track: unknown('notApplicable') }],
      ['a track file without braking zones', { track: { ...TRACK, value: { ...track, brakingZones: unknown('notApplicable') } } as typeof TRACK }],
    ];
    for (const [name, spec] of cases) {
      const input = inputOf(spec);
      const parts = jobParts().split(input);
      expect(parts, name).toStrictEqual([input]);
      expect(Object.hasOwn(parts[0]!, 'planCar'), `${name}: no planCar`).toBe(false);
    }
  });

  // row 2
  it('merge takes each car\'s entry from the part that planned it and every other entry from the first part', () => {
    const input = inputOf();
    const parts = jobParts().split(input);
    const outs = parts.map((p) => runStrategy(structuredClone(p), createRng(SEED)));
    const merged = jobParts().merge(outs);
    expect(Object.keys(merged).map(Number).sort()).toEqual([PLAYER, TEAMMATE].sort());
    for (const [k, part] of parts.entries()) {
      const car = part.planCar!;
      rowsOf(outs[k]!, car);
      expect(merged[car], `car ${car} from its part`).toEqual(outs[k]![car]);
    }

    // an entry no part planned (a car of ours not planned) comes from the first part
    const other = carId(9);
    const a = { [PLAYER]: outs[0]![PLAYER]!, [other]: unknown('notApplicable') } as StrategyOutput;
    const b = { [TEAMMATE]: outs[1]![TEAMMATE]!, [other]: unknown('insufficientData') } as StrategyOutput;
    expect(jobParts().merge([a, b])).toEqual({ [PLAYER]: outs[0]![PLAYER], [TEAMMATE]: outs[1]![TEAMMATE], [other]: unknown('notApplicable') });
  });

  // row 3
  it('a part with the teammate uncommitted runs round 1 for the teammate at floor(cap × round1Share) and ranks its car with the rest', () => {
    for (const [cap, share] of [
      [TEST_CAP, undefined],
      [401, 0.33],
    ] as const) {
      const s = share ?? (STRATEGY_CONFIG.defaults as Record<string, unknown>).round1Share as number;
      const config = share === undefined ? { maxScenarioPolicies: cap } : { maxScenarioPolicies: cap, round1Share: share };
      const round1Cap = Math.floor(cap * s);
      const at = `cap ${cap}, share ${s}`;

      // neither committed: round 1 plans the teammate with our car modelled like a rival
      calls.list = [];
      const out = runStrategy(partFor(inputOf({ config }), PLAYER), createRng(SEED));
      expect(calls.list.map((c) => plannedIn(c.input)), at).toEqual([[TEAMMATE], [PLAYER]]);
      const [r1, final] = calls.list as [(typeof calls.list)[number], (typeof calls.list)[number]];
      expect(oursIn(r1.input, PLAYER), `${at}: round 1, our car modelled like a rival`).toBe(false);
      expect(r1.cap, `${at}: round 1's cap`).toBe(round1Cap);
      expect(oursIn(final.input, TEAMMATE), `${at}: the teammate one of ours`).toBe(true);
      expect(fixedIn(final.input, TEAMMATE), `${at}: against the teammate's round-1 best`).toEqual(r1.result[TEAMMATE]!.rows[0]!.policy);
      expect(final.cap, `${at}: the rest of the cap`).toBe(cap - round1Cap);
      const r = rowsOf(out, PLAYER);
      expect(r.rows.map((x) => json(x.policy)), `${at}: the car's rows are its final ranking`).toEqual(final.result[PLAYER]!.rows.map((x) => json(x.policy)));
      expect(r.scenarios, at).toBe(final.result[PLAYER]!.scenarios);
    }

    // our car committed: round 1 plans the teammate against our car's commit
    calls.list = [];
    const p = stopIn(viewAt(RACE(), LAP), PLAYER, 4);
    runStrategy(partFor(inputOf({ decisions: [{ kind: 'planCommitted', carId: PLAYER, policy: p }] }), PLAYER), createRng(SEED));
    expect(calls.list.map((c) => plannedIn(c.input)), 'our car committed').toEqual([[TEAMMATE], [PLAYER]]);
    const [r1, final] = calls.list as [(typeof calls.list)[number], (typeof calls.list)[number]];
    expect(oursIn(r1.input, PLAYER), 'round 1: our car one of ours').toBe(true);
    expect(fixedIn(r1.input, PLAYER), 'round 1: against our commit').toEqual(p);
    expect(r1.cap).toBe(Math.floor(TEST_CAP * 0.2));
    expect(fixedIn(final.input, TEAMMATE)).toEqual(r1.result[TEAMMATE]!.rows[0]!.policy);
    expect(final.cap).toBe(TEST_CAP - Math.floor(TEST_CAP * 0.2));
  });

  // row 4
  it('a part with the teammate committed ranks its car against the commit with the whole cap', () => {
    const p = stopIn(viewAt(RACE(), LAP), TEAMMATE, 5, 'hard');
    const out = runStrategy(partFor(inputOf({ decisions: [{ kind: 'planCommitted', carId: TEAMMATE, policy: p }] }), PLAYER), createRng(SEED));
    expect(calls.list.map((c) => plannedIn(c.input)), 'no round 1').toEqual([[PLAYER]]);
    const call = calls.list[0]!;
    expect(oursIn(call.input, TEAMMATE)).toBe(true);
    expect(fixedIn(call.input, TEAMMATE)).toEqual(p);
    expect(call.cap, 'the whole cap').toBe(TEST_CAP);
    expect(rowsOf(out, PLAYER).rows.map((x) => json(x.policy))).toEqual(call.result[PLAYER]!.rows.map((x) => json(x.policy)));

    // a car planned alone: the whole cap too
    calls.list = [];
    runStrategy(partFor(inputOf({ retired: [PLAYER] }), TEAMMATE), createRng(SEED));
    expect(calls.list.map((c) => [plannedIn(c.input), c.cap]), 'planned alone').toEqual([[[TEAMMATE], TEST_CAP]]);
  });

  // row 5
  it('run without planCar equals the merge of its parts run one after another with the same rng', () => {
    const p = stopIn(viewAt(RACE(), LAP), TEAMMATE, 5, 'hard');
    const cases: [string, ViewSpec][] = [
      ['no commit', {}],
      ['the teammate committed', { decisions: [{ kind: 'planCommitted', carId: TEAMMATE, policy: p }] }],
      ['one car planned', { retired: [PLAYER] }],
    ];
    for (const [name, spec] of cases) {
      const input = inputOf(spec);
      const whole = runStrategy(structuredClone(input), createRng(SEED));
      const rng = createRng(SEED);
      const outs = jobParts()
        .split(input)
        .map((part) => runStrategy(structuredClone(part), rng));
      expect(whole, name).toEqual(jobParts().merge(outs));
    }
  });
});
