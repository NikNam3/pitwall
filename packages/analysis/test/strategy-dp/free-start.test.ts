// `strategy-dp`'s free start compound (SP4.3d2 Task 8, spec §7.2; C2, C43, C50): on the grid (`startCompound` `null`)
// the start node is the best over the compounds with a fresh set, that set counted in the sets used and in the compound
// rule; every plan carries the `startCompound` it starts on. `support.ts` states how these tests read the input and
// the result (the start compound: its last paragraph); the brute force is its closed-loop one, run per start compound
// on `fixedStart`.
import type { LapModelParams, NoiseCompound } from '@pitwall/domain';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { solveDp, type DpInput, type DpPlan, type DpResult } from '../../src/strategy-dp/index.ts';
import { bruteForce, DRY, dpInput, fixedStart, LAP, plansOf, sequenceOf, startCompounds, WEAR_RATES } from './support.ts';

const TOL_MS = 1e-6;

const dryArb = fc.constantFrom<NoiseCompound>(...DRY);
const scaled = (min: number, max: number, by: number) => fc.integer({ min, max }).map((x) => x / by);
const pmfArb = fc.array(fc.integer({ min: 1, max: 10 }), { minLength: 1, maxLength: 2 }).map((w) => {
  const sum = w.reduce((s, x) => s + x, 0);
  return w.map((x) => x / sum);
});

/** A lap model with the compound offsets, fuel, convex and cold terms drawn (the brute-force harness's, ported). */
const lapModelArb: fc.Arbitrary<LapModelParams> = fc
  .record({
    offsets: fc.tuple(fc.integer({ min: -500, max: 800 }), fc.integer({ min: -500, max: 800 }), fc.integer({ min: -500, max: 800 })),
    fuelMsPerKg: fc.integer({ min: 0, max: 40 }),
    convexFromPct: fc.integer({ min: 0, max: 40 }),
    convexMsPerPct2: scaled(0, 20, 10),
    cold: fc.tuple(fc.integer({ min: 0, max: 1_500 }), fc.integer({ min: 0, max: 800 })),
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
    neutralised: { sc: { paceFactor: r.scPace, wearFactor: 1, fuelFactor: 1 }, vsc: { paceFactor: r.vscPace, wearFactor: 1, fuelFactor: 1 } },
    wetnessMsPerMs: { slick: r.slick, inter: 0, wet: 0 },
  }));

const worldArb = fc.record({
  wetness: fc.array(fc.integer({ min: 0, max: 2_000 }), { minLength: 10, maxLength: 10 }),
  traffic: fc.array(fc.integer({ min: 0, max: 3_000 }), { minLength: 10, maxLength: 10 }),
});

/**
 * A small grid start for the brute force: lap 1 of ≤ 10 laps, 1–3 new dry sets (one is the start's, so ≤ 2 stops), a
 * hazard on at most two laps, nothing out, one or two weather worlds, each compound its own wear rate and ν, sometimes
 * a limit on a set's laps. The car's fitted tyres are drawn too: a free start must not read them.
 */
const freeStartArb: fc.Arbitrary<DpInput> = fc
  .record({
    laps: fc.integer({ min: 2, max: 10 }),
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
    sets: fc.array(dryArb, { minLength: 1, maxLength: 3 }),
    owes: fc.boolean(),
    green: fc.integer({ min: 15_000, max: 30_000 }),
    vscShare: scaled(50, 80, 100),
    scShare: scaled(40, 60, 100),
    hazardLaps: fc.array(fc.record({ at: fc.nat(9), sc: scaled(0, 50, 100), vsc: scaled(0, 30, 100) }), { maxLength: 2 }),
    scDur: pmfArb,
    vscDur: pmfArb,
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
      startCompound: null,
      fromLap: 1,
      totalLaps: r.laps,
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
      worlds: r.worlds.map((w, i) => ({ u: (i + 0.5) / r.worlds.length, wetnessByLap: w.wetness, trafficMsByLap: w.traffic })),
    });
  });

const close = (actual: number, expected: number, label: string): void => {
  expect(Math.abs(actual - expected), `${label}: ${actual} against ${expected}`).toBeLessThanOrEqual(TOL_MS);
};

/** Every plan of a result: its plans, `boxThisLap` (where not `null`) and `continue`. */
const everyPlan = (r: DpResult): DpPlan[] => [...r.plans, ...(r.boxThisLap === null ? [] : [r.boxThisLap]), r.continue];

