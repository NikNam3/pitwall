// `strategy-dp` (SP4.3b spec §6, plan 4.3b1 Task 18; SP4.3c spec §5.4, plan Task 19): one car's stops and compounds to
// the flag by dynamic programming, expected over the SC/VSC chances of each lap, per weather world, each plan with its
// own trigger thresholds (C50); pure and without randomness (C2). `support.ts` states how these tests read the input
// and the result, and holds the brute force and the deterministic enumeration the rows compare with.
import type { LapModelParams, NoiseCompound } from '@pitwall/domain';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { solveDp, type DpInput, type DpPlan, type DpResult } from '../../src/strategy-dp/index.ts';
import { HAZARD } from '../race-hazard/support.ts';
import {
  bestDeterministic,
  bruteForce,
  chancesFrom,
  DRY,
  dpInput,
  everySequence,
  everyStopList,
  LAP,
  meetsLimit,
  meetsRule,
  neutralBoxes,
  NO_LIMITS,
  NO_SETS,
  PACE_MS,
  plansBySequence,
  plansOf,
  raceTimeMs,
  sequenceOf,
  stintsOf,
  WEAR_RATES,
  worldOf,
} from './support.ts';

const TOL_MS = 1e-6;

const dryArb = fc.constantFrom<NoiseCompound>(...DRY);
const scaled = (min: number, max: number, by: number) => fc.integer({ min, max }).map((x) => x / by);
const pmfArb = fc.array(fc.integer({ min: 1, max: 10 }), { minLength: 1, maxLength: 2 }).map((w) => {
  const sum = w.reduce((s, x) => s + x, 0);
  return w.map((x) => x / sum);
});

/** A lap model with every term drawn; neutralised laps wear and burn as green ones (support.ts). */
const lapModelArb: fc.Arbitrary<LapModelParams> = fc
  .record({
    offsets: fc.tuple(fc.integer({ min: -500, max: 800 }), fc.integer({ min: -500, max: 800 }), fc.integer({ min: -500, max: 800 })),
    fuelMsPerKg: fc.integer({ min: 0, max: 40 }),
    convexFromPct: fc.integer({ min: 0, max: 40 }),
    convexMsPerPct2: scaled(0, 20, 10),
    cold: fc.tuple(fc.integer({ min: 0, max: 1_500 }), fc.integer({ min: 0, max: 800 })),
    coldTyreWetFactor: scaled(10, 20, 10),
    scPace: scaled(110, 160, 100),
    vscPace: scaled(110, 150, 100),
    slick: scaled(0, 50, 100),
  })
  .map((r) => ({
    ...LAP,
    compoundOffsetMs: { soft: r.offsets[0], medium: r.offsets[1], hard: r.offsets[2], inter: 0, wet: 0 },
    fuelMsPerKg: r.fuelMsPerKg,
    convexFromPct: r.convexFromPct,
    convexMsPerPct2: r.convexMsPerPct2,
    coldTyreMs: r.cold,
    coldTyreWetFactor: r.coldTyreWetFactor,
    neutralised: { sc: { paceFactor: r.scPace, wearFactor: 1, fuelFactor: 1 }, vsc: { paceFactor: r.vscPace, wearFactor: 1, fuelFactor: 1 } },
    wetnessMsPerMs: { slick: r.slick, inter: 0, wet: 0 },
  }));

const worldArb = fc.record({
  wetness: fc.array(fc.integer({ min: 0, max: 2_000 }), { minLength: 10, maxLength: 10 }),
  traffic: fc.array(fc.integer({ min: 0, max: 3_000 }), { minLength: 10, maxLength: 10 }),
});

/**
 * A small race for the brute force: ≤ 10 laps, ≤ 2 new sets (so ≤ 2 stops), a hazard on at most two laps, one or two
 * weather worlds, each compound its own wear rate and ν, and sometimes a limit on a set's laps.
 */
