// The planning job (SP4.3d2 Task 9 rows 1, 4 and 7; SP4.3d spec §7.1 steps 4–5, §7.2; C3, C43, C50, C51, C62d):
// `planningInputFrom(asOf, round)` builds the strategy input on the ended qualifying session's as-of view (the starting
// point's units and `race-hazard` run on it, the grid `gridOf`'s, the race's start from `buildGridStart` with our cars'
// start compounds free; `committed` each car's active prepared policy; `positions` the grid places; `planned` our
// cars), and `PLANNING_JOB` (id `planning`) runs it with the strategy job's module and parts. Its output per our car:
// the rows (the DP's carry the start compound it chose), the prefill (always), and `planning`: the car's grid place,
// the entered laps and the highest rain chance of the race's forecast samples.
//
// The qualifying session is `./planning-support.ts`' (a builder race recast as an ended one-shot qualifying). Every
// `race-monte-carlo` call is recorded (the real search runs), as in `slots.test.ts`.
//
// How these rows read the job (the test agent's decisions, Task 9):
// - `planningInputFrom` is exported by `shared/strategy-input/index.ts`; `PLANNING_JOB` and `prefillOf` by
//   `strategy/index.ts`; `gridOf` is Task 7's (`shared/grid.ts`: this file fails to load until Task 7 merges).
// - The grid place of a car is its index in `gridOf(asOf)` plus 1.
// - "Car 2's run has car 1's active prepared policy as committed" is read on our cars 2 (player) and 5 (teammate): the
//   final `race-monte-carlo` call that plans the player follows the teammate's active prepared policy as certain input.
import { IMPORTED, NOISE_COMPOUNDS, type CarId, type Policy, type StrategyOutput } from '@pitwall/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as mc from '../../src/race-monte-carlo/index.ts';
import type { McInput, McResult } from '../../src/race-monte-carlo/index.ts';
import { planningInputFrom } from '../../src/shared/strategy-input/index.ts';
import { gridOf } from '../../src/shared/grid.ts';
import { PLANNING_JOB, prefillOf, STRATEGY_JOB, type StrategyInput } from '../../src/strategy/index.ts';
import { NO_PLANS, qualifyingAsOf, RACE_FORECAST_MAX_RAIN, runPlanning, type PreparedRound } from './planning-support.ts';
import { json, once, oursIn, plannedIn, OURS, PLAYER, RACE, TEAMMATE } from './support.ts';

const calls = vi.hoisted(() => ({ list: [] as { input: McInput; result: McResult }[] }));

vi.mock('../../src/race-monte-carlo/index.ts', async (importOriginal) => {
  const real = await importOriginal<typeof mc>();
  return {
    ...real,
    raceMonteCarlo: (...args: Parameters<typeof real.raceMonteCarlo>) => {
      const result = real.raceMonteCarlo(...args);
      calls.list.push({ input: args[0], result });
      return result;
    },
  };
});

beforeEach(() => {
  calls.list = [];
});

/** The race's laps as the user entered them. */
const LAPS = 44;
const SEED = 1_521_242_744;

const QUALIFYING = once(() => qualifyingAsOf(RACE(), { laps: LAPS }));

type CarRows = Extract<StrategyOutput[CarId], { known: true }>['value'];

/** Car `car`'s entry; fails the test when it has none. */
function entryOf(out: StrategyOutput, car: CarId): CarRows {
  const r = out[car];
  expect(r?.known, `car ${car}: ${json(r)}`).toBe(true);
  return r!.known ? r!.value : (undefined as never);
}

/** The planning input on the qualifying view with `prepared` (default: none). */
const inputOf = (prepared: PreparedRound = NO_PLANS(OURS), asOf = QUALIFYING(), sets: 'carried' | 'fresh' = 'carried'): StrategyInput =>
  planningInputFrom(asOf, { laps: LAPS, race: { laps: LAPS, sets, conditions: IMPORTED }, prepared });

