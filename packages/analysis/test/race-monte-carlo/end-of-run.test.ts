// `race-monte-carlo`'s end-of-run defects (SP4.3b1 Task 23b; spec §7.1, §7.3, §7.4; C2, C50): the rain draw, the rain
// action, the cap's charge and the first batch. Starting points are built by hand (`../race-forecast/start.ts`); how
// these tests read the inputs and outputs is stated in `support.ts`, `weather.test.ts` and here.
//
// What these tests take as the simulator's model (supervisor rulings, 2026-11-13):
// - The rain of a scenario is one uniform `u` per scenario: it rains on lap L when `u` is below the forecast's chance
//   on L, so the chance that a scenario sees any rain is the forecast's highest chance, not one less the product of
//   the dry chances.
// - A `rain` trigger boxes for its compound at the end of the lap it fires on and keeps the plan's later stops: the car
//   returns to slicks as planned.
// - The cap counts `raceForecast` calls: an evaluation that runs a `rivalPits` trigger's traced forecast costs 2, every
//   other 1. Below the cap, the run uses it (no evaluation budget of cap / 2 for the whole run).
// - No candidate is judged (dropped, tied, settled) before it has `n0` scenarios; a first batch under `n0` means the cap
//   stopped the run (`capHit`).
import { known, type CarId, type LapModelParams, type NoiseCompound, type Policy, type StartingPoint, type Trigger } from '@pitwall/domain';
import { createRng } from '@pitwall/engine/readers';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as forecastModule from '../../src/race-forecast/index.ts';
import { drawnScenario, raceMonteCarlo, scoreAll } from '../../src/race-monte-carlo/index.ts';
import { LAP_MODEL, NOISY, startingPoint, type CarSpec } from '../race-forecast/start.ts';
import { carOf, CONFIG, hazard, mcInput, NO_STOP, rowOf, shareSe, stopAt } from './support.ts';

const runs = vi.hoisted(() => ({ n: 0 }));

vi.mock('../../src/race-forecast/index.ts', async (importOriginal) => {
  const real = await importOriginal<typeof forecastModule>();
  return {
    ...real,
    raceForecast: (...args: Parameters<typeof real.raceForecast>) => {
      runs.n++;
      return real.raceForecast(...args);
    },
  };
});

beforeEach(() => {
  runs.n = 0;
});

/** A forecast for laps `from` … `to`: per lap the rain chance `pct(lap)`. */
function forecast(from: number, to: number, pct: (lap: number) => number, accuracy: 'perfect' | 'approximate' = 'perfect'): StartingPoint['weather'] {
  const byLap = Array.from({ length: to - from + 1 }, (_, i) => ({ lap: from + i, rainPct: pct(from + i) }));
  return known({ byLap, accuracy }, 0);
}

/** Research 19 §4's wet values: offsets against the slick inter 3,500 and wet 8,100 ms; slopes 1, 0.5, 0.25. */
const WET_MODEL: LapModelParams = {
  ...LAP_MODEL,
  compoundOffsetMs: { soft: 0, medium: 0, hard: 0, inter: 3_500, wet: 8_100 },
  wetnessMsPerMs: { slick: 1, inter: 0.5, wet: 0.25 },
};

/** A field built by `startingPoint` with forecast `weather`; our cars also get five inters and five wets each. */
function withWeather(spec: Parameters<typeof startingPoint>[0], weather: StartingPoint['weather']): StartingPoint {
  const start = startingPoint(spec);
  start.weather = weather;
  for (const sets of Object.values(start.sets)) for (const compound of ['inter', 'wet'] as const) for (let i = 0; i < 5; i++) sets.push({ compound, wearPct: 0 });
  return start;
}

const rainBox = (wetnessMs: number, box: NoiseCompound = 'inter'): Trigger => ({ kind: 'rain', wetnessMs, action: { box } });

const cover = (carId: number, withinMs: number, stops: Policy['stops']): Policy => ({ stops, triggers: [{ kind: 'rivalPits', carId: carId as CarId, withinMs, action: 'cover' }] });

