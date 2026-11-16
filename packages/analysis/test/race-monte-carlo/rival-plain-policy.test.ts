// One rival plain policy (SP4.3c Task 18, O9, O5; C43, C50): `race-monte-carlo/rivals.ts`' `rivalPlainPolicy(start, k,
// weather)` is a rival's next stop and compound under one world: the stop lap from rival-stops' window (`stopMid`), the
// compound from rival-stops' odds (the likeliest), the tyre-type switch from rival-stops' `switchLap` (the game's delta
// of the other type below 0, research 22 §1.7), else the lap model's first-faster type at the world's wetness. The plain
// road (`dp-input.ts`' `plainRoad`), the Monte Carlo's scenario policies (`drawnScenario`) and forecast-score's
// `forecastPolicies` all take it. Starting points are hand-built (`../race-forecast/start.ts`) with the rivals' plans
// (`./rival-plan.ts`, which states the starting point's proposed fields).
//
// The test agent's readings of the plan (Task 18 report):
// - a switch from `switchLap` L is a stop at the end of lap L onto the type's compound (inter → inter, wet → wet, slick →
//   medium, as `rivalPlan`'s switch compounds); a dry stop after it is not made (the switch fitted fresh tyres);
// - without odds the compound is the compound rule's (`rivalNextCompound`'s rule before this task: owing the second dry
//   compound, another dry one; else its own);
// - forecast-score's `forecastPolicies` takes the starting point it forecasts from (`forecastPolicies(start)`, one policy
//   per car slot, each `rivalPlainPolicy(start, k, null)`: its scored cases are dry, so no world's wetness).
import type { LapModelParams, Policy, StartingPoint } from '@pitwall/domain';
import { known } from '@pitwall/domain';
import { createRng } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { forecastPolicies } from '../../src/forecast-score/forecasts.ts';
import { raceForecast } from '../../src/race-forecast/index.ts';
import { drawnScenario, rivalNextCompound, type WeatherLap } from '../../src/race-monte-carlo/index.ts';
import { rivalPlainPolicy } from '../../src/race-monte-carlo/rivals.ts';
import { plainRoad } from '../../src/shared/strategy-input/dp-input.ts';
import { LAP_MODEL, PLAIN, startingPoint } from '../race-forecast/start.ts';
import { mcInput, NO_STOP } from './support.ts';
import { withRivalPlans, type PlannedStart } from './rival-plan.ts';

/** Compound offsets that tell the compounds apart (a stop onto another changes the road) and the wetness slopes. */
const MODEL: LapModelParams = {
  ...LAP_MODEL,
  compoundOffsetMs: { soft: -500, medium: 0, hard: 500, inter: 5_000, wet: 9_000 },
  wetnessMsPerMs: { slick: 1, inter: 0.5, wet: 0.25 },
};

const LAP = 4;
const TOTAL = 30;
const MID = 12;

/**
 * Leader on lap 4 of 30. Slot 0: ours (it has sets), no stop. Slot 1: on mediums, window 12, owes a stop, odds all
 * hard, and its inter delta −300 ms on lap 4 (`switchLap` 4, `switchTo` inter). Slot 2: on softs, owes a stop, window
 * 12, odds 70 % hard and 30 % medium. Slot 3: on mediums, owes nothing, no stop before the flag, no odds, no switch.
 * Slot 4: on mediums, owes a stop, window 12, no odds known.
 */
function field(): PlannedStart {
  const start = startingPoint({
    lap: LAP,
    lapsTotal: TOTAL,
    ours: [0],
    lapModel: MODEL,
    cars: [{ gapMs: 0 }, { gapMs: 3_000 }, { gapMs: 6_000, compound: 'soft' }, { gapMs: 9_000 }, { gapMs: 12_000 }],
  });
  return withRivalPlans(start, {
    1: { window: [MID, MID, MID], owesStop: true, odds: { hard: 1 }, switchAt: { lap: LAP, to: 'inter' } },
    2: { window: [MID, MID, MID], owesStop: true, odds: { hard: 0.7, medium: 0.3 } },
    3: { window: [TOTAL, TOTAL, TOTAL], owesStop: false },
    4: { window: [MID, MID, MID], owesStop: true },
  });
}

/** A world over laps `LAP` … `TOTAL`: wetness 0 until `fromLap`, then `wetnessMs` (rain from then). */
function world(fromLap: number, wetnessMs: number): WeatherLap[] {
  return Array.from({ length: TOTAL - LAP + 1 }, (_, i) => {
    const lap = LAP + i;
    return { lap, rain: lap >= fromLap, wetnessMs: lap >= fromLap ? wetnessMs : 0 };
  });
}