/** The grid place of car `car` on the qualifying view: its index in `gridOf` plus 1. */
function gridPlaceOf(car: CarId): number {
  const grid = gridOf(QUALIFYING());
  expect(grid.known, grid.known ? '' : grid.reason).toBe(true);
  return (grid.known ? grid.value.indexOf(car) : -2) + 1;
}

describe('the planning job (SP4.3d2 Task 9)', () => {
  it('1: planning rows: the job is the strategy job\'s module and parts, id planning', () => {
    expect(PLANNING_JOB.id).toBe('planning');
    expect(PLANNING_JOB.module.href, "the strategy job's module").toBe(STRATEGY_JOB.module.href);
    // the same split and merge
    expect(PLANNING_JOB.parts, "the strategy job's parts").toEqual(STRATEGY_JOB.parts);
  });

  it('1: planning rows: the input on the qualifying view: the grid start of the entered laps, our cars free and planned, positions the grid places', () => {
    const input = inputOf();
    expect(input.ourCars).toEqual([...OURS]);
    expect([...input.planned].sort((a, b) => a - b), 'planned: our cars').toEqual([...OURS].sort((a, b) => a - b));
    expect(input.start.known, input.start.known ? '' : input.start.reason).toBe(true);
    if (!input.start.known) return;
    const start = input.start.value;
    expect(start.lapsTotal).toBe(LAPS);
    expect(start.lap).toBe(1);
    const grid = gridOf(QUALIFYING());
    expect(grid.known).toBe(true);
    if (grid.known) expect(Array.from(start.order), 'the grid order').toEqual([...grid.value]);
    expect(start.start, 'the grid start').not.toBeNull();
    for (const car of OURS) {
      expect(start.start!.freeCompound[car], `car ${car}: start compound free`).toBe(1);
      expect(input.positions[car], `car ${car}: its grid place`).toBe(gridPlaceOf(car));
      expect(input.committed[car], `car ${car}: nothing prepared`).toBeNull();
    }
    expect(input.hazard.known, "race-hazard's qualifying row").toBe(true);
    // a job's input crosses to a worker (C51)
    expect(() => structuredClone(input)).not.toThrow();
  });

  it('1: planning rows: a builder qualifying as-of view and laps 44 → per our car rows with startCompound on every DP row, planning.laps 44', () => {
    const out = runPlanning(inputOf(), SEED);
    for (const car of OURS) {
      const entry = entryOf(out, car);
      expect(entry.rows.length, `car ${car}: rows`).toBeGreaterThan(0);
      const dp = entry.rows.filter((r) => r.source === 'dp');
      expect(dp.length, `car ${car}: DP rows`).toBeGreaterThan(0);
      for (const r of dp) {
        expect(r.policy.startCompound, `car ${car}: ${json(r.policy)}`).toBeDefined();
        expect(NOISE_COMPOUNDS).toContain(r.policy.startCompound);
      }
      // the planning round's facts: grid place, the entered laps, the race forecast's highest rain chance
      expect(entry.planning, `car ${car}: planning`).not.toBeNull();
      expect(entry.planning!.laps).toBe(LAPS);
      expect(entry.planning!.gridPlace).toMatchObject({ known: true, value: gridPlaceOf(car) });
      expect(entry.planning!.rainPct).toMatchObject({ known: true, value: RACE_FORECAST_MAX_RAIN });
      // the planning job always prefills: A the best row (nothing prepared)
      expect(entry.prefill.A, `car ${car}: A`).toEqual(entry.rows[0]!.policy);
      expect(entry.prefill, `car ${car}: prefillOf's`).toEqual(prefillOf(entry.rows, entry.bestPerStops, {}, new Set()));
    }
  }, 120_000);

  it('1: planning rows: no forecast samples → rainPct unknown (C3)', () => {
    const asOf = qualifyingAsOf(RACE(), { laps: LAPS, forecast: null });
    const out = runPlanning(inputOf(NO_PLANS(OURS), asOf), SEED);
    for (const car of OURS) {
      const entry = entryOf(out, car);
      expect(entry.planning, `car ${car}: planning`).not.toBeNull();
      expect(entry.planning!.rainPct.known, `car ${car}: rainPct`).toBe(false);
    }
  }, 120_000);

  it('4: teammate: car 2\'s run has car 5\'s active prepared policy as committed', () => {
    const own: Policy = { startCompound: 'soft', stops: [{ lap: 15, compound: 'hard' }] };
    const mateA: Policy = { startCompound: 'medium', stops: [{ lap: 24, compound: 'hard' }] };
    const mateB: Policy = { startCompound: 'soft', stops: [{ lap: 12, compound: 'medium' }, { lap: 30, compound: 'hard' }] };
    const prepared: PreparedRound = {
      [PLAYER]: { saved: { A: own }, active: 'A' },
      [TEAMMATE]: { saved: { A: mateA, B: mateB }, active: 'B' },
    };
    const input = inputOf(prepared);
    expect(input.committed[TEAMMATE], "the teammate's active prepared policy").toEqual(mateB);
    expect(input.committed[PLAYER], "the player's active prepared policy").toEqual(own);
    expect(input.slots?.[TEAMMATE]).toEqual({ saved: { A: mateA, B: mateB }, active: 'B' });
    expect(input.slots?.[PLAYER]).toEqual({ saved: { A: own }, active: 'A' });

    runPlanning(input, SEED);
    const playerCalls = calls.list.filter((c) => plannedIn(c.input).includes(PLAYER));
    expect(playerCalls.length, "the player's calls").toBeGreaterThan(0);
    for (const c of playerCalls) {
      expect(oursIn(c.input, TEAMMATE), 'the teammate is certain input, not a rival').toBe(true);
      expect(c.input.committed[TEAMMATE], "the teammate follows its active prepared policy").toEqual(mateB);
    }
  }, 120_000);

  it('4: teammate: a teammate without an active prepared plan is committed to nothing', () => {
    const own: Policy = { startCompound: 'soft', stops: [{ lap: 15, compound: 'hard' }] };
    const input = inputOf({ [PLAYER]: { saved: { A: own }, active: 'A' }, [TEAMMATE]: { saved: { A: own }, active: null } });
    expect(input.committed[TEAMMATE]).toBeNull();
    expect(input.committed[PLAYER]).toEqual(own);
  });

  it('7: determinism: same input and seed → bit-identical output (C51)', () => {
    const a = inputOf();
    const b = inputOf();
    expect(json(b), 'the input').toBe(json(a));
    const first = runPlanning(a, SEED);
    const second = runPlanning(structuredClone(b), SEED);
    expect(json(second)).toBe(json(first));
    expect(second).toEqual(first);
  }, 180_000);
});