const smallRaceArb: fc.Arbitrary<DpInput> = fc
  .record({
    laps: fc.integer({ min: 2, max: 10 }),
    fromLap: fc.integer({ min: 1, max: 20 }),
    lap: lapModelArb,
    compound: dryArb,
    tyreAge: fc.integer({ min: 0, max: 10 }),
    rates: fc.tuple(scaled(0, 40, 10), scaled(0, 40, 10), scaled(0, 40, 10)),
    deg: fc.tuple(fc.integer({ min: 0, max: 80 }), fc.integer({ min: 0, max: 80 }), fc.integer({ min: 0, max: 80 })),
    limits: fc.tuple(fc.option(fc.integer({ min: 2, max: 8 }), { nil: null }), fc.option(fc.integer({ min: 2, max: 8 }), { nil: null }), fc.option(fc.integer({ min: 2, max: 8 }), { nil: null })),
    fittedLimit: fc.option(fc.integer({ min: 0, max: 10 }), { nil: null }),
    paceMs: fc.integer({ min: 80_000, max: 100_000 }),
    fuelKg: fc.integer({ min: 0, max: 30 }),
    human: fc.boolean(),
    sets: fc.array(dryArb, { maxLength: 2 }),
    owes: fc.boolean(),
    green: fc.integer({ min: 15_000, max: 30_000 }),
    vscShare: scaled(50, 80, 100),
    scShare: scaled(40, 60, 100),
    hazardLaps: fc.array(fc.record({ at: fc.nat(9), sc: scaled(0, 50, 100), vsc: scaled(0, 30, 100) }), { maxLength: 2 }),
    scDur: pmfArb,
    vscDur: pmfArb,
    active: fc.option(fc.record({ condition: fc.constantFrom<'sc' | 'vsc'>('sc', 'vsc'), remaining: pmfArb }), { nil: null }),
    worlds: fc.array(worldArb, { minLength: 1, maxLength: 2 }),
  })
  .map((r) => {
    const rates = { ...WEAR_RATES, soft: r.rates[0], medium: r.rates[1], hard: r.rates[2] };
    const scByLap: number[] = [];
    const vscByLap: number[] = [];
    for (const h of r.hazardLaps) {
      if (h.at >= r.laps) continue;
      scByLap[h.at] = h.sc;
      vscByLap[h.at] = h.vsc;
    }
    const sets: Partial<Record<NoiseCompound, number>> = {};
    for (const c of r.sets) sets[c] = (sets[c] ?? 0) + 1;
    return dpInput({
      fromLap: r.fromLap,
      totalLaps: r.fromLap + r.laps - 1,
      lap: r.lap,
      car: {
        compound: r.compound,
        tyreAge: r.tyreAge,
        wearPct: r.tyreAge * rates[r.compound],
        fuelKg: r.fuelKg,
        paceMs: r.paceMs,
        degMsPerLap: { soft: r.deg[0], medium: r.deg[1], hard: r.deg[2] },
        wearRatePct: rates,
        lapsToLimit: { soft: r.limits[0], medium: r.limits[1], hard: r.limits[2] },
        fittedLapsToLimit: r.fittedLimit,
        human: r.human,
      },
      sets,
      owesSecondCompound: r.owes,
      pitLossMs: { green: r.green, vsc: r.green * r.vscShare, sc: r.green * r.scShare, inLapShare: 0.3 },
      scByLap,
      vscByLap,
      scDur: r.scDur,
      vscDur: r.vscDur,
      active: r.active === null ? null : { condition: r.active.condition, remaining: Float64Array.from(r.active.remaining) },
      worlds: r.worlds.map((w, i) => ({ u: (i + 0.5) / r.worlds.length, wetnessByLap: w.wetness, trafficMsByLap: w.traffic })),
    });
  });

/** A race of up to 30 laps and up to 3 stops, a hazard on every lap, the wear sometimes hidden. */
const raceArb: fc.Arbitrary<DpInput> = fc
  .record({
    laps: fc.integer({ min: 2, max: 30 }),
    fromLap: fc.integer({ min: 1, max: 30 }),
    lap: lapModelArb,
    compound: dryArb,
    tyreAge: fc.integer({ min: 0, max: 20 }),
    hidden: fc.boolean(),
    degMsPerLap: fc.integer({ min: 0, max: 80 }),
    sets: fc.tuple(fc.integer({ min: 0, max: 2 }), fc.integer({ min: 0, max: 2 }), fc.integer({ min: 0, max: 2 })),
    owes: fc.boolean(),
    sc: scaled(0, 10, 100),
    vsc: scaled(0, 5, 100),
    active: fc.option(fc.constantFrom<'sc' | 'vsc'>('sc', 'vsc'), { nil: null }),
  })
  .map((r) =>
    dpInput({
      fromLap: r.fromLap,
      totalLaps: r.fromLap + r.laps - 1,
      lap: r.lap,
      car: { compound: r.compound, tyreAge: r.tyreAge, wearPct: r.tyreAge * WEAR_RATES[r.compound], degMsPerLap: r.degMsPerLap, wearRatePct: r.hidden ? null : { ...WEAR_RATES } },
      sets: { soft: r.sets[0], medium: r.sets[1], hard: r.sets[2] },
      owesSecondCompound: r.owes,
      scByLap: Array.from({ length: r.laps }, () => r.sc),
      vscByLap: Array.from({ length: r.laps }, () => r.vsc),
      scDur: [0.2, 0.3, 0.3, 0.2],
      vscDur: [0.6, 0.4],
      active: r.active === null ? null : { condition: r.active, remaining: Float64Array.from([0.5, 0.5]) },
    }),
  );

const close = (actual: number, expected: number, label: string): void => {
  expect(Math.abs(actual - expected), `${label}: ${actual} against ${expected}`).toBeLessThanOrEqual(TOL_MS);
};

/** Every plan of a result: its plans, `boxThisLap` (where not `null`) and `continue`. */
const everyPlan = (r: DpResult): DpPlan[] => [...r.plans, ...(r.boxThisLap === null ? [] : [r.boxThisLap]), r.continue];

const hasBoxAction = (r: DpResult): boolean => everyPlan(r).some((p) => p.triggers.some((t) => 'action' in t && typeof t.action === 'object' && 'box' in t.action));

