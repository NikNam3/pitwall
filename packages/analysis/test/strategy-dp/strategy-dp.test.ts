// `strategy-dp` (SP4.3b spec §6, plan 4.3b1 Task 18): one car's stops and compounds to the flag by dynamic programming,
// expected over the SC/VSC chances of each lap, with the trigger thresholds (C50); pure and without randomness (C2).
// `support.ts` states how these tests read the input and the result, and holds the brute force and the deterministic
// enumeration the rows compare with.
import type { LapModelParams, NoiseCompound } from '@pitwall/domain';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { strategyDp, type DpInput, type DpResult } from '../../src/strategy-dp/index.ts';
import { HAZARD } from '../race-hazard/support.ts';
import {
  bestDeterministic,
  bruteForce,
  chancesFrom,
  DRY,
  dpInput,
  LAP,
  meetsRule,
  NO_SETS,
  PACE_MS,
  plansBySequence,
  raceTimeMs,
  sequenceOf,
  WEAR_RATES,
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

/** A small race for the brute force: ≤ 10 laps, ≤ 2 new sets (so ≤ 2 stops), a hazard on at most two laps. */
const smallRaceArb: fc.Arbitrary<DpInput> = fc
  .record({
    laps: fc.integer({ min: 2, max: 10 }),
    fromLap: fc.integer({ min: 1, max: 20 }),
    lap: lapModelArb,
    compound: dryArb,
    tyreAge: fc.integer({ min: 0, max: 10 }),
    rates: fc.tuple(scaled(0, 40, 10), scaled(0, 40, 10), scaled(0, 40, 10)),
    degMsPerLap: fc.integer({ min: 0, max: 80 }),
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
    wetness: fc.array(fc.integer({ min: 0, max: 2_000 }), { minLength: 10, maxLength: 10 }),
    traffic: fc.array(fc.integer({ min: 0, max: 3_000 }), { minLength: 10, maxLength: 10 }),
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
      car: { compound: r.compound, tyreAge: r.tyreAge, wearPct: r.tyreAge * rates[r.compound], fuelKg: r.fuelKg, paceMs: r.paceMs, degMsPerLap: r.degMsPerLap, wearRatePct: rates, human: r.human },
      sets,
      owesSecondCompound: r.owes,
      pitLossMs: { green: r.green, vsc: r.green * r.vscShare, sc: r.green * r.scShare, inLapShare: 0.3 },
      scByLap,
      vscByLap,
      scDur: r.scDur,
      vscDur: r.vscDur,
      active: r.active === null ? null : { condition: r.active.condition, remaining: Float64Array.from(r.active.remaining) },
      wetnessByLap: r.wetness,
      trafficMsByLap: r.traffic,
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

const hasBoxAction = (r: DpResult): boolean => r.thresholds.some((t) => 'action' in t && typeof t.action === 'object' && 'box' in t.action);

describe('strategy-dp: exactness', () => {
  // row 1
  it('equals brute force on races of ≤ 10 laps and ≤ 2 stops', () => {
    fc.assert(
      fc.property(smallRaceArb, (input) => {
        const truth = bruteForce(input);
        const r = strategyDp(input);
        const plans = plansBySequence(r.plans);
        expect([...plans.keys()].sort(), 'the sequences').toEqual([...truth.bySequence.keys()].sort());
        for (const [sequence, ms] of truth.bySequence) close(plans.get(sequence)!.expectedMs, ms, `sequence '${sequence}'`);
        for (let i = 1; i < r.plans.length; i++) expect(r.plans[i]!.expectedMs).toBeGreaterThanOrEqual(r.plans[i - 1]!.expectedMs);
        if (truth.boxNow === null) expect(r.boxNow).toBeNull();
        else close(r.boxNow!.expectedMs, truth.boxNow, 'boxNow');
        close(r.stayOut.expectedMs, truth.stayOut, 'stayOut');
      }),
      { numRuns: 40, seed: 18 },
    );
  });

  // row 2
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
        for (const p of strategyDp(input).plans) best.set(p.stops.length, Math.min(best.get(p.stops.length) ?? Infinity, p.expectedMs));
        for (const [stops, ms] of best) {
          const more = best.get(stops + 1);
          if (more !== undefined) expect(more, `${stops + 1} stops against ${stops}`).toBeGreaterThanOrEqual(ms - TOL_MS);
        }
      }),
      { numRuns: 40, seed: 18 },
    );
  });

  // row 3
  it('the compound rule always holds in every returned plan', () => {
    fc.assert(
      fc.property(raceArb, (input) => {
        const r = strategyDp(input);
        for (const plan of [...r.plans, ...(r.boxNow === null ? [] : [r.boxNow])]) {
          expect(meetsRule(input, plan.stops), `plan ${sequenceOf(plan.stops)} from ${input.carParams.compound}, owes ${input.owesSecondCompound}`).toBe(true);
        }
      }),
      { numRuns: 30, seed: 18 },
    );
  });

  // row 4
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
    const best = strategyDp(input).plans[0]!;
    expect(best.stops).toEqual(truth.stops);
    close(best.expectedMs, truth.ms, 'the best plan');
  });
});