const DRY_WORLD = world(TOTAL + 1, 0);

/** The policies the task expects of the field, by slot (slot 0 is ours: no stop in the plain road). */
const SWITCH: Policy = { stops: [{ lap: LAP, compound: 'inter' }] };
const ODDS_HARD: Policy = { stops: [{ lap: MID, compound: 'hard' }] };
/** Slot 4 without odds: the compound rule's other dry compound (medium → hard). */
const RULE_HARD: Policy = { stops: [{ lap: MID, compound: 'hard' }] };

describe('rivalPlainPolicy (O9, O5)', () => {
  it("a rival whose inter delta turns −300 ms on lap 4 switches on lap 4, under no world and under a dry one alike", () => {
    const start = field();
    expect(rivalPlainPolicy(start, 1, null)).toEqual(SWITCH);
    expect(rivalPlainPolicy(start, 1, DRY_WORLD)).toEqual(SWITCH);
    // the delta is the switch, not the lap model: a world that turns wet only on lap 8 does not move it
    expect(rivalPlainPolicy(start, 1, world(8, 12_000))).toEqual(SWITCH);
  });

  it("without a delta, the lap model's rule: the first lap another type is faster at the world's wetness, onto the fastest", () => {
    const start = field();
    // slot 3 on mediums: at wetness 12,000 ms medium 12,000 > inter 5,000 + 6,000 = 11,000 < wet 9,000 + 3,000: inter on lap 8
    expect(rivalPlainPolicy(start, 3, world(8, 12_000))).toEqual({ stops: [{ lap: 8, compound: 'inter' }] });
    // no world, or a dry one: no switch, and slot 3 has no stop before the flag
    expect(rivalPlainPolicy(start, 3, null)).toEqual(NO_STOP);
    expect(rivalPlainPolicy(start, 3, DRY_WORLD)).toEqual(NO_STOP);
  });

  it('a rival with odds 70 % hard takes hard at its window, and rivalNextCompound says hard', () => {
    const start = field();
    expect(rivalPlainPolicy(start, 2, null)).toEqual(ODDS_HARD);
    expect(rivalNextCompound(start, 2)).toBe('hard');
    // without odds the compound rule's: owing the second dry compound on mediums, the hard
    expect(rivalPlainPolicy(start, 4, null)).toEqual(RULE_HARD);
  });
});

describe('one rival policy in the plain road, the MC and forecast-score (O9)', () => {
  const expected = (): Policy[] => [NO_STOP, SWITCH, ODDS_HARD, NO_STOP, RULE_HARD];

  it("the plain road is the plain forecast of every rival's plain policy (our cars without a stop)", () => {
    const start = field();
    const road = plainRoad(start, createRng(0));
    const forecast = raceForecast(start, expected(), PLAIN, createRng(0), { trace: true });
    const want = new Map((forecast.trace ?? []).map((t) => [t.lap, { gapMs: t.gapMs, position: t.position }]));
    expect(road).toEqual(want);
  });

  it("the MC's scenario policy of a rival is its plain policy where its stop is drawn on the window's mid (no SC)", () => {
    const start = field();
    // windows of one lap: every draw is the mid; no forecast (no world), no hazard
    for (const id of [1, 2, 3]) {
      const { rivals } = drawnScenario(mcInput(start, { 0: [NO_STOP] }), createRng(5), id);
      for (const k of [1, 2, 3, 4]) expect(rivals[k], `scenario ${id}, slot ${k}`).toEqual(expected()[k]);
    }
  });

  it("the MC's rival switches on its switchLap also under a forecast world (the delta, not the lap model)", () => {
    const wet: StartingPoint = { ...field(), weather: known({ byLap: Array.from({ length: TOTAL - LAP + 1 }, (_, i) => ({ lap: LAP + i, rainPct: 100 })), accuracy: 'perfect' }, 0) };
    for (const id of [1, 2, 3]) {
      const { rivals } = drawnScenario(mcInput(wet, { 0: [NO_STOP] }), createRng(5), id);
      expect(rivals[1]?.stops[0], `scenario ${id}`).toEqual({ lap: LAP, compound: 'inter' });
    }
  });

  it("forecast-score's policies are every car's plain policy (no world: its cases are dry)", () => {
    const start = field();
    const policies = forecastPolicies(start);
    expect(policies).toHaveLength(start.cars);
    for (let k = 1; k < start.cars; k++) expect(policies[k], `slot ${k}`).toEqual(expected()[k]);
    for (let k = 0; k < start.cars; k++) expect(policies[k], `slot ${k}`).toEqual(rivalPlainPolicy(start, k, null));
  });
});