describe('strategy-dp: exactness', () => {
  // Task 19 row 3 (ported from 4.3b1 Task 18 row 1): per world
  it('equals brute force on races of ≤ 10 laps and ≤ 2 stops, per weather world', () => {
    fc.assert(
      fc.property(smallRaceArb, (input) => {
        const r = solveDp(input);
        expect(new Set(r.plans.map((p) => p.world)).size, 'every plan tagged with a world of the input').toBeLessThanOrEqual(input.worlds.length);
        for (const p of r.plans) expect(p.world >= 0 && p.world < input.worlds.length, `world ${p.world}`).toBe(true);
        input.worlds.forEach((_, w) => {
          const truth = bruteForce(input, w);
          const own = plansOf(r.plans, w);
          const plans = plansBySequence(own);
          expect([...plans.keys()].sort(), `world ${w}: the sequences`).toEqual([...truth.bySequence.keys()].sort());
          for (const [sequence, ms] of truth.bySequence) close(plans.get(sequence)!.expectedMs, ms, `world ${w}, sequence '${sequence}'`);
          for (let i = 1; i < own.length; i++) expect(own[i]!.expectedMs).toBeGreaterThanOrEqual(own[i - 1]!.expectedMs);
        });
        // box this lap and continue: the first world's
        const first = bruteForce(input, 0);
        if (first.boxThisLap === null) expect(r.boxThisLap).toBeNull();
        else {
          close(r.boxThisLap!.expectedMs, first.boxThisLap, 'boxThisLap');
          expect(r.boxThisLap!.world).toBe(0);
        }
        close(r.continue.expectedMs, first.continue, 'continue');
        expect(r.continue.world).toBe(0);
      }),
      { numRuns: 40, seed: 18 },
    );
  });

  // 4.3b1 Task 18 row 2
  it('with no SC chance and no wear an extra stop never shortens the expected time', () => {
    const noWearArb = fc
      .record({
        laps: fc.integer({ min: 2, max: 30 }),
        compound: dryArb,
        offset: fc.integer({ min: -300, max: 300 }),
        cold: fc.tuple(fc.integer({ min: 0, max: 1_500 }), fc.integer({ min: 0, max: 800 })),
        sets: fc.tuple(fc.integer({ min: 0, max: 2 }), fc.integer({ min: 0, max: 2 }), fc.integer({ min: 0, max: 2 })),
        owes: fc.boolean(),
        human: fc.boolean(),
        green: fc.integer({ min: 15_000, max: 30_000 }),
        traffic: fc.array(fc.integer({ min: 0, max: 3_000 }), { minLength: 30, maxLength: 30 }),
      })
      .map((r) =>
        dpInput({
          totalLaps: r.laps,
          lap: { ...LAP, compoundOffsetMs: { soft: r.offset, medium: r.offset, hard: r.offset, inter: r.offset, wet: r.offset }, coldTyreMs: r.cold, convexMsPerPct2: 1 },
          car: { compound: r.compound, degMsPerLap: 60, wearRatePct: { soft: 0, medium: 0, hard: 0, inter: 0, wet: 0 }, human: r.human },
          sets: { soft: r.sets[0], medium: r.sets[1], hard: r.sets[2] },
          owesSecondCompound: r.owes,
          pitLossMs: { green: r.green, vsc: 0.7 * r.green, sc: 0.5 * r.green, inLapShare: 0.3 },
          trafficMsByLap: r.traffic,
        }),
      );
    fc.assert(
      fc.property(noWearArb, (input) => {
        const best = new Map<number, number>();
        for (const p of solveDp(input).plans) best.set(p.stops.length, Math.min(best.get(p.stops.length) ?? Infinity, p.expectedMs));
        for (const [stops, ms] of best) {
          const more = best.get(stops + 1);
          if (more !== undefined) expect(more, `${stops + 1} stops against ${stops}`).toBeGreaterThanOrEqual(ms - TOL_MS);
        }
      }),
      { numRuns: 40, seed: 18 },
    );
  });

  // 4.3b1 Task 18 row 3
  it('the compound rule always holds in every returned plan', () => {
    fc.assert(
      fc.property(raceArb, (input) => {
        const r = solveDp(input);
        for (const plan of [...r.plans, ...(r.boxThisLap === null ? [] : [r.boxThisLap])]) {
          expect(meetsRule(input, plan.stops), `plan ${sequenceOf(plan.stops)} from ${input.carParams.compound}, owes ${input.owesSecondCompound}`).toBe(true);
        }
      }),
      { numRuns: 30, seed: 18 },
    );
  });

  // 4.3b1 Task 18 row 4
  it("a zero hazard gives the deterministic DP's plan", () => {
    const input = dpInput({
      totalLaps: 20,
      lap: { ...LAP, compoundOffsetMs: { soft: -400, medium: 0, hard: 350, inter: 0, wet: 0 }, fuelMsPerKg: 30, convexFromPct: 30, convexMsPerPct2: 0.5, coldTyreMs: [800, 300] },
      car: { compound: 'medium', tyreAge: 3, wearPct: 6, fuelKg: 40, degMsPerLap: 40, wearRatePct: { ...WEAR_RATES, soft: 3.5, medium: 2, hard: 1.2 } },
      sets: { soft: 1, medium: 1, hard: 1 },
      owesSecondCompound: true,
      pitLossMs: { green: 21_000, vsc: 14_000, sc: 10_000, inLapShare: 0.3 },
      trafficMsByLap: Array.from({ length: 20 }, (_, i) => (i === 9 ? 2_000 : 300 * (i % 3))),
    });
    const truth = bestDeterministic(input);
    // the case has one best plan, clear of the next
    expect(truth.runnerUpMs - truth.ms).toBeGreaterThan(1);
    const best = solveDp(input).plans[0]!;
    expect(best.stops).toEqual(truth.stops);
    close(best.expectedMs, truth.ms, 'the best plan');
  });
});

