// A free start's wet start compound and the one best plan (SP4.3d2 Task 9 review fixes F1, F2; C43): the "inter and
// wet plans only where rain can come" rule (Task 23a; SP4.3c O3a) holds for a free start's `startCompound` as for its
// stops, and the reaction table (R31) is the one of `candidatesOf`'s best plan, not a best the job derives itself.
//
// How these rows read the fix (the test agent's decisions):
// - The dry case makes the inter and the wet the cheapest compounds on a dry track (their dry offsets below the soft's),
//   so the unfiltered least-time plan starts on one of them; rain cannot come (the track dry by `track-wetness`'s `wet`,
//   every forecast sample below `rain-outlook`'s `rainPct`, no rain weather type). No candidate, no row and no prefill
//   then starts on inters or wets; the candidates' best (their first, nothing committed) starts on a slick.
// - The wet case is the same input with the start wet (`start.wetness.wet`): a wet start compound is allowed again.
// - F2: the job's reaction table for a car (`candidatesForRun`'s `mc.reactions[car]`) is `reactionOf` on the car's
//   solves with the start compound of `candidatesOf`'s best (the car's first candidate, nothing committed); on the
//   dry case that differs from the unfiltered least-time plan's start compound, so the two tables differ.
// - The planning-run rows use `./planning-support.ts`' qualifying view with a dry race forecast, inter and wet sets in
//   hand, and `forecast-field`'s inter and wet dry offsets overridden (C47) to make them the cheapest.
import { known, NOISE_COMPOUNDS, type CarId, type ForecastSample, type NoiseCompound, type Policy, type StartingPoint, type StrategyOutput, type TyreSet } from '@pitwall/domain';
import { createRng, type AsOfView } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { planningInputFrom, reactionOf, toDpInput } from '../../src/shared/strategy-input/index.ts';
import { solveAll, solveDp, type DpPlan } from '../../src/strategy-dp/index.ts';
import { candidatesForRun } from '../../src/strategy/job.ts';
import { type StrategyInput } from '../../src/strategy/index.ts';
import { startingPoint } from '../race-forecast/start.ts';
import { dpInput, LAP as DP_LAP } from '../strategy-dp/support.ts';
import { CAR, candidatesOf, CONFIG } from './candidates-support.ts';
import { NO_PLANS, qualifyingAsOf, runPlanning } from './planning-support.ts';
import { json, once, OURS, RACE, SETS } from './support.ts';

const WET: ReadonlySet<string> = new Set(['inter', 'wet']);
const isWet = (c: NoiseCompound | undefined): boolean => c !== undefined && WET.has(c);
const wetStartOf = (p: Pick<Policy, 'startCompound'>): boolean => isWet(p.startCompound);

// --- the unit rows: `candidatesOf` on a hand-built free start ---

const LAPS = 20;

/** The grid of 8 cars, our cars 2 and 5, from lap 1; dry and without a forecast unless `wet`. */
function grid(wet: boolean): StartingPoint {
  const start = startingPoint({ lap: 1, lapsTotal: LAPS, cars: Array.from({ length: 8 }, () => ({})), ours: [2, 5] });
  return { ...start, wetness: { wetnessMs: wet ? 600 : 0, sdMs: 0, wet } };
}

/** Car 2's free start: every compound with two new sets, the inter and the wet the cheapest on a dry track, two worlds. */
const FREE = once(() =>
  dpInput({
    startCompound: null,
    fromLap: 1,
    totalLaps: LAPS,
    lap: { ...DP_LAP, compoundOffsetMs: { soft: -300, medium: 0, hard: 250, inter: -900, wet: -700 }, convexMsPerPct2: 2 },
    car: { degMsPerLap: 60 },
    sets: { soft: 2, medium: 2, hard: 2, inter: 2, wet: 2 },
    worlds: [{ u: 0.25 }, { u: 0.75 }],
  }),
);
const SOLVED = once(() => {
  const solutions = solveAll(FREE());
  return { solutions, dp: solveDp(FREE(), solutions) };
});

/** The least-time plan over every world, unfiltered. */
const leastOf = (plans: readonly DpPlan[]): DpPlan | undefined => [...plans].sort((a, b) => a.expectedMs - b.expectedMs)[0];

