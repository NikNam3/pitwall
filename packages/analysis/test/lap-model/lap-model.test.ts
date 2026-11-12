// `lap-model` (SP4.3a spec 6.2, Task 17): one car, one lap, additive, on plain inputs only (C50). Each term is checked
// alone against a zero baseline; the properties hold over random parameters and inputs.
import type { LapInput, LapModelParams, NoiseCompound } from '@pitwall/domain';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { lapTimeMs } from '../../src/lap-model/index.ts';

/** Every term zero or neutral: the lap time is the base pace alone. */
const ZERO: LapModelParams = {
  compoundOffsetMs: { soft: 0, medium: 0, hard: 0, inter: 0, wet: 0 },
  fuelMsPerKg: 0,
  convexFromPct: 40,
  convexMsPerPct2: 0,
  convexFlagged: true,
  coldTyreMs: [0, 0],
  coldTyreWetFactor: 1,
  neutralised: {
    sc: { paceFactor: 1, wearFactor: 1, fuelFactor: 1 },
    vsc: { paceFactor: 1, wearFactor: 1, fuelFactor: 1 },
  },
  wetnessMsPerMs: { slick: 0, inter: 0, wet: 0 },
};

/** A plausible parameter set: every term on. */
const PARAMS: LapModelParams = {
  compoundOffsetMs: { soft: 0, medium: 350, hard: 700, inter: 2_000, wet: 4_000 },
  fuelMsPerKg: 30,
  convexFromPct: 40,
  convexMsPerPct2: 2,
  convexFlagged: true,
  coldTyreMs: [1_200, 400],
  coldTyreWetFactor: 1.5,
  neutralised: {
    sc: { paceFactor: 1.4, wearFactor: 0.3, fuelFactor: 0.5 },
    vsc: { paceFactor: 1.3, wearFactor: 0.4, fuelFactor: 0.6 },
  },
  wetnessMsPerMs: { slick: 1, inter: -0.5, wet: -0.8 },
};

const BASE: LapInput = {
  paceMs: 80_000,
  degMsPerLap: 0,
  wearPct: 0,
  fuelKg: 0,
  compound: 'soft',
  lapOnSet: 5,
  neutralised: 'none',
  wetnessMs: 0,
  scatterMs: 0,
  mistakeMs: 0,
};

const lap = (car: Partial<LapInput>, p: LapModelParams = ZERO): number => lapTimeMs(p, { ...BASE, ...car });

describe('lap-model: each additive term alone', () => {
  it('base: with every term zero the lap time is the pace', () => {
    expect(lap({})).toBe(80_000);
    expect(lap({ paceMs: 91_234 })).toBe(91_234);
  });

  it("offset: the compound's fresh-set offset adds as given", () => {
    const p = { ...ZERO, compoundOffsetMs: { soft: -100, medium: 350, hard: 700, inter: 2_000, wet: 4_000 } };
    expect(lap({ compound: 'soft' }, p)).toBe(79_900);
    expect(lap({ compound: 'medium' }, p)).toBe(80_350);
    expect(lap({ compound: 'hard' }, p)).toBe(80_700);
  });

  it('tyre term: linear in wear below convexFromPct', () => {
    const p = { ...ZERO, convexMsPerPct2: 2 };
    const at = (wearPct: number): number => lap({ degMsPerLap: 25, wearPct }, p);
    expect(at(0)).toBe(80_000);
    expect(at(10) - at(0)).toBeCloseTo(at(20) - at(10), 9);
    expect(at(30) - at(20)).toBeCloseTo(at(40) - at(30), 9);
    expect(at(10) - at(0)).toBeGreaterThan(0);
  });

  it('tyre term: convex beyond convexFromPct, by convexMsPerPct2 per squared % past it', () => {
    const p = { ...ZERO, convexFromPct: 40, convexMsPerPct2: 2 };
    const at = (wearPct: number): number => lap({ degMsPerLap: 25, wearPct }, p);
    const linear = (wearPct: number): number => at(0) + ((at(40) - at(0)) / 40) * wearPct;
    expect(at(50) - linear(50)).toBeCloseTo(2 * 10 ** 2, 9);
    expect(at(60) - linear(60)).toBeCloseTo(2 * 20 ** 2, 9);
    expect(at(60) - at(50)).toBeGreaterThan(at(50) - at(40));
  });

  it('fuel: 10 kg at 30 ms/kg adds 300 ms', () => {
    const p = { ...ZERO, fuelMsPerKg: 30 };
    expect(lap({ fuelKg: 10 }, p) - lap({ fuelKg: 0 }, p)).toBeCloseTo(300, 9);
  });

  it('cold tyres: only on lapOnSet 1 and 2', () => {
    const p = { ...ZERO, coldTyreMs: [1_200, 400] as [number, number] };
    expect(lap({ lapOnSet: 1 }, p)).toBe(81_200);
    expect(lap({ lapOnSet: 2 }, p)).toBe(80_400);
    expect(lap({ lapOnSet: 3 }, p)).toBe(80_000);
    expect(lap({ lapOnSet: 10 }, p)).toBe(80_000);
  });

  it('cold tyres: larger with wetnessMs > 0', () => {
    const p = { ...ZERO, coldTyreMs: [1_200, 400] as [number, number], coldTyreWetFactor: 1.5 };
    for (const lapOnSet of [1, 2]) {
      const dry = lap({ lapOnSet }, p) - lap({ lapOnSet: 5 }, p);
      const wet = lap({ lapOnSet, wetnessMs: 1_500 }, p) - lap({ lapOnSet: 5, wetnessMs: 1_500 }, p);
      expect(dry).toBeGreaterThan(0);
      expect(wet).toBeGreaterThan(dry);
    }
  });

  it('neutralised: SC slower than VSC slower than green', () => {
    const p = { ...ZERO, neutralised: PARAMS.neutralised };
    const green = lap({ neutralised: 'none' }, p);
    const vsc = lap({ neutralised: 'vsc' }, p);
    const sc = lap({ neutralised: 'sc' }, p);
    expect(vsc).toBeGreaterThan(green);
    expect(sc).toBeGreaterThan(vsc);
  });

  it('wetness: raises slicks and lowers inters', () => {
    const p = { ...ZERO, wetnessMsPerMs: PARAMS.wetnessMsPerMs };
    for (const compound of ['soft', 'medium', 'hard'] as const) {
      expect(lap({ compound, wetnessMs: 2_000 }, p)).toBeGreaterThan(lap({ compound, wetnessMs: 0 }, p));
    }
    expect(lap({ compound: 'inter', wetnessMs: 2_000 }, p)).toBeLessThan(lap({ compound: 'inter', wetnessMs: 0 }, p));
  });

  it('scatterMs and mistakeMs add as given', () => {
    expect(lap({ scatterMs: -137 })).toBe(79_863);
    expect(lap({ scatterMs: 250 })).toBe(80_250);
    expect(lap({ mistakeMs: 1_800 })).toBe(81_800);
    expect(lap({ scatterMs: 250, mistakeMs: 1_800 }, PARAMS) - lap({}, PARAMS)).toBeCloseTo(2_050, 9);
  });
});

