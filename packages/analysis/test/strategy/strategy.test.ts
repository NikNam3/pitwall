// `strategy`'s job (SP4.3b spec §8.1, §8.2, §8.5; plan 4.3b1 Task 20 rows 2–4, 5b, 8–11 and 13; C1a, C14, C43, C51):
// `prepareStrategy` on a generator race seen from our two cars, then `runStrategy` with a seeded generator. Every
// `race-monte-carlo` call the job makes is recorded (the real search runs), so the tests see whom each call plans and
// what our other car follows meanwhile (how a call is read: `./support.ts`). The job calls the simulator through its
// unit's index (`race-monte-carlo/index.ts`).
import { unknown, type CarId, type Policy, type StrategyOutput } from '@pitwall/domain';
import { createRng } from '@pitwall/engine/readers';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as mc from '../../src/race-monte-carlo/index.ts';
import type { McInput, McResult } from '../../src/race-monte-carlo/index.ts';
import { prepareStrategy, runStrategy, STRATEGY, STRATEGY_JOB, STRATEGY_TRIGGER } from '../../src/strategy/index.ts';
import { FORECAST_UNITS } from '../../src/shared/forecast-field/index.ts';
import {
  currentLapOf,
  fixedIn,
  HAZARD_UNKNOWN,
  json,
  NO_SETS_LEFT,
  oursIn,
  plannedIn,
  PLAYER,
  RACE,
  SETS,
  stopIn,
  TEAMMATE,
  TRACK,
  viewAt,
  type ViewSpec,
} from './support.ts';

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

const SEED = 1_521_242_744;
const LAP = 3;

/** The job's output on the race's view at the leader's lap `LAP` (or `lap`), as the worker computes it. */
function planned(spec: ViewSpec = {}, lap = LAP): StrategyOutput {
  const input = structuredClone(prepareStrategy(viewAt(RACE(), lap, spec)));
  return runStrategy(input, createRng(SEED));
}

/** Car `car`'s rows; fails the test when the car has none. */
function rowsOf(out: StrategyOutput, car: CarId) {
  const r = out[car];
  expect(r?.known, `car ${car}: ${json(r)}`).toBe(true);
  return r!.known ? r!.value : (undefined as never);
}

const NOT_APPLICABLE = unknown('notApplicable');