describe('strategy-dp: base plans per stop count (SP4.3c Task 19, B5)', () => {
  // row 1
  it('the result holds a 0-, 1-, 2- and 3-stop plan whenever feasible, each with its own triggers', () => {
    const input = dpInput({
      totalLaps: 40,
      lap: { ...LAP, compoundOffsetMs: { soft: -300, medium: 0, hard: 300, inter: 0, wet: 0 } },
      car: { compound: 'medium', degMsPerLap: 40, wearRatePct: { ...WEAR_RATES, soft: 3, medium: 2, hard: 1.2 } },
      sets: { soft: 1, medium: 1, hard: 1 },
      scByLap: Array.from({ length: 40 }, () => 0.04),
      vscByLap: Array.from({ length: 40 }, () => 0.02),
      scDur: [0.3, 0.4, 0.3],
      vscDur: [0.6, 0.4],
    });
    const r = solveDp(input);
    // every sequence within the sets is feasible (no rule, no limit): each is a plan, so every stop count 0–3 is there
    expect(r.plans.map((p) => sequenceOf(p.stops)).sort()).toEqual(everySequence(input).map((s) => s.join('-')).sort());
    expect(new Set(r.plans.map((p) => p.stops.length))).toEqual(new Set([0, 1, 2, 3]));
    for (const plan of everyPlan(r)) expect(Array.isArray(plan.triggers), sequenceOf(plan.stops)).toBe(true);

    for (const plan of r.plans) {
      const own = new Set(plan.stops.map((s) => s.compound));
      // a plan's neutralised triggers box only onto its own sequence's compounds; a no-stop plan never boxes under one
      for (const t of neutralBoxes(plan)) expect(own.has((t.action as { box: NoiseCompound }).box), `${sequenceOf(plan.stops)}: ${JSON.stringify(t)}`).toBe(true);
      if (plan.stops.length === 0) expect(neutralBoxes(plan), 'the no-stop plan').toEqual([]);
    }
    // the triggers are each plan's, not one list for all: the one-stops onto softs and onto hards box onto their own
    const bySequence = plansBySequence(r.plans);
    for (const c of ['soft', 'hard'] as const) {
      const boxes = neutralBoxes(bySequence.get(c)!);
      expect(boxes.length, `the one-stop onto ${c}: a neutralised trigger`).toBeGreaterThan(0);
      for (const t of boxes) expect(t.action).toEqual({ box: c });
    }
  });

  // row 4
  it('no rain: one world gives one solve, every plan tagged with it', () => {
    const input = dpInput({ totalLaps: 25, car: { compound: 'medium', degMsPerLap: 40 }, sets: { soft: 1, hard: 1 }, owesSecondCompound: true });
    expect(input.worlds).toHaveLength(1);
    const r = solveDp(input);
    expect(r.plans.length).toBeGreaterThan(0);
    for (const p of everyPlan(r)) expect(p.world, sequenceOf(p.stops)).toBe(0);
    // each sequence once: one solve, not one per draw
    expect(new Set(r.plans.map((p) => sequenceOf(p.stops))).size).toBe(r.plans.length);
  });
});

describe('strategy-dp: the weather worlds (SP4.3c Task 19, O3b, §5.4a)', () => {
  // row 2: the Silverstone shape, synthetic. A car on inters; the wet world stays wet, the dry world's track dries
  // within two laps. Slicks lose 0.5 ms per ms of wetness, inters 1.5 s on a dry track.
  const lap: LapModelParams = { ...LAP, compoundOffsetMs: { soft: 0, medium: 0, hard: 0, inter: 1_500, wet: 3_000 }, wetnessMsPerMs: { slick: 0.5, inter: 0, wet: 0 } };
  const silverstone = (): DpInput =>
    dpInput({
      totalLaps: 30,
      lap,
      car: { compound: 'inter', degMsPerLap: 0 },
      sets: { medium: 1 },
      worlds: [
        { u: 0.25, weight: 0.5, wetnessByLap: Array.from({ length: 30 }, () => 6_000) },
        { u: 0.75, weight: 0.5, wetnessByLap: Array.from({ length: 30 }, (_, i) => Math.max(0, 6_000 - 3_000 * i)) },
      ],
    });

  it("with rain on every lap of one world its best is no stop on inters, the drying world's a stop to mediums; both returned, tagged", () => {
    const input = silverstone();
    const r = solveDp(input);
    const wet = plansOf(r.plans, 0);
    const dry = plansOf(r.plans, 1);
    expect(wet.length + dry.length, 'every plan is one of the two worlds').toBe(r.plans.length);
    expect(sequenceOf(wet[0]!.stops), 'the wet world: no stop').toBe('');
    expect(sequenceOf(dry[0]!.stops), 'the drying world: a stop to mediums').toBe('medium');
    // each world holds both sequences, valued in its own weather
    for (const [w, plans] of [[0, wet], [1, dry]] as const) {
      expect(plans.map((p) => sequenceOf(p.stops)).sort(), `world ${w}`).toEqual(['', 'medium']);
      for (const p of plans) close(p.expectedMs, raceTimeMs(worldOf(input, w), p.stops), `world ${w}, ${sequenceOf(p.stops)}`);
    }
  });

  it("each world's plans equal a solve of that world alone; boxThisLap, continue and the table are the first world's", () => {
    const input = silverstone();
    const r = solveDp(input);
    input.worlds.forEach((_, w) => {
      const alone = solveDp(worldOf(input, w));
      expect(plansOf(r.plans, w).map((p) => ({ ...p, world: 0 })), `world ${w}`).toEqual(alone.plans);
    });
    const first = solveDp(worldOf(input, 0));
    expect(r.boxThisLap).toEqual(first.boxThisLap);
    expect(r.continue).toEqual(first.continue);
    expect(Array.from(r.table.boxUnderMs)).toEqual(Array.from(first.table.boxUnderMs));
    expect(Array.from(r.table.stayMs)).toEqual(Array.from(first.table.stayMs));
  });
});