/** Per start compound with a set, the brute force of world `w` on that start fixed. */
const truthByStart = (input: DpInput, w: number): Map<NoiseCompound, ReturnType<typeof bruteForce>> =>
  new Map(startCompounds(input).map((c) => [c, bruteForce(fixedStart(input, c), w)]));

/** The plan's compounds in use: its start's and its stops'. */
const setsUsed = (plan: DpPlan): Partial<Record<NoiseCompound, number>> => {
  const used: Partial<Record<NoiseCompound, number>> = {};
  for (const c of [plan.startCompound!, ...plan.stops.map((s) => s.compound)]) used[c] = (used[c] ?? 0) + 1;
  return used;
};

describe('strategy-dp: a free start compound (SP4.3d2 Task 8, spec §7.2)', () => {
  // Step 1 row 1
  it('brute force equals the DP with a free start on small races, per weather world', () => {
    fc.assert(
      fc.property(freeStartArb, (input) => {
        const r = solveDp(input);
        for (const p of everyPlan(r)) expect(p.startCompound, `${JSON.stringify(p)}: a free start's plan names its start compound`).toBeDefined();
        input.worlds.forEach((_, w) => {
          const truth = truthByStart(input, w);
          const own = plansOf(r.plans, w);
          // every plan is the brute force's best play of its start compound and stop sequence
          for (const p of own) {
            const ms = truth.get(p.startCompound!)?.bySequence.get(sequenceOf(p.stops));
            expect(ms, `world ${w}: start ${p.startCompound}, sequence '${sequenceOf(p.stops)}' is feasible`).toBeDefined();
            close(p.expectedMs, ms!, `world ${w}, start ${p.startCompound}, sequence '${sequenceOf(p.stops)}'`);
          }
          for (let i = 1; i < own.length; i++) expect(own[i]!.expectedMs).toBeGreaterThanOrEqual(own[i - 1]!.expectedMs);
          // the start node is the best over the start compounds: the world's best plan is the brute force's best of all
          const best = Math.min(...[...truth.values()].flatMap((t) => [...t.bySequence.values()]));
          if (Number.isFinite(best)) close(own[0]!.expectedMs, best, `world ${w}: the best plan`);
          else expect(own, `world ${w}: no feasible start`).toEqual([]);
        });
        // box this lap: the first world's best over the start compounds
        const boxes = [...truthByStart(input, 0).values()].map((t) => t.boxThisLap).filter((x): x is number => x !== null);
        if (boxes.length === 0) expect(r.boxThisLap).toBeNull();
        else close(r.boxThisLap!.expectedMs, Math.min(...boxes), 'boxThisLap');
      }),
      { numRuns: 30, seed: 83 },
    );
  });

  // Step 1 row 2
  it('a free-start best plan never starts on a compound without a set; its start set counts in the sets used', () => {
    // the soft is far the fastest and lasts the race, but no soft set is left: the best starts on another compound
    const fastSoft = { ...LAP, compoundOffsetMs: { soft: -2_000, medium: 0, hard: 300, inter: 0, wet: 0 } };
    const noSoft = solveDp(dpInput({ startCompound: null, totalLaps: 10, lap: fastSoft, car: { compound: 'soft' }, sets: { medium: 1, hard: 1 } }));
    expect(noSoft.plans[0]!.startCompound).toBeDefined();
    expect(noSoft.plans[0]!.startCompound).not.toBe('soft');
    for (const p of everyPlan(noSoft)) expect(p.startCompound, JSON.stringify(p)).not.toBe('soft');
    // one soft set: the best starts on it, and no plan fits a second soft
    const oneSoft = solveDp(dpInput({ startCompound: null, totalLaps: 10, lap: fastSoft, car: { compound: 'medium' }, sets: { soft: 1, medium: 1, hard: 1 } }));
    expect(oneSoft.plans[0]!.startCompound).toBe('soft');
    for (const p of everyPlan(oneSoft)) expect(setsUsed(p).soft ?? 0, JSON.stringify(p)).toBeLessThanOrEqual(1);

    fc.assert(
      fc.property(freeStartArb, (input) => {
        const r = solveDp(input);
        // `continue` too: where no play meets the rule and the limit it ignores both, never the sets
        for (const p of everyPlan(r)) {
          expect(input.sets[p.startCompound!], `${JSON.stringify(p)}: a set of its start compound`).toBeGreaterThanOrEqual(1);
          for (const [c, n] of Object.entries(setsUsed(p))) expect(n, `${JSON.stringify(p)}: ${c} sets used`).toBeLessThanOrEqual(input.sets[c as NoiseCompound]);
        }
      }),
      { numRuns: 60, seed: 84 },
    );
  });

  // Step 1 row 2: the compound rule reads the start compound
  it("the compound rule reads the free start's compound: a plan owing the second compound stops on a dry compound other than its start", () => {
    fc.assert(
      fc.property(freeStartArb, (input) => {
        if (!input.owesSecondCompound) return;
        for (const p of solveDp(input).plans) {
          expect(p.stops.some((s) => DRY.includes(s.compound) && s.compound !== p.startCompound), JSON.stringify(p)).toBe(true);
        }
      }),
      { numRuns: 60, seed: 85 },
    );
  });

  // Step 1 row 5 (the DP's part): a car on its tyres plays as today
  it("a car on its tyres (startCompound its compound) plays as today: no plan carries startCompound, the fitted set's age is read", () => {
    const lap = { ...LAP, coldTyreMs: [800, 300] as [number, number], compoundOffsetMs: { soft: -300, medium: 0, hard: 250, inter: 0, wet: 0 } };
    const spec = { totalLaps: 12, lap, car: { compound: 'medium' as const, tyreAge: 3, wearPct: 6, degMsPerLap: 30 }, sets: { soft: 1, hard: 1 }, owesSecondCompound: true };
    const r = solveDp(dpInput(spec));
    for (const p of everyPlan(r)) expect('startCompound' in p, JSON.stringify(p)).toBe(false);
    // the fitted set (age 3, worn 6 %) is not a new medium: a free start on the same set is a different race
    const fresh = solveDp(fixedStart(dpInput({ ...spec, startCompound: null, sets: { soft: 1, medium: 1, hard: 1 } }), 'medium'));
    expect(fresh.plans[0]!.expectedMs).not.toBe(r.plans[0]!.expectedMs);
  });

  // SP4.3e Task 3 (report F4a): with the race's reserved sets the DP sees two mediums, so M-M-S is a plan
  it('with S×2, M×2, H×1 new, a medium-medium-soft 2-stop is among the DP\'s 2-stop plans', () => {
    const r = solveDp(
      dpInput({
        startCompound: null,
        totalLaps: 30,
        lap: { ...LAP, compoundOffsetMs: { soft: -300, medium: 0, hard: 250, inter: 0, wet: 0 } },
        car: { degMsPerLap: { soft: 60, medium: 30, hard: 20 } },
        sets: { soft: 2, medium: 2, hard: 1 },
        owesSecondCompound: true,
      }),
    );
    const twoStops = r.plans.filter((p) => p.stops.length === 2);
    expect(twoStops.length, '2-stop plans').toBeGreaterThan(0);
    const seqs = twoStops.map((p) => [p.startCompound, ...p.stops.map((s) => s.compound)].join('-'));
    expect(seqs, 'M-M-S among the 2-stop plans').toContain('medium-medium-soft');
  });

  // Step 1 row 6 (the DP's part)
  it('same input → bit-identical output with a free start', () => {
    const input = dpInput({
      startCompound: null,
      totalLaps: 25,
      lap: { ...LAP, compoundOffsetMs: { soft: -300, medium: 0, hard: 250, inter: 0, wet: 0 }, convexMsPerPct2: 0.4, coldTyreMs: [700, 200] },
      car: { degMsPerLap: { soft: 40, medium: 25, hard: 15 }, fuelKg: 40 },
      sets: { soft: 2, medium: 1, hard: 1 },
      owesSecondCompound: true,
      scByLap: Array.from({ length: 25 }, () => 0.03),
      vscByLap: Array.from({ length: 25 }, () => 0.02),
      scDur: [0.3, 0.4, 0.3],
      worlds: [{ u: 0.25, trafficMsByLap: Array.from({ length: 25 }, (_, i) => 200 * (i % 4)) }, { u: 0.75 }],
    });
    const a = solveDp(input);
    const b = solveDp(structuredClone(input));
    expect(b).toEqual(a);
    expect(Array.from(b.table.boxUnderMs)).toEqual(Array.from(a.table.boxUnderMs));
    expect(Array.from(b.table.stayMs)).toEqual(Array.from(a.table.stayMs));
    expect(a.plans[0]!.startCompound).toBeDefined();
  });
});
