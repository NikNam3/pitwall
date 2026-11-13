// `strategy`'s job: the scenario-policy cap over the rounds and the one candidate step (plan 4.3b1 Task 20d; SP4.3b
// spec §8.1, §7.3; C2, C51). Every `race-monte-carlo` call the job makes is recorded with the cap it is handed (its third
// argument; the real search runs), so the tests see each round's share of `maxScenarioPolicies`.
//
// How these tests read the job (the test agent's decisions, Task 20d report):
// - A call is round 1 when it plans one car with our other planned car modelled like a rival (not in `start.sets`);
//   every other call is a final ranking. The cap a call gets is the third argument of `raceMonteCarlo`.
// - Ported in Task 25 (one part per car, SP4.3b Q4 D; `parts.test.ts`): each car's part has the whole cap. With the
//   teammate uncommitted, round 1 plans the teammate at `floor(cap × round1Share)` (strategy config, default 0.2) and
//   the car's final call gets the rest; with the teammate committed, or the car planned alone, one call at the whole
//   cap. The run without `planCar` runs the parts one after another in our cars' order. With `round1Share` 0 there is
//   no round 1: each car's one call plans it against the other modelled like a rival.
// - `candidatesForRun(input, rng)` (`strategy/job.ts`) gives `mc`, the `race-monte-carlo` input with both planned cars'
//   candidates, the committed policies, the hazard, the rival rules and the config's search settings at the whole cap;
//   `scripts/gen-strategy-reference.ts` builds its input through it, restating none of the candidate step.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CarId, StrategyOutput } from '@pitwall/domain';
import { createRng } from '@pitwall/engine/readers';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { strategyReferenceInput } from '../../../../scripts/gen-strategy-reference.ts';
import { generateRace, GENERATOR_DEFAULTS } from '../../../../test-support/race-generator/index.ts';
import type * as mc from '../../src/race-monte-carlo/index.ts';
import type { McInput, McResult } from '../../src/race-monte-carlo/index.ts';
import { prepareStrategy, runStrategy, STRATEGY_CONFIG } from '../../src/strategy/index.ts';
import { candidatesForRun } from '../../src/strategy/job.ts';
import { fixedIn, json, oursIn, plannedIn, PLAYER, RACE, stopIn, TEAMMATE, TEST_CAP, viewAt, type ViewSpec } from './support.ts';

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

/** The job's output on the race's view at the leader's lap `LAP`, as the worker computes it. */
function planned(spec: ViewSpec = {}): StrategyOutput {
  return runStrategy(structuredClone(prepareStrategy(viewAt(RACE(), LAP, spec))), createRng(SEED));
}

/** The call's one planned car and whether it is round 1 (our other car `of` modelled like a rival). */
function callOf(c: (typeof calls.list)[number]): { car: CarId; round1: boolean } {
  const cars = plannedIn(c.input);
  expect(cars, 'a call plans one car').toHaveLength(1);
  const car = cars[0]!;
  const other = car === PLAYER ? TEAMMATE : PLAYER;
  return { car, round1: !oursIn(c.input, other) };
}