describe('strategy-dp: per-compound tyre terms (SP4.3c Task 19, B5, O1)', () => {
  // row 5
  it("after a stop to mediums the medium's own wear rate and ν are used, not the fitted set's", () => {
    const spec = {
      totalLaps: 25,
      car: { compound: 'soft' as const, degMsPerLap: { soft: 60, medium: 10, hard: 5 }, wearRatePct: { ...WEAR_RATES, soft: 3, medium: 1, hard: 0.5 } },
      sets: { medium: 1 },
    };
    const input = dpInput(spec);
    const onMedium = plansBySequence(solveDp(input).plans).get('medium')!;
    // the best one-stop onto mediums by enumeration, each stint on its own compound's terms
    const enumerated = everyStopList(input)
      .filter((stops) => sequenceOf(stops) === 'medium')
      .map((stops) => ({ stops, ms: raceTimeMs(input, stops) }))
      .sort((a, b) => a.ms - b.ms)[0]!;
    expect(onMedium.stops).toEqual(enumerated.stops);
    close(onMedium.expectedMs, enumerated.ms, 'the one-stop onto mediums');
    // the same stops with the medium stint on the soft's terms: far slower, so the terms are the medium's own
    const softTerms = dpInput({ ...spec, car: { ...spec.car, degMsPerLap: { soft: 60, medium: 60, hard: 5 }, wearRatePct: { ...spec.car.wearRatePct, medium: 3 } } });
    expect(raceTimeMs(softTerms, onMedium.stops) - onMedium.expectedMs, 'the soft terms on the medium stint').toBeGreaterThan(1_000);
  });
});

describe('strategy-dp: the 70 % limit (SP4.3c Task 19, §5.2)', () => {
  // row 6
  it('no plan holds a stint past its laps to the limit', () => {
    const input = dpInput({
      totalLaps: 40,
      lap: { ...LAP, compoundOffsetMs: { soft: -300, medium: 0, hard: 300, inter: 0, wet: 0 } },
      car: { compound: 'medium', tyreAge: 5, wearPct: 10, degMsPerLap: 10, lapsToLimit: { soft: 8, medium: 12, hard: 18 }, fittedLapsToLimit: 7 },
      sets: { soft: 2, medium: 2, hard: 2 },
      owesSecondCompound: true,
      scByLap: Array.from({ length: 40 }, () => 0.04),
      scDur: [0.3, 0.4, 0.3],
    });
    const r = solveDp(input);
    expect(r.plans.length, 'some plan meets the limit').toBeGreaterThan(0);
    for (const plan of everyPlan(r)) {
      expect(meetsLimit(input, plan.stops), `${JSON.stringify(plan.stops)}: ${JSON.stringify(stintsOf(input, plan.stops))}`).toBe(true);
    }
    // the fitted set's 7 laps: every plan's first stop by the end of lap 7
    for (const plan of r.plans) expect(plan.stops[0]!.lap, sequenceOf(plan.stops)).toBeLessThanOrEqual(7);
    // without the limit the best plan would run a stint past it (the case)
    const free: DpInput = { ...input, carParams: { ...input.carParams, lapsToLimit: { ...NO_LIMITS }, fittedLapsToLimit: null } };
    expect(meetsLimit(input, solveDp(free).plans[0]!.stops), 'unlimited, the best plan passes the limit').toBe(false);
  });

  it('a car at 74 % (laps to the limit 0) has only stop-now plans', () => {
    const input = dpInput({ totalLaps: 30, fromLap: 12, car: { compound: 'medium', tyreAge: 37, wearPct: 74, degMsPerLap: 10, fittedLapsToLimit: 0 }, sets: { medium: 1, hard: 1 } });
    const r = solveDp(input);
    expect(r.plans.length).toBeGreaterThan(0);
    for (const plan of r.plans) expect(plan.stops[0]?.lap, sequenceOf(plan.stops)).toBe(12);
    expect(r.boxThisLap).not.toBeNull();
    close(r.boxThisLap!.expectedMs, r.plans[0]!.expectedMs, 'boxThisLap is the best plan');
    // no set left: no plan at all, and none boxes
    const stuck = solveDp(dpInput({ totalLaps: 30, fromLap: 12, car: { compound: 'medium', tyreAge: 37, wearPct: 74, fittedLapsToLimit: 0 }, sets: NO_SETS }));
    expect(stuck.plans).toEqual([]);
    expect(stuck.boxThisLap).toBeNull();
  });
});

