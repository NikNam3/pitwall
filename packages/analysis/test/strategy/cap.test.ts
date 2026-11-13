// `strategy`'s job: the scenario-policy cap over the rounds and the one candidate step (plan 4.3b1 Task 20d; SP4.3b
// spec §8.1, §7.3; C2, C51). Every `race-monte-carlo` call the job makes is recorded with the cap it is handed (its third
// argument; the real search runs), so the tests see each round's share of `maxScenarioPolicies`.
//
// How these tests read the job (the test agent's decisions, Task 20d report):
// - A call is round 1 when it plans one car with our other planned car modelled like a rival (not in `start.sets`);
//   every other call is a final ranking. The cap a call gets is the third argument of `raceMonteCarlo`.
// - Round 1 (no commit on either car) gets `round1Share` (strategy config, default 0.2) of the cap, split evenly over
//   the cars planned; the final calls share the rest evenly; integer caps, so each share is rounded down (a call's cap
//   is at most one below its exact share). With `round1Share` 0 there is no round 1: each car's one call plans it
//   against the other modelled like a rival.
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
import { json, oursIn, plannedIn, PLAYER, RACE, stopIn, TEAMMATE, TEST_CAP, viewAt, type ViewSpec } from './support.ts';

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

const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);

/** Caps of `n` calls sharing `total` evenly: each at most its exact share and at most one below it. */
function expectShared(caps: readonly number[], total: number, what: string): void {
  for (const cap of caps) {
    expect(Number.isInteger(cap), `${what}: an integer cap`).toBe(true);
    expect(cap, what).toBeLessThanOrEqual(total / caps.length);
    expect(cap, what).toBeGreaterThan(total / caps.length - 1);
  }
}

describe('strategy: the cap over the rounds (Task 20d)', () => {
  it('with no commit, round 1 uses round1Share of the cap and the final rankings the rest; the run\'s total never exceeds maxScenarioPolicies', () => {
    for (const [cap, share] of [
      [TEST_CAP, undefined],
      [401, 0.33],
    ] as const) {
      calls.list = [];
      const config = share === undefined ? { maxScenarioPolicies: cap } : { maxScenarioPolicies: cap, round1Share: share };
      planned({ config });
      const s = share ?? 0.2;
      const read = calls.list.map((c) => ({ ...callOf(c), cap: c.cap }));
      const round1 = read.filter((c) => c.round1);
      const final = read.filter((c) => !c.round1);
      const at = `cap ${cap}, share ${s}`;
      expect(round1.map((c) => c.car).sort(), `${at}: round 1 once per car`).toEqual([PLAYER, TEAMMATE].sort());
      expect(final.map((c) => c.car).sort(), `${at}: one final ranking per car`).toEqual([PLAYER, TEAMMATE].sort());
      // round 1 before the final rankings
      expect(read.findIndex((c) => !c.round1), at).toBe(2);
      // round 1: its share of the cap, split over the two cars
      expectShared(round1.map((c) => c.cap), Math.floor(cap * s), `${at}, round 1`);
      // the final rankings: the rest
      const rest = cap - sum(round1.map((c) => c.cap));
      expectShared(final.map((c) => c.cap), rest, `${at}, final`);
      expect(sum(read.map((c) => c.cap)), `${at}: the run's total`).toBeLessThanOrEqual(cap);
    }
    expect((STRATEGY_CONFIG.defaults as Record<string, unknown>).round1Share, 'the default share').toBe(0.2);
  });

  it('with one car committed or one car planned, the final call gets the whole cap', () => {
    // one car planned (no teammate): one call, the whole cap
    planned({ teammate: null });
    expect(calls.list.map((c) => plannedIn(c.input)), 'one car planned').toEqual([[PLAYER]]);
    expect(calls.list[0]!.cap, 'one car planned').toBe(TEST_CAP);

    // a commit on one car: no round 1; the final calls (one per car) share the whole cap
    calls.list = [];
    const p = stopIn(viewAt(RACE(), LAP), TEAMMATE, 5, 'hard');
    planned({ decisions: [{ kind: 'planCommitted', carId: TEAMMATE, policy: p }] });
    const read = calls.list.map((c) => ({ ...callOf(c), cap: c.cap }));
    expect(read.filter((c) => c.round1), 'a commit: no round 1').toEqual([]);
    expect(read.map((c) => c.car).sort(), 'a commit: one final ranking per car').toEqual([PLAYER, TEAMMATE].sort());
    expectShared(read.map((c) => c.cap), TEST_CAP, 'a commit, final');
    expect(sum(read.map((c) => c.cap))).toBeLessThanOrEqual(TEST_CAP);
  });

  it('round1Share 0 skips round 1 and plans each car against the other modelled like a rival', () => {
    const out = planned({ config: { maxScenarioPolicies: TEST_CAP, round1Share: 0 } });
    const read = calls.list.map((c) => ({ ...callOf(c), cap: c.cap, result: c.result }));
    // one call per car, the other modelled like a rival
    expect(read.map((c) => c.car).sort()).toEqual([PLAYER, TEAMMATE].sort());
    for (const c of read) expect(c.round1, `car ${c.car}: the other modelled like a rival`).toBe(true);
    // those calls are the final rankings: the whole cap between them
    expectShared(read.map((c) => c.cap), TEST_CAP, 'round1Share 0');
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