describe('strategy: the job', () => {
  it('is a C51 job: id, the spec §8.1 trigger, reads, a module exporting run', () => {
    expect(STRATEGY_JOB).toMatchObject({ kind: 'job', id: STRATEGY });
    expect(STRATEGY_TRIGGER).toEqual({ onChange: ['ourLap', 'pitStops', 'spans:session-phase-race', 'decisions'] });
    expect(STRATEGY_JOB.trigger).toEqual(STRATEGY_TRIGGER);
    expect(STRATEGY_JOB.reads).toEqual(
      expect.arrayContaining([
        'laps', 'stints', 'pitStops', 'miniSectors', 'events', 'decisions', 'drivers',
        'spans:session-phase-race', 'spans:car-activity-race', 'spans:car-driver', 'spans:compound-rule', 'spans:weekend-phase',
        { calculator: 'race-hazard' },
      ]),
    );
    // forecast-field's estimation units run inside prepare: their reads are the job's
    for (const unit of FORECAST_UNITS) expect(STRATEGY_JOB.reads, unit.id).toEqual(expect.arrayContaining([...unit.reads]));
    expect(STRATEGY_JOB.module.href).toBe(new URL('../../src/strategy/job.ts', import.meta.url).href);
  });

  it('prepare gives a structured-cloneable input with the newest plan per our car', () => {
    const view = viewAt(RACE(), LAP);
    const p = stopIn(view, PLAYER, 4);
    const input = prepareStrategy(viewAt(RACE(), LAP, { decisions: [{ kind: 'planCommitted', carId: PLAYER, policy: p }] }));
    expect(structuredClone(input)).toEqual(input);
    expect(input.ourCars).toEqual([PLAYER, TEAMMATE]);
    expect(input.committed[PLAYER]).toEqual(p);
    expect(input.committed[TEAMMATE]).toBeNull();
    expect(input.start.known).toBe(true);
  });

  // row 2
  it('a committed car: its policy is one row marked committed; every other row has diff and se against the leader', () => {
    const p = stopIn(viewAt(RACE(), LAP), PLAYER, 4);
    const { rows } = rowsOf(planned({ decisions: [{ kind: 'planCommitted', carId: PLAYER, policy: p }] }), PLAYER);
    const committed = rows.filter((r) => r.committed);
    expect(committed).toHaveLength(1);
    expect(committed[0]).toMatchObject({ policy: p, source: 'committed', infeasible: null });
    // its alternatives are ranked too (U3)
    expect(rows.length).toBeGreaterThan(1);
    for (const r of rows) {
      expect(Number.isFinite(r.diff), json(r.policy)).toBe(true);
      expect(Number.isFinite(r.se) && r.se >= 0, json(r.policy)).toBe(true);
    }
  });

  // row 3
  it('the teammate is planned against a committed policy as certain input', () => {
    const p = stopIn(viewAt(RACE(), LAP), TEAMMATE, 5, 'hard');
    const out = planned({ decisions: [{ kind: 'planCommitted', carId: TEAMMATE, policy: p }] });
    rowsOf(out, PLAYER);
    const forPlayer = calls.list.filter((c) => plannedIn(c.input).includes(PLAYER));
    expect(forPlayer.length).toBeGreaterThan(0);
    for (const { input } of forPlayer) {
      // the teammate is one of ours in every call, following its committed policy exactly
      expect(oursIn(input, TEAMMATE)).toBe(true);
      expect(fixedIn(input, TEAMMATE)).toEqual(p);
    }
  });

  // row 4
  it("no commit on either car: two rounds; round 2 plans against the other's round-1 best", () => {
    const out = planned();
    for (const [car, other] of [
      [PLAYER, TEAMMATE],
      [TEAMMATE, PLAYER],
    ] as const) {
      const calledFor = calls.list.filter((c) => plannedIn(c.input).includes(car));
      // round 1: the other car modelled like a rival
      const round1 = calledFor.filter((c) => !oursIn(c.input, other));
      expect(round1, `round 1 of car ${car}`).toHaveLength(1);
      // round 2: the other car one of ours, following its own round-1 best
      const otherRound1 = calls.list.find((c) => plannedIn(c.input).includes(other) && !oursIn(c.input, car));
      const otherBest = otherRound1?.result[other]?.rows[0]?.policy;
      expect(otherBest, `car ${other}'s round-1 best`).toBeDefined();
      const round2 = calledFor.filter((c) => oursIn(c.input, other));
      expect(round2.length, `round 2 of car ${car}`).toBeGreaterThan(0);
      const last = round2.at(-1)!;
      expect(fixedIn(last.input, other)).toEqual(otherBest);
      expect(calls.list.indexOf(last)).toBeGreaterThan(calls.list.indexOf(round1[0]!));
      // the car's rows are round 2's ranking
      expect(rowsOf(out, car).rows.map((r) => json(r.policy))).toEqual(last.result[car]!.rows.map((r) => json(r.policy)));
    }
  });

  // row 5b
  it('two feeds of one team: a plan committed in feed A for car A is certain input for car B\'s planning in feed B\'s job (U12)', () => {
    const p = stopIn(viewAt(RACE(), LAP), PLAYER, 4);
    const decision = { kind: 'planCommitted' as const, carId: PLAYER, policy: p };
    // feed B: the teammate's own feed (its player car), the plan routed into its decisions (Task 17)
    const feedB = prepareStrategy(viewAt(RACE(), LAP, { player: TEAMMATE, teammate: PLAYER, decisions: [decision] }));
    expect(feedB.committed[PLAYER]).toEqual(p);
    const out = runStrategy(structuredClone(feedB), createRng(SEED));
    rowsOf(out, TEAMMATE);
    const forB = calls.list.filter((c) => plannedIn(c.input).includes(TEAMMATE));
    expect(forB.length).toBeGreaterThan(0);
    for (const { input } of forB) expect(fixedIn(input, PLAYER)).toEqual(p);
    expect(rowsOf(out, PLAYER).rows.filter((r) => r.committed).map((r) => r.policy)).toEqual([p]);
  });

  // row 8
  it('notApplicable outside the race phase and without a track file\'s braking zones', () => {
    const track = TRACK.known ? TRACK.value : (undefined as never);
    const cases: [string, ViewSpec][] = [
      ['qualifying', { weekendPhase: 'qualifying' }],
      ['no track file', { track: unknown('notApplicable') }],
      ['a track file without braking zones', { track: { ...TRACK, value: { ...track, brakingZones: unknown('notApplicable') } } as typeof TRACK }],
    ];
    for (const [name, spec] of cases) {
      calls.list = [];
      const out = planned(spec);
      for (const car of [PLAYER, TEAMMATE]) expect(out[car], `${name}, car ${car}`).toEqual(NOT_APPLICABLE);
      expect(calls.list, name).toEqual([]);
    }
  });

  // row 9
  it('the hazard unknown: ranks without neutralisations, metadata hazard unknown with its reason', () => {
    const out = planned({ hazard: HAZARD_UNKNOWN });
    for (const car of [PLAYER, TEAMMATE]) {
      const r = rowsOf(out, car);
      expect(r.rows.length).toBeGreaterThan(0);
      expect(r.hazard).toEqual(HAZARD_UNKNOWN);
    }
    expect(calls.list.length).toBeGreaterThan(0);
    for (const { input } of calls.list) {
      expect([...input.hazard.byLap].every((p) => p === 0)).toBe(true);
      expect([...input.hazard.vscByLap].every((p) => p === 0)).toBe(true);
      expect(input.hazard.active).toBeNull();
    }
    // with a known hazard the metadata says so
    expect(rowsOf(planned(), PLAYER).hazard).toMatchObject({ known: true, value: 'ok' });
  });

  // row 10
  it('no plan possible: one or two rows, no throw', () => {
    // the last lap, no set left: no stop can be made
    const last = RACE().laps;
    const out = planned({ sets: { [PLAYER]: NO_SETS_LEFT, [TEAMMATE]: NO_SETS_LEFT } }, last);
    for (const car of [PLAYER, TEAMMATE]) {
      const { rows } = rowsOf(out, car);
      expect(rows.length, `car ${car}`).toBeGreaterThanOrEqual(1);
      expect(rows.length, `car ${car}`).toBeLessThanOrEqual(2);
    }
  });

  // row 11
  it('a retired car of ours: notApplicable for it, the other planned alone', () => {
    const out = planned({ retired: [PLAYER] });
    expect(out[PLAYER]).toEqual(NOT_APPLICABLE);
    expect(rowsOf(out, TEAMMATE).rows.length).toBeGreaterThan(0);
    expect(calls.list.length).toBeGreaterThan(0);
    for (const { input } of calls.list) expect(plannedIn(input)).toEqual([TEAMMATE]);
  });

  // row 13
  it('a committed policy that cannot be followed is flagged infeasible with its reason and scored as far as it can be: a passed stop boxes this lap; a compound without a set left keeps the current tyres', () => {
    const view = viewAt(RACE(), LAP);
    const lap = currentLapOf(view, PLAYER);
    const followed = (): Policy[] =>
      calls.list.flatMap((c) => {
        const p = c.input.committed[PLAYER];
        return p === null || p === undefined ? [] : [p];
      });

    // a passed stop: it boxes this lap, the later stop as committed
    const passed: Policy = { stops: [{ lap: lap - 2, compound: 'hard' }, { lap: lap + 8, compound: 'medium' }], triggers: [] };
    const a = rowsOf(planned({ decisions: [{ kind: 'planCommitted', carId: PLAYER, policy: passed }] }), PLAYER);
    expect(a.rows.filter((r) => r.committed).map((r) => r.infeasible)).toEqual(['stopLapPassed']);
    expect(followed().length).toBeGreaterThan(0);
    for (const p of followed()) expect(p.stops).toEqual([{ lap, compound: 'hard' }, { lap: lap + 8, compound: 'medium' }]);

    // a compound without a set left: no stop onto it, the car keeps its tyres
    calls.list = [];
    const noHard = SETS.filter((s) => s.visualCompound !== 'hard');
    const onHard: Policy = { stops: [{ lap: lap + 4, compound: 'hard' }], triggers: [] };
    const b = rowsOf(planned({ sets: { [PLAYER]: noHard }, decisions: [{ kind: 'planCommitted', carId: PLAYER, policy: onHard }] }), PLAYER);
    expect(b.rows.filter((r) => r.committed).map((r) => r.infeasible)).toEqual(['noSetLeft']);
    expect(followed().length).toBeGreaterThan(0);
    for (const p of followed()) expect(p.stops.some((s) => s.compound === 'hard'), json(p)).toBe(false);
  });

  it('no state between runs: a second run on the same input gives the same output (C31, C32)', () => {
    const first = planned();
    planned({}, 12);
    expect(planned()).toEqual(first);
  });
});