describe('strategy-dp: the hazard', () => {
  // 4.3b1 Task 18 row 5 (Carrasco Heine & Thraves)
  it('a high SC chance around lap 20 moves the best stop towards it or stretches the stint', () => {
    // a one-stop race from softs to hards (the rule); green, the best stop is about lap 15
    const spec = {
      totalLaps: 40,
      lap: { ...LAP, compoundOffsetMs: { soft: 0, medium: 0, hard: 300, inter: 0, wet: 0 } },
      car: { compound: 'soft' as const, degMsPerLap: 40, wearRatePct: { ...WEAR_RATES, soft: 3, hard: 1.5 } },
      sets: { hard: 1 },
      owesSecondCompound: true,
      scDur: [0, 0, 1],
    };
    const green = dpInput(spec);
    const greenStop = bestDeterministic(green).stops[0]!.lap;
    expect(greenStop).toBeLessThan(18);
    const withSc = dpInput({ ...spec, scByLap: Array.from({ length: 40 }, (_, i) => (i + 1 >= 19 && i + 1 <= 22 ? 0.4 : 0)) });
    expect(solveDp(green).plans[0]!.stops[0]!.lap).toBe(greenStop);
    const stop = solveDp(withSc).plans[0]!.stops[0]!.lap;
    expect(stop).toBeGreaterThan(greenStop);
    expect(stop).toBeLessThanOrEqual(22);
  });

  // 4.3b1 Task 18 row 8, ported (SP4.3c Task 19): the thresholds are each plan's own
  it("SC triggers are each plan's own: the one-stop's lap ranges where boxing under an SC beats keeping its stop for later; the no-stop has none", () => {
    // one new medium set, no rule, steep wear; an SC lasts one lap and none is expected, so the answer is the race time
    // by enumeration with the SC on lap L, within the plan's own sequence (one stop onto mediums)
    const totalLaps = 30;
    const input = dpInput({
      totalLaps,
      car: { compound: 'medium', degMsPerLap: 50, wearRatePct: { ...WEAR_RATES, medium: 3 } },
      sets: { medium: 1 },
      scDur: [1],
      vscDur: [1],
    });
    const scOn = (at: number) => (lap: number) => (lap === at ? ('sc' as const) : ('none' as const));
    const boxUnderSc = (at: number): number => raceTimeMs(input, [{ lap: at, compound: 'medium' }], scOn(at));
    const keepForLater = (at: number): number => {
      let best = Infinity;
      for (let later = at + 1; later < totalLaps; later++) best = Math.min(best, raceTimeMs(input, [{ lap: later, compound: 'medium' }], scOn(at)));
      return best;
    };
    const boxLaps = Array.from({ length: totalLaps - 1 }, (_, i) => i + 1).filter((at) => boxUnderSc(at) < keepForLater(at));
    expect(boxLaps.length, 'the case: some lap where boxing under an SC pays').toBeGreaterThan(0);
    // the expected triggers: one per run of consecutive laps
    const expected: { kind: 'neutralised'; condition: 'sc'; fromLap: number; toLap: number; action: { box: NoiseCompound } }[] = [];
    for (const at of boxLaps) {
      const last = expected.at(-1);
      if (last !== undefined && last.toLap === at - 1) last.toLap = at;
      else expected.push({ kind: 'neutralised', condition: 'sc', fromLap: at, toLap: at, action: { box: 'medium' } });
    }

    const r = solveDp(input);
    const plans = plansBySequence(r.plans);
    expect(r.plans[0]!.stops).toHaveLength(1);
    expect(neutralBoxes(plans.get('medium')!).filter((t) => t.condition === 'sc')).toEqual(expected);
    expect(neutralBoxes(plans.get('')!), 'the no-stop plan boxes under no neutralisation').toEqual([]);
  });
});