// SP4.3e Task 3 (spec §4.3, §4.4 item 3; C62d): the planning round's race assumptions reach the one builder.
describe('the planning round forwards its race assumptions (SP4.3e Task 3)', () => {
  it("race.sets 'fresh' → the race's start holds the config's fresh allocation per our car, all new; 'carried' does not", () => {
    const count = (sets: readonly { compound: string }[]): Record<string, number> => {
      const out: Record<string, number> = {};
      for (const s of sets) out[s.compound] = (out[s.compound] ?? 0) + 1;
      return out;
    };
    const fresh = inputOf(NO_PLANS(OURS), QUALIFYING(), 'fresh');
    expect(fresh.start.known, fresh.start.known ? '' : fresh.start.reason).toBe(true);
    const carried = inputOf(NO_PLANS(OURS), QUALIFYING(), 'carried');
    expect(carried.start.known, carried.start.known ? '' : carried.start.reason).toBe(true);
    if (!fresh.start.known || !carried.start.known) return;
    for (const car of OURS) {
      const sets = fresh.start.value.sets[car] ?? [];
      expect(count(sets), `car ${car}: the fresh allocation`).toEqual({ soft: 3, medium: 2, hard: 1, inter: 4, wet: 3 });
      for (const s of sets) expect(s.wearPct, `car ${car}: ${s.compound} new`).toBe(0);
      expect(count(carried.start.value.sets[car] ?? []), `car ${car}: carried, the qualifying's sets`).not.toEqual(count(sets));
    }
    expect(fresh.planning?.laps).toBe(LAPS);
  });
});