describe('strategy: the cap over the rounds (Task 20d)', () => {
  // ported in Task 25 (one part per car, SP4.3b Q4 D): the run without `planCar` plans each car as its part does, one
  // after another in our cars' order; each part has the whole cap (round 1 for the teammate, then the car's final call)
  it('with no commit, each car\'s part runs round 1 for the teammate at round1Share of the cap and the car\'s final ranking at the rest; a part\'s total never exceeds maxScenarioPolicies', () => {
    for (const [cap, share] of [
      [TEST_CAP, undefined],
      [401, 0.33],
    ] as const) {
      calls.list = [];
      const config = share === undefined ? { maxScenarioPolicies: cap } : { maxScenarioPolicies: cap, round1Share: share };
      planned({ config });
      const s = share ?? 0.2;
      const read = calls.list.map((c) => ({ ...callOf(c), cap: c.cap }));
      const at = `cap ${cap}, share ${s}`;
      const r1 = Math.floor(cap * s);
      // the player's part (round 1 of the teammate, the player's final), then the teammate's part
      expect(read, at).toEqual([
        { car: TEAMMATE, round1: true, cap: r1 },
        { car: PLAYER, round1: false, cap: cap - r1 },
        { car: PLAYER, round1: true, cap: r1 },
        { car: TEAMMATE, round1: false, cap: cap - r1 },
      ]);
      for (const k of [0, 2]) expect(read[k]!.cap + read[k + 1]!.cap, `${at}: a part's total`).toBeLessThanOrEqual(cap);
    }
    expect((STRATEGY_CONFIG.defaults as Record<string, unknown>).round1Share, 'the default share').toBe(0.2);
  });

  // ported in Task 25: a car whose teammate committed gets the whole cap; the committed car's part plans round 1 for
  // the teammate against the commit
  it('with the teammate committed or one car planned, the car\'s final call gets the whole cap', () => {
    // one car planned (no teammate): one call, the whole cap
    planned({ teammate: null });
    expect(calls.list.map((c) => plannedIn(c.input)), 'one car planned').toEqual([[PLAYER]]);
    expect(calls.list[0]!.cap, 'one car planned').toBe(TEST_CAP);

    // a commit on the teammate: the player's part one call at the whole cap against it; the teammate's part round 1
    // for the player (against the commit) at its share, then the teammate's final at the rest
    calls.list = [];
    const p = stopIn(viewAt(RACE(), LAP), TEAMMATE, 5, 'hard');
    planned({ decisions: [{ kind: 'planCommitted', carId: TEAMMATE, policy: p }] });
    expect(calls.list.map((c) => plannedIn(c.input)), 'a commit').toEqual([[PLAYER], [PLAYER], [TEAMMATE]]);
    const r1 = Math.floor(TEST_CAP * 0.2);
    expect(calls.list.map((c) => c.cap), 'a commit').toEqual([TEST_CAP, r1, TEST_CAP - r1]);
    for (const c of calls.list.slice(0, 2)) expect(fixedIn(c.input, TEAMMATE), 'against the commit').toEqual(p);
    expect(fixedIn(calls.list[2]!.input, PLAYER), "the teammate against the player's round-1 best").toEqual(calls.list[1]!.result[PLAYER]!.rows[0]!.policy);
  });

  // ported in Task 25: each call is its part's only one, with the whole cap
  it('round1Share 0 skips round 1 and plans each car against the other modelled like a rival', () => {
    const out = planned({ config: { maxScenarioPolicies: TEST_CAP, round1Share: 0 } });
    const read = calls.list.map((c) => ({ ...callOf(c), cap: c.cap, result: c.result }));
    // one call per car, the other modelled like a rival
    expect(read.map((c) => c.car).sort()).toEqual([PLAYER, TEAMMATE].sort());
    for (const c of read) expect(c.round1, `car ${c.car}: the other modelled like a rival`).toBe(true);
    // those calls are the final rankings, each its part's whole cap
    for (const c of read) expect(c.cap, `car ${c.car}: the whole cap`).toBe(TEST_CAP);
    for (const c of read) {
      const r = out[c.car];
      expect(r?.known, `car ${c.car}: ${json(r)}`).toBe(true);
      const rows = r!.known ? r!.value.rows : [];
      expect(rows.map((x) => json(x.policy)), `car ${c.car}: its rows are its call's ranking`).toEqual(c.result[c.car]!.rows.map((x) => json(x.policy)));
    }
  });
});

describe('strategy: one candidate step (Task 20d)', () => {
  it("the reference script's input equals candidatesForRun's for the same view", () => {
    // the script's view and seeds (scripts/gen-strategy-reference.ts: the generator's default race, seed 1, the first
    // frame of the leader's lap 2, the config's cap; the plain forecast's seed 2,025)
    const config = STRATEGY_CONFIG.defaults;
    const race = generateRace(GENERATOR_DEFAULTS, 1).race;
    const input = prepareStrategy(viewAt(race, 2, { frameOfLap: 0, config: { maxScenarioPolicies: config.maxScenarioPolicies } }));
    const { mc: fromJob } = candidatesForRun(structuredClone(input), createRng(2_025));
    expect(strategyReferenceInput()).toEqual(fromJob);

    // the script restates none of the job's candidate step: it imports it
    const script = readFileSync(join(import.meta.dirname, '../../../../scripts/gen-strategy-reference.ts'), 'utf8');
    expect(script).toMatch(/\bcandidatesForRun\b/);
    for (const step of ['hazardOf', 'plainRoad', 'trafficOf', 'dpInputOf', 'mcConfigOf']) {
      expect(script, `the script defines no ${step}`).not.toMatch(new RegExp(`(function|const)\\s+${step}\\b`));
    }
  });
});