const COMPOUNDS: readonly NoiseCompound[] = ['soft', 'medium', 'hard', 'inter', 'wet'];

const paramsArb: fc.Arbitrary<LapModelParams> = fc.record({
  compoundOffsetMs: fc.record({
    soft: fc.integer({ min: -500, max: 500 }),
    medium: fc.integer({ min: 0, max: 1_000 }),
    hard: fc.integer({ min: 0, max: 1_500 }),
    inter: fc.integer({ min: 0, max: 5_000 }),
    wet: fc.integer({ min: 0, max: 8_000 }),
  }),
  fuelMsPerKg: fc.double({ min: 0, max: 60, noNaN: true }),
  convexFromPct: fc.double({ min: 20, max: 60, noNaN: true }),
  convexMsPerPct2: fc.double({ min: 0, max: 5, noNaN: true }),
  convexFlagged: fc.constant(true as const),
  coldTyreMs: fc.tuple(fc.integer({ min: 0, max: 2_000 }), fc.integer({ min: 0, max: 1_000 })),
  coldTyreWetFactor: fc.double({ min: 1, max: 3, noNaN: true }),
  neutralised: fc.record({
    sc: fc.record({ paceFactor: fc.double({ min: 1.3, max: 1.6, noNaN: true }), wearFactor: fc.double({ min: 0, max: 1, noNaN: true }), fuelFactor: fc.double({ min: 0, max: 1, noNaN: true }) }),
    vsc: fc.record({ paceFactor: fc.double({ min: 1.1, max: 1.29, noNaN: true }), wearFactor: fc.double({ min: 0, max: 1, noNaN: true }), fuelFactor: fc.double({ min: 0, max: 1, noNaN: true }) }),
  }),
  wetnessMsPerMs: fc.record({
    slick: fc.double({ min: 0, max: 2, noNaN: true }),
    inter: fc.double({ min: -1, max: 0, noNaN: true }),
    wet: fc.double({ min: -1.5, max: 0, noNaN: true }),
  }),
});

const carArb: fc.Arbitrary<LapInput> = fc.record({
  paceMs: fc.integer({ min: 60_000, max: 120_000 }),
  degMsPerLap: fc.double({ min: 0, max: 200, noNaN: true }),
  wearPct: fc.double({ min: 0, max: 100, noNaN: true }),
  fuelKg: fc.double({ min: 0, max: 110, noNaN: true }),
  compound: fc.constantFrom(...COMPOUNDS),
  lapOnSet: fc.integer({ min: 1, max: 40 }),
  neutralised: fc.constantFrom('none' as const, 'vsc' as const, 'sc' as const),
  wetnessMs: fc.double({ min: 0, max: 5_000, noNaN: true }),
  scatterMs: fc.double({ min: -1_000, max: 1_000, noNaN: true }),
  mistakeMs: fc.double({ min: 0, max: 10_000, noNaN: true }),
});

describe('lap-model: properties', () => {
  it('a fresh set is never slower than the same set worn', () => {
    fc.assert(
      fc.property(paramsArb, carArb, (p, car) => {
        expect(lapTimeMs(p, { ...car, wearPct: 0 })).toBeLessThanOrEqual(lapTimeMs(p, car));
      }),
    );
  });

  it('monotone in wear', () => {
    fc.assert(
      fc.property(paramsArb, carArb, fc.double({ min: 0, max: 100, noNaN: true }), (p, car, other) => {
        const [lo, hi] = car.wearPct <= other ? [car.wearPct, other] : [other, car.wearPct];
        expect(lapTimeMs(p, { ...car, wearPct: lo })).toBeLessThanOrEqual(lapTimeMs(p, { ...car, wearPct: hi }));
      }),
    );
  });

  it('monotone in fuel', () => {
    fc.assert(
      fc.property(paramsArb, carArb, fc.double({ min: 0, max: 110, noNaN: true }), (p, car, other) => {
        const [lo, hi] = car.fuelKg <= other ? [car.fuelKg, other] : [other, car.fuelKg];
        expect(lapTimeMs(p, { ...car, fuelKg: lo })).toBeLessThanOrEqual(lapTimeMs(p, { ...car, fuelKg: hi }));
      }),
    );
  });
});