describe('F1: no wet start on a dry outlook (SP4.3d2 Task 9 review)', () => {
  it('F1: the case: the unfiltered least-time plan starts on inters or wets', () => {
    const least = leastOf(SOLVED().dp.plans);
    expect(least, 'a plan').toBeDefined();
    expect(isWet(least!.startCompound), `the least plan: ${json(least)}`).toBe(true);
  });

  it('F1: a dry free start (no rain can come) with inter and wet sets → no candidate starts on inters or wets', () => {
    const cands = candidatesOf(grid(false), CAR, SOLVED().dp, SOLVED().solutions, CONFIG);
    expect(cands.length).toBeGreaterThan(0);
    const wet = cands.filter((c) => wetStartOf(c.policy));
    expect(wet.map((c) => json(c.policy)), 'wet-start candidates').toEqual([]);
    // the best (first) starts on a slick
    expect(isWet(cands[0]!.policy.startCompound), json(cands[0]!.policy)).toBe(false);
  });

  it('F1: a dry free start with a forecast below rainPct and no rain weather → no candidate starts on inters or wets', () => {
    const start = grid(false);
    const dryForecast: StartingPoint = { ...start, weather: known(dryWeather(start), 0) };
    const cands = candidatesOf(dryForecast, CAR, SOLVED().dp, SOLVED().solutions, CONFIG);
    expect(cands.filter((c) => wetStartOf(c.policy)).map((c) => json(c.policy)), 'wet-start candidates').toEqual([]);
  });

  it('F1: a wet start (start.wetness.wet) still allows an inter or wet start compound', () => {
    const cands = candidatesOf(grid(true), CAR, SOLVED().dp, SOLVED().solutions, CONFIG);
    expect(cands.some((c) => wetStartOf(c.policy)), cands.map((c) => json(c.policy)).join('\n')).toBe(true);
  });
});

/** A weather outlook whose every lap's rain chance is 10 % (below `rain-outlook`'s 40 %), as `rainComing` reads it. */
function dryWeather(start: StartingPoint): Extract<StartingPoint['weather'], { known: true }>['value'] {
  return { byLap: Array.from({ length: start.lapsTotal }, (_, i) => ({ lap: i + 1, rainPct: 10 })), accuracy: 'perfect' };
}

// --- the planning-run rows: rows, prefill and the reaction table ---

const PLANNING_LAPS = 44;
const SEED = 1_521_242_744;

/** The race's forecast: dry, every sample below `rain-outlook`'s `rainPct` (40 %), no rain weather type. */
const DRY_FORECAST: readonly ForecastSample[] = [0, 15, 30, 45, 60].map((minutes) => ({
  offsetMs: minutes * 60_000,
  weather: 'overcast',
  trackTempC: 30,
  trackTempTrend: 'flat',
  airTempC: 22,
  airTempTrend: 'flat',
  rainPct: 10,
}));

const wetSet = (compound: 'inter' | 'wet'): TyreSet => ({
  actualCompound: compound,
  visualCompound: compound,
  wearPct: 0,
  available: true,
  fitted: false,
  recommendedSession: 0,
  lifeSpanLaps: 30,
  usableLifeLaps: 28,
  lapDeltaMs: 0,
});
/** Our cars' sets: `SETS` with two new inter and two new wet sets. */
const WET_SETS: readonly TyreSet[] = [...SETS, wetSet('inter'), wetSet('inter'), wetSet('wet'), wetSet('wet')];

/** The qualifying view with the dry forecast, our cars' inter and wet sets, the inter and the wet the cheapest on a dry track (C47). */
const DRY_QUALIFYING = once((): AsOfView => {
  const asOf = qualifyingAsOf(RACE(), { laps: PLANNING_LAPS, forecast: DRY_FORECAST, sets: Object.fromEntries(OURS.map((c) => [c, WET_SETS])) });
  const config = { ...asOf.config, 'forecast-field': { ...asOf.config['forecast-field'], interOffsetMs: -1_500, wetOffsetMs: -1_200 } } as AsOfView['config'];
  return { ...asOf, config };
});
const DRY_INPUT = once((): StrategyInput => planningInputFrom(DRY_QUALIFYING(), { laps: PLANNING_LAPS, race: { laps: PLANNING_LAPS, sets: 'carried' }, prepared: NO_PLANS(OURS) }));