// The rain threshold (Task 23c, supervisor rulings 2026-11-13). How these rows read it: the threshold is the constant
// track wetness w (ms, on every lap) above which a switch of the slick-shod car to its first wet-weather set (inter,
// else wet) at the end of `fromLap`, run to the flag, beats the best dry plan (stops onto dry compounds only) at that
// same wetness, pit loss included; no hazard, so both are deterministic race times. The current wetness is the
// world's `wetnessByLap[0]` (the world's wetness on `fromLap`); no rain trigger is emitted when the threshold is at or
// below it. SP4.3c Task 19: a trigger of the world's best plan (its own triggers).
describe('strategy-dp: the rain threshold', () => {
  const rainOf = (r: DpResult) => (plansOf(r.plans, 0)[0]?.triggers ?? []).filter((t) => t.kind === 'rain');
  const withWetness = (input: DpInput, w: number): DpInput => ({ ...input, worlds: [{ ...input.worlds[0]!, wetnessByLap: new Float64Array(input.worlds[0]!.wetnessByLap.length).fill(w) }] });
  const bestDryMs = (input: DpInput): number =>
    Math.min(
      ...everyStopList(input)
        .filter((stops) => stops.every((s) => DRY.includes(s.compound)) && meetsRule(input, stops))
        .map((stops) => raceTimeMs(input, stops)),
    );
  /** The wetness where `switched(w) = against(w)`; both are linear in w (support.ts's lap model, no cold tyre term). */
  const crossing = (input: DpInput, against: (i: DpInput) => number): number => {
    const d = (w: number): number => raceTimeMs(withWetness(input, w), [{ lap: input.fromLap, compound: 'inter' }]) - against(withWetness(input, w));
    const [d0, d1] = [d(0), d(1_000)];
    return (d0 * 1_000) / (d0 - d1);
  };
  const wetLap: LapModelParams = { ...LAP, compoundOffsetMs: { soft: -300, medium: 0, hard: 300, inter: 1_500, wet: 3_000 }, wetnessMsPerMs: { slick: 0.1, inter: 0, wet: 0 } };

  // Task 23c row 1
  it('the rain threshold compares a switch to inter/wet against the best dry plan\'s remaining time, not against staying out on the current slick to the flag', () => {
    // steep wear: staying out on the mediums to the flag is far slower than the best dry plan (one stop onto hards)
    const input = dpInput({
      totalLaps: 30,
      lap: wetLap,
      car: { compound: 'medium', degMsPerLap: 40, wearRatePct: { ...WEAR_RATES, medium: 3, hard: 1.5, inter: 2 } },
      sets: { medium: 1, hard: 1, inter: 1 },
    });
    const expected = crossing(input, bestDryMs);
    const stayingOut = crossing(input, (i) => raceTimeMs(i, []));
    // the case: the two readings differ by far more than the tolerance, and the right one lies above the dry track
    expect(expected - stayingOut).toBeGreaterThan(1_000);
    expect(expected).toBeGreaterThan(0);
    const rain = rainOf(solveDp(input));
    expect(rain).toHaveLength(1);
    expect(rain[0]!.action).toEqual({ box: 'inter' });
    expect(Math.abs(rain[0]!.wetnessMs - expected), `${rain[0]!.wetnessMs} against ${expected}`).toBeLessThanOrEqual(1);
  });

  // Task 23c row 2
  it('no rain trigger is emitted when its threshold is at or below the current wetness (never 0 on a dry start)', () => {
    // a dry start where the inters beat every dry plan even on a dry track: the threshold is at or below 0
    const dry = dpInput({
      totalLaps: 30,
      lap: { ...wetLap, compoundOffsetMs: { ...wetLap.compoundOffsetMs, inter: -1_500 } },
      car: { compound: 'medium', degMsPerLap: 40, wearRatePct: { ...WEAR_RATES, medium: 3, hard: 1.5, inter: 2 } },
      sets: { medium: 1, hard: 1, inter: 1 },
    });
    expect(crossing(dry, bestDryMs), 'the case: the threshold is at or below the dry track').toBeLessThanOrEqual(0);
    for (const p of solveDp(dry).plans) expect(p.triggers.filter((t) => t.kind === 'rain'), `a dry start: ${sequenceOf(p.stops)}`).toEqual([]);

    // a wet track already past the threshold
    const base = dpInput({ totalLaps: 30, lap: wetLap, car: { compound: 'medium', degMsPerLap: 40, wearRatePct: { ...WEAR_RATES, medium: 3, hard: 1.5, inter: 2 } }, sets: { medium: 1, hard: 1, inter: 1 } });
    const threshold = crossing(base, bestDryMs);
    const current = Math.ceil(threshold) + 2_000;
    expect(threshold, 'the case: a threshold above the dry track').toBeGreaterThan(0);
    for (const p of solveDp(withWetness(base, current)).plans) expect(p.triggers.filter((t) => t.kind === 'rain'), `wetness ${current} above the threshold ${threshold}`).toEqual([]);
  });

  // Task 23c row 3
  it('a dry start with no rain forecast gives a rain threshold above the current wetness or none', () => {
    const dryStartArb = fc
      .record({
        laps: fc.integer({ min: 2, max: 30 }),
        compound: dryArb,
        tyreAge: fc.integer({ min: 0, max: 25 }),
        degMsPerLap: fc.integer({ min: 0, max: 120 }),
        rates: fc.tuple(scaled(0, 60, 10), scaled(0, 60, 10), scaled(0, 60, 10)),
        sets: fc.tuple(fc.integer({ min: 0, max: 2 }), fc.integer({ min: 0, max: 2 }), fc.integer({ min: 0, max: 2 }), fc.integer({ min: 0, max: 2 }), fc.integer({ min: 0, max: 2 })),
        owes: fc.boolean(),
        interOffset: fc.integer({ min: 0, max: 4_000 }),
        slick: scaled(1, 100, 100),
        green: fc.integer({ min: 15_000, max: 30_000 }),
      })
      .map((r) => {
        const rates = { ...WEAR_RATES, soft: r.rates[0], medium: r.rates[1], hard: r.rates[2] };
        return dpInput({
          totalLaps: r.laps,
          lap: { ...LAP, compoundOffsetMs: { soft: -300, medium: 0, hard: 300, inter: r.interOffset, wet: r.interOffset + 1_500 }, wetnessMsPerMs: { slick: r.slick, inter: 0, wet: 0 } },
          car: { compound: r.compound, tyreAge: r.tyreAge, wearPct: r.tyreAge * rates[r.compound], degMsPerLap: r.degMsPerLap, wearRatePct: rates },
          sets: { soft: r.sets[0], medium: r.sets[1], hard: r.sets[2], inter: r.sets[3], wet: r.sets[4] },
          owesSecondCompound: r.owes,
          pitLossMs: { green: r.green, vsc: 0.7 * r.green, sc: 0.5 * r.green, inLapShare: 0.3 },
        });
      });
    fc.assert(
      fc.property(dryStartArb, (input) => {
        for (const p of solveDp(input).plans) {
          for (const t of p.triggers) if (t.kind === 'rain') expect(t.wetnessMs, 'a rain threshold on a dry start').toBeGreaterThan(input.worlds[0]!.wetnessByLap[0]!);
        }
      }),
      { numRuns: 60, seed: 23 },
    );
  });
});