describe('race-monte-carlo: the rain draw (Task 23b)', () => {
  // row 1
  it('rain is drawn once per scenario: with rainPct 4 % on every lap, about 4 % of scenarios get rain (within 3 SE over 2,000), not 1 − 0.96^laps', () => {
    const n = 2_000;
    const shareWithRain = (pct: (lap: number) => number, seed: number): number => {
      const input = mcInput(withWeather({ lapsTotal: 25, cars: [{}], ours: [0] }, forecast(1, 25, pct)), { 0: [NO_STOP] });
      let hits = 0;
      for (let id = 1; id <= n; id++) if (drawnScenario(input, createRng(seed), id).weather.some((w) => w.rain)) hits++;
      return hits / n;
    };
    // 4 % on every lap of 25: per-lap draws would give 1 − 0.96^25 ≈ 64 %
    const flat = shareWithRain(() => 4, 51);
    expect(Math.abs(flat - 0.04)).toBeLessThanOrEqual(3 * shareSe(0.04, n));
    // 10 % on laps 1–12, 30 % on laps 13–25: the scenario sees rain with the highest chance, 30 %
    const rising = shareWithRain((lap) => (lap <= 12 ? 10 : 30), 53);
    expect(Math.abs(rising - 0.3)).toBeLessThanOrEqual(3 * shareSe(0.3, n));
  });
});

describe('race-monte-carlo: the rain action (Task 23b)', () => {
  // row 2
  it('the rain action boxes onto inter/wet at the trigger and keeps the plan\'s later stops (the car returns to slicks)', () => {
    // certain rain on laps 3–5, dry after; our car alone ahead of a rival a minute behind
    const start = withWeather({ lapsTotal: 14, cars: [{ gapMs: 0 }, { gapMs: 60_000 }], ours: [0], lapModel: WET_MODEL }, forecast(1, 14, (lap) => (lap >= 3 && lap <= 5 ? 100 : 0)));
    const probe = drawnScenario(mcInput(start, { 0: [NO_STOP] }), createRng(61), 1).weather;
    const threshold = probe.find((w) => w.lap === 4)!.wetnessMs;
    expect(threshold).toBeGreaterThan(0);
    const L = probe.find((w) => w.wetnessMs >= threshold)!.lap;
    expect(L).toBe(4);
    for (const box of ['inter', 'wet'] as const) {
      // planned: one stop for mediums at the end of lap 9; the rain trigger boxes for `box` at the end of lap L first
      const onRain: Policy = { stops: [{ lap: 9, compound: 'medium' }], triggers: [rainBox(threshold, box)] };
      const kept: Policy = { stops: [{ lap: L, compound: box }, { lap: 9, compound: 'medium' }], triggers: [] };
      const replaced = stopAt(L, box);
      const rows = carOf(scoreAll(mcInput(start, { 0: [onRain, kept, replaced] }), createRng(61), 20), 0).rows;
      expect(rowOf(rows, onRain).triggers).toEqual([{ kind: 'rain', fired: 1, worthPos: 0 }]);
      expect(Math.abs(rowOf(rows, onRain).meanMs - rowOf(rows, kept).meanMs), `${box}: the later stop kept`).toBeLessThanOrEqual(1e-6);
      expect(Math.abs(rowOf(rows, kept).meanMs - rowOf(rows, replaced).meanMs), `${box}: keeping the stop changes the race`).toBeGreaterThan(100);
    }
  });
});