type CarRows = Extract<StrategyOutput[CarId], { known: true }>['value'];
function entryOf(out: StrategyOutput, car: CarId): CarRows {
  const r = out[car];
  expect(r?.known, `car ${car}: ${json(r)}`).toBe(true);
  return r!.known ? r!.value : (undefined as never);
}

describe('F1, F2 on the planning round (SP4.3d2 Task 9 review)', () => {
  it('F1: the case: the planning start is dry and free, and each car\'s unfiltered least-time plan starts on inters or wets', () => {
    const input = DRY_INPUT();
    expect(input.start.known, input.start.known ? '' : input.start.reason).toBe(true);
    if (!input.start.known) return;
    expect(input.start.value.wetness.wet, 'the start is dry').toBe(false);
    for (const car of OURS) {
      const dp = toDpInput(input, car);
      expect(dp.startCompound, `car ${car}: a free start`).toBeNull();
      expect(dp.sets.inter, `car ${car}: inter sets`).toBeGreaterThan(0);
      expect(dp.sets.wet, `car ${car}: wet sets`).toBeGreaterThan(0);
      const solutions = solveAll(dp);
      const plans = solveDp(dp, solutions).plans;
      const least = leastOf(plans);
      expect(isWet(least?.startCompound), `car ${car}: the least plan ${json(least)}`).toBe(true);
      // the least plan that starts and stops on slicks has another reaction table (so F2's row tells the two apart)
      const slick = leastOf(plans.filter((p) => !isWet(p.startCompound) && !p.stops.some((s) => isWet(s.compound))));
      expect(slick, `car ${car}: a slick plan`).toBeDefined();
      expect(json(reactionOf(dp, solutions, slick!.startCompound ?? null)), `car ${car}: the two tables differ`).not.toBe(json(reactionOf(dp, solutions, least!.startCompound ?? null)));
    }
  }, 120_000);

  it('F1: a dry free start with inter and wet sets → no row and no prefill starts on inters or wets', () => {
    const out = runPlanning(DRY_INPUT(), SEED);
    for (const car of OURS) {
      const entry = entryOf(out, car);
      expect(entry.rows.length, `car ${car}: rows`).toBeGreaterThan(0);
      expect(entry.rows.filter((r) => wetStartOf(r.policy)).map((r) => json(r.policy)), `car ${car}: wet-start rows`).toEqual([]);
      for (const [slot, policy] of Object.entries(entry.prefill)) {
        if (policy === undefined || policy === null) continue;
        expect(wetStartOf(policy as Policy), `car ${car}: prefill ${slot} ${json(policy)}`).toBe(false);
      }
    }
  }, 180_000);

  it("F2: the reaction table is the one of candidatesOf's best plan's start compound, not the unfiltered least plan's", () => {
    const input = DRY_INPUT();
    const { mc } = candidatesForRun(input, createRng(SEED));
    expect(mc, 'the candidate step plans our cars').not.toBeNull();
    for (const car of OURS) {
      const dp = toDpInput(input, car);
      const solutions = solveAll(dp);
      const least = leastOf(solveDp(dp, solutions).plans);
      const best = mc!.candidates[car]?.[0]?.policy;
      expect(best, `car ${car}: a best candidate`).toBeDefined();
      expect(isWet(best!.startCompound), `car ${car}: candidatesOf's best ${json(best)}`).toBe(false);
      expect(NOISE_COMPOUNDS).toContain(best!.startCompound);
      // the case: the unfiltered least plan's start differs, and so does its reaction table
      expect(least?.startCompound, `car ${car}: the least plan's start`).not.toBe(best!.startCompound);
      const fromBest = reactionOf(dp, solutions, best!.startCompound ?? null);
      const fromLeast = reactionOf(dp, solutions, least?.startCompound ?? null);
      expect(json(fromLeast), `car ${car}: the two tables differ`).not.toBe(json(fromBest));
      expect(mc!.reactions[car], `car ${car}: the reaction table`).toEqual(fromBest);
    }
  }, 120_000);
});