describe('strategy-dp: edges', () => {
  // 4.3b1 Task 18 row 6
  it('out of new sets: only continue', () => {
    const r = solveDp(
      dpInput({ totalLaps: 25, fromLap: 5, car: { degMsPerLap: 40 }, sets: NO_SETS, scByLap: Array.from({ length: 21 }, () => 0.05), vscByLap: Array.from({ length: 21 }, () => 0.03), scDur: [0.3, 0.4, 0.3] }),
    );
    expect(r.plans.map((p) => p.stops)).toEqual([[]]);
    expect(r.boxThisLap).toBeNull();
    expect(r.continue.stops).toEqual([]);
    close(r.continue.expectedMs, r.plans[0]!.expectedMs, 'continue against the only plan');
    expect(hasBoxAction(r)).toBe(false);
  });

  // 4.3b1 Task 18 row 7
  it('one lap left: continue, and boxThisLap only when the rule still demands a stop and a set exists', () => {
    // the last lap a stop can be made on: boxing at its end rejoins for the final lap
    const lastChance = (o: { owes: boolean; sets: Partial<Record<NoiseCompound, number>> }) =>
      solveDp(dpInput({ totalLaps: 30, fromLap: 29, car: { compound: 'medium', tyreAge: 28, wearPct: 56, degMsPerLap: 40 }, sets: o.sets, owesSecondCompound: o.owes }));

    const met = lastChance({ owes: false, sets: { medium: 1, hard: 1 } });
    expect(met.plans[0]!.stops).toEqual([]);
    expect(met.continue.stops).toEqual([]);
    close(met.continue.expectedMs, met.plans[0]!.expectedMs, 'continue is the best');
    if (met.boxThisLap !== null) expect(met.boxThisLap.expectedMs).toBeGreaterThan(met.continue.expectedMs);

    const owed = lastChance({ owes: true, sets: { hard: 1 } });
    expect(owed.boxThisLap?.stops).toEqual([{ lap: 29, compound: 'hard' }]);
    expect(owed.plans[0]!.stops).toEqual([{ lap: 29, compound: 'hard' }]);
    close(owed.plans[0]!.expectedMs, owed.boxThisLap!.expectedMs, 'boxThisLap is the best');
    expect(owed.continue.stops).toEqual([]);

    for (const sets of [NO_SETS, { medium: 1 }]) {
      const none = lastChance({ owes: true, sets });
      expect(none.boxThisLap, `sets ${JSON.stringify(sets)}`).toBeNull();
      expect(none.continue.stops).toEqual([]);
    }
  });

  // 4.3b1 Task 18 row 9
  it('a seeded call is bit-identical', () => {
    const input = dpInput({
      totalLaps: 30,
      lap: { ...LAP, compoundOffsetMs: { soft: -300, medium: 0, hard: 250, inter: 0, wet: 0 }, convexMsPerPct2: 0.4, coldTyreMs: [700, 200] },
      car: { compound: 'soft', degMsPerLap: 35, fuelKg: 45 },
      sets: { soft: 1, medium: 1, hard: 1 },
      owesSecondCompound: true,
      scByLap: chancesFrom(HAZARD, 1, 30, 'sc'),
      vscByLap: chancesFrom(HAZARD, 1, 30, 'vsc'),
      scDur: HAZARD.durationLaps.sc,
      vscDur: HAZARD.durationLaps.vsc,
      worlds: [
        { u: 0.25, trafficMsByLap: Array.from({ length: 30 }, (_, i) => 200 * (i % 4)), wetnessByLap: Array.from({ length: 30 }, (_, i) => 100 * i) },
        { u: 0.75, trafficMsByLap: Array.from({ length: 30 }, (_, i) => 150 * (i % 5)) },
      ],
    });
    const a = solveDp(input);
    const b = solveDp(structuredClone(input));
    expect(b).toEqual(a);
    expect(Array.from(b.table.boxUnderMs)).toEqual(Array.from(a.table.boxUnderMs));
    expect(Array.from(b.table.stayMs)).toEqual(Array.from(a.table.stayMs));
    expect(a.plans[0]!.expectedMs).toBeGreaterThan(30 * PACE_MS);
    // the result is JSON-safe but the table (SP4.3c Task 9's types): plans, boxThisLap, continue round-trip
    const { table: _table, ...rest } = a;
    expect(JSON.parse(JSON.stringify(rest))).toEqual(rest);
  });
});

// SP4.3c Task 15 (O15, C43): the DP burns the starting point's burn (`carParams.fuelBurnKgPerLap`, from
// `shared/fuel-burn.ts`), not its own `fuel ÷ laps left` (`state.ts`'s fuel by lap, `thresholds.ts`' green race time).
describe('strategy-dp: the fuel burn (SP4.3c Task 15, O15)', () => {
  const MS_PER_KG = 100;
  const fuelled = (fuelBurnKgPerLap: number) =>
    dpInput({ totalLaps: 25, fromLap: 1, lap: { ...LAP, fuelMsPerKg: MS_PER_KG }, car: { degMsPerLap: 0, fuelKg: 30, fuelBurnKgPerLap }, sets: NO_SETS });

  it('a car burning 1.8 kg/lap with 30 kg left plans 16 laps of fuel: 16 full burns, 1.2 kg on lap 17, empty after', () => {
    const r = solveDp(fuelled(1.8));
    // Σ max(0, 30 − 1.8 i), i = 0 … 24: 265.2 kg-laps (30 kg over 25 laps would be 390)
    const kgLaps = Array.from({ length: 25 }, (_, i) => Math.max(0, 30 - 1.8 * i)).reduce((s, kg) => s + kg, 0);
    expect(kgLaps).toBeCloseTo(265.2, 9);
    close(r.continue.expectedMs, 25 * PACE_MS + MS_PER_KG * kgLaps, 'continue: the pace plus the fuel term of the measured burn');
    close(r.continue.expectedMs, raceTimeMs(fuelled(1.8), []), 'and the deterministic race time of the support');
  });

  it('the burn is read, not computed: no burn keeps the fuel to the flag', () => {
    close(solveDp(fuelled(0)).continue.expectedMs, 25 * (PACE_MS + MS_PER_KG * 30), 'no burn');
  });
});