describe('strategy-dp: the hazard', () => {
  // row 5 (Carrasco Heine & Thraves)
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
    expect(strategyDp(green).plans[0]!.stops[0]!.lap).toBe(greenStop);
    const stop = strategyDp(withSc).plans[0]!.stops[0]!.lap;
    expect(stop).toBeGreaterThan(greenStop);
    expect(stop).toBeLessThanOrEqual(22);
  });

  // row 8
  it('SC thresholds: per remaining stop a lap range where boxing under SC beats staying out', () => {
    // one new medium set, no rule, steep wear: one stop pays; an SC lasts one lap and none is expected, so the answer
    // is the race time by enumeration with the SC on lap L
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
    const stayOutPast = (at: number): number => {
      let best = raceTimeMs(input, [], scOn(at));
      for (let later = at + 1; later < totalLaps; later++) best = Math.min(best, raceTimeMs(input, [{ lap: later, compound: 'medium' }], scOn(at)));
      return best;
    };
    const boxLaps = Array.from({ length: totalLaps - 1 }, (_, i) => i + 1).filter((at) => boxUnderSc(at) < stayOutPast(at));
    const [fromLap, toLap] = [boxLaps[0]!, boxLaps[boxLaps.length - 1]!];
    // the case: one interior, contiguous range
    expect(boxLaps).toEqual(Array.from({ length: toLap - fromLap + 1 }, (_, i) => fromLap + i));
    expect(fromLap).toBeGreaterThan(1);
    expect(toLap).toBeLessThan(totalLaps - 1);

    const r = strategyDp(input);
    expect(r.plans[0]!.stops).toHaveLength(1);
    const sc = r.thresholds.filter((t) => t.kind === 'neutralised' && t.condition === 'sc' && t.action !== 'stayOut');
    expect(sc).toEqual([{ kind: 'neutralised', condition: 'sc', fromLap, toLap, action: { box: 'medium' } }]);
  });
});

describe('strategy-dp: edges', () => {
  // row 6
  it('out of new sets: only stayOut', () => {
    const r = strategyDp(
      dpInput({ totalLaps: 25, fromLap: 5, car: { degMsPerLap: 40 }, sets: NO_SETS, scByLap: Array.from({ length: 21 }, () => 0.05), vscByLap: Array.from({ length: 21 }, () => 0.03), scDur: [0.3, 0.4, 0.3] }),
    );
    expect(r.plans.map((p) => p.stops)).toEqual([[]]);
    expect(r.boxNow).toBeNull();
    expect(r.stayOut.stops).toEqual([]);
    close(r.stayOut.expectedMs, r.plans[0]!.expectedMs, 'stayOut against the only plan');
    expect(hasBoxAction(r)).toBe(false);
  });

  // row 7
  it('one lap left: stayOut, and boxNow only when the rule still demands a stop and a set exists', () => {
    // the last lap a stop can be made on: boxing at its end rejoins for the final lap
    const lastChance = (o: { owes: boolean; sets: Partial<Record<NoiseCompound, number>> }) =>
      strategyDp(dpInput({ totalLaps: 30, fromLap: 29, car: { compound: 'medium', tyreAge: 28, wearPct: 56, degMsPerLap: 40 }, sets: o.sets, owesSecondCompound: o.owes }));

    const met = lastChance({ owes: false, sets: { medium: 1, hard: 1 } });
    expect(met.plans[0]!.stops).toEqual([]);
    expect(met.stayOut.stops).toEqual([]);
    close(met.stayOut.expectedMs, met.plans[0]!.expectedMs, 'stayOut is the best');
    if (met.boxNow !== null) expect(met.boxNow.expectedMs).toBeGreaterThan(met.stayOut.expectedMs);

    const owed = lastChance({ owes: true, sets: { hard: 1 } });
    expect(owed.boxNow?.stops).toEqual([{ lap: 29, compound: 'hard' }]);
    expect(owed.plans[0]!.stops).toEqual([{ lap: 29, compound: 'hard' }]);
    close(owed.plans[0]!.expectedMs, owed.boxNow!.expectedMs, 'boxNow is the best');
    expect(owed.stayOut.stops).toEqual([]);

    for (const sets of [NO_SETS, { medium: 1 }]) {
      const none = lastChance({ owes: true, sets });
      expect(none.boxNow, `sets ${JSON.stringify(sets)}`).toBeNull();
      expect(none.stayOut.stops).toEqual([]);
    }
  });

  // row 9
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
      trafficMsByLap: Array.from({ length: 30 }, (_, i) => 200 * (i % 4)),
    });
    const a = strategyDp(input);
    const b = strategyDp(structuredClone(input));
    expect(b).toEqual(a);
    expect(Array.from(b.table.boxUnderMs)).toEqual(Array.from(a.table.boxUnderMs));
    expect(Array.from(b.table.stayMs)).toEqual(Array.from(a.table.stayMs));
    expect(a.plans[0]!.expectedMs).toBeGreaterThan(30 * PACE_MS);
  });
});