describe('race-monte-carlo: the cap and the first batch (Task 23b)', () => {
  /** A six-car noisy field, our car slot 2; the rival ahead (slot 1) boxes at the end of lap 4. */
  function coverField(): StartingPoint {
    const cars: CarSpec[] = Array.from({ length: 6 }, (_, i) => ({ ...NOISY, retireRate: 0, gapMs: 1_500 * i, paceMs: 90_000 + 60 * i }));
    const start = startingPoint({ lapsTotal: 8, cars, ours: [2] });
    [start.stopLow[1], start.stopMid[1], start.stopHigh[1]] = [4, 4, 4];
    start.owesStop[1] = 1;
    return start;
  }

  // row 3
  it('the cap is charged per forecast call: with a rivalPits candidate only the evaluations that call it cost 2', () => {
    // five candidates under a cap of 190: the first batch is under n0 for every candidate, so the cap is spent
    const cap = 190;
    expect(cap / 5).toBeLessThan(CONFIG.n0);
    const plain = [stopAt(3), stopAt(4), stopAt(5), stopAt(4, 'medium')];
    const withCover = [...plain, cover(1, 3_000, [{ lap: 6, compound: 'hard' }])];
    const withoutCover = [...plain, stopAt(6)];
    for (const [what, candidates] of [
      ['one rivalPits candidate', withCover],
      ['no rivalPits candidate', withoutCover],
    ] as const) {
      runs.n = 0;
      const result = carOf(raceMonteCarlo(mcInput(coverField(), { 2: candidates }, { config: { maxScenarioPolicies: cap } }), createRng(67), cap), 2);
      expect(runs.n, `${what}: never above the cap`).toBeLessThanOrEqual(cap);
      // one candidate in five costs 2: charging every evaluation 2 spends about 60 % of the cap
      expect(runs.n, `${what}: the cap is spent call by call`).toBeGreaterThan(0.85 * cap);
      expect(result.capHit, what).toBe(true);
    }
  });

  /** Our car (slot 0) a minute ahead of the field on worn tyres (30 %, 50 ms per % wear): it wins every scenario with one stop. */
  function runaway(): StartingPoint {
    return startingPoint({ lapsTotal: 10, cars: [{ gapMs: 0, degMsPerLap: 50, wearPct: 30 }, { gapMs: 60_000 }, { gapMs: 61_000 }], ours: [0] });
  }

  /** At most one stop for hards, at the end of lap k + 1 (none for k 0): candidates whose race times all differ (none merged). */
  const stops = (k: number): Policy => (k === 0 ? NO_STOP : stopAt(k + 1));

  // row 4
  it('no verdict before each candidate has n0 scenarios: a field where our car wins every scenario still runs n0 per candidate; capHit is true whenever the first batch is under n0', () => {
    const { n0 } = CONFIG;
    // the cap affords n0 each: every candidate runs at least n0 though all tie from the first scenario
    const three = [stops(0), stops(1), stops(2)];
    const roomy = carOf(raceMonteCarlo(mcInput(runaway(), { 0: three }), createRng(71), 5_000), 0);
    for (const row of roomy.rows) expect(row.positionPmf[0]).toBe(1);
    expect(runs.n, 'n0 per candidate').toBeGreaterThanOrEqual(three.length * n0);

    // six candidates under 239: a first batch of 39 < n0 each, a few evaluations left for the re-scoring; the cap stops the run
    const six = Array.from({ length: 6 }, (_, k) => stops(k));
    const cap = 239;
    expect(Math.floor(cap / six.length)).toBeLessThan(n0);
    runs.n = 0;
    const tight = carOf(raceMonteCarlo(mcInput(runaway(), { 0: six }, { config: { maxScenarioPolicies: cap } }), createRng(73), cap), 0);
    expect(tight.rows, 'no candidate merged').toHaveLength(six.length);
    for (const row of tight.rows) expect(row.positionPmf[0]).toBe(1);
    expect(runs.n).toBeLessThanOrEqual(cap);
    expect(tight.capHit, 'a first batch under n0: the cap stopped the run').toBe(true);
  });

  // row 5
  it('a seeded run stays bit-identical', () => {
    // two cars, an approximate rain forecast, a rain trigger, a rivalPits candidate, SC and VSC chances
    const cars: CarSpec[] = Array.from({ length: 6 }, (_, i) => ({ ...NOISY, retireRate: 0, gapMs: 1_500 * i, paceMs: 90_000 + 60 * i }));
    const start = withWeather({ lapsTotal: 10, cars, ours: [2, 3], lapModel: WET_MODEL }, forecast(1, 10, (lap) => (lap >= 4 ? 30 : 5), 'approximate'));
    [start.stopLow[1], start.stopMid[1], start.stopHigh[1]] = [4, 4, 4];
    start.owesStop[1] = 1;
    const hz = hazard(10, { sc: { 2: 0.2 }, vsc: { 3: 0.1 } });
    const candidates = () => ({
      2: [NO_STOP, stopAt(4), { stops: [{ lap: 7, compound: 'hard' as const }], triggers: [rainBox(1_500)] }, cover(1, 3_000, [{ lap: 6, compound: 'hard' }])],
      3: [NO_STOP, stopAt(5, 'medium')],
    });
    for (const cap of [300, 2_000]) {
      const one = raceMonteCarlo(mcInput(start, candidates(), { hazard: hz }), createRng(79), cap);
      expect(raceMonteCarlo(mcInput(start, candidates(), { hazard: hz }), createRng(79), cap), `cap ${cap}`).toStrictEqual(one);
    }
  });
});
