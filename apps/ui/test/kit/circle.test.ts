// The circle's geometry (kit/circle; spec §6.5, P28): polarOf, and the label rule of the mockup's gen.mjs labelPlaces.
import { carId } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import { placeCircleLabels, polarOf, type LabelCar, type LabelOptions } from '../../src/kit/circle/index.ts';

const LAP = 106_000;
const opts: LabelOptions = { lapMs: LAP, innerRadius: 173, outerRadius: 191, labelWidth: 26, ourCar: carId(0) };
const car = (id: number, code: string, behindMs: number): LabelCar => ({ carId: carId(id), code, behindMs });
const ringsOf = (cars: LabelCar[], o = opts) => Object.fromEntries(placeCircleLabels(cars, o).map((c) => [c.code, c.ring]));

describe('polarOf', () => {
  it('puts our car at the top, a quarter lap right, half a lap at the bottom', () => {
    const top = polarOf(0, LAP, 100);
    expect(top.x).toBeCloseTo(0);
    expect(top.y).toBeCloseTo(-100);
    const quarter = polarOf(LAP / 4, LAP, 100);
    expect(quarter.x).toBeCloseTo(100);
    expect(quarter.y).toBeCloseTo(0);
    const half = polarOf(LAP / 2, LAP, 100);
    expect(half.x).toBeCloseTo(0);
    expect(half.y).toBeCloseTo(100);
  });

  it('puts a car just ahead (nearly a lap behind) left of the top', () => {
    expect(polarOf(LAP - 1000, LAP, 100).x).toBeLessThan(0);
  });
});

describe('placeCircleLabels', () => {
  it('gives cars far apart the inner ring, and skips our car', () => {
    const out = placeCircleLabels([car(0, 'KUH', 0), car(1, 'RUS', 3_000), car(2, 'SAI', 6_000), car(3, 'PIA', 102_900)], opts);
    expect(out.map((c) => c.code)).toEqual(['PIA', 'RUS', 'SAI']);
    expect(out.every((c) => c.ring === 'inner' && c.label !== null)).toBe(true);
  });

  it('fans out two cars within a label width: inner then outer', () => {
    const out = placeCircleLabels([car(1, 'RUS', 10_000), car(2, 'SAI', 10_500)], opts);
    expect(out.map((c) => c.ring)).toEqual(['inner', 'outer']);
    const radii = out.map((c) => (c.label ? Math.hypot(c.label.x, c.label.y) : NaN));
    expect(radii[0]).toBeCloseTo(173);
    expect(radii[1]).toBeCloseTo(191);
  });

  it('keeps the teammate in a group of three too tight to fan; the others are dots', () => {
    const cars = [car(1, 'RUS', 10_000), car(2, 'LIN', 10_300), car(3, 'PIA', 10_600)];
    const out = placeCircleLabels(cars, { ...opts, teammate: carId(2) });
    expect(Object.fromEntries(out.map((c) => [c.code, c.ring]))).toEqual({ RUS: 'dot', LIN: 'inner', PIA: 'dot' });
    expect(out.filter((c) => c.ring === 'dot').every((c) => c.label === null)).toBe(true);
  });

  it('keeps the car closest to us when there is no teammate', () => {
    const cars = [car(1, 'RUS', 10_000), car(2, 'SAI', 10_300), car(3, 'PIA', 10_600)];
    expect(ringsOf(cars)).toEqual({ RUS: 'inner', SAI: 'dot', PIA: 'dot' });
    const ahead = [car(1, 'RUS', 94_000), car(2, 'SAI', 94_300), car(3, 'PIA', 94_600)];
    expect(ringsOf(ahead)).toEqual({ RUS: 'dot', SAI: 'dot', PIA: 'inner' });
  });

  it('groups two cars either side of the top: one fans to the outer ring, the other is a dot, none on our slot', () => {
    const out = placeCircleLabels([car(1, 'RUS', 300), car(2, 'PIA', LAP - 300)], opts);
    expect(out.map((c) => [c.code, c.ring])).toEqual([['PIA', 'outer'], ['RUS', 'dot']]);
  });

  it('applies the tight-group rule to three cars straddling the top, its keeper on the outer ring', () => {
    const cars = [car(1, 'RUS', 300), car(2, 'LIN', LAP - 100), car(3, 'PIA', LAP - 500)];
    expect(ringsOf(cars)).toEqual({ RUS: 'dot', LIN: 'outer', PIA: 'dot' });
    expect(ringsOf(cars, { ...opts, teammate: carId(3) })).toEqual({ RUS: 'dot', LIN: 'dot', PIA: 'outer' });
  });

  it('keeps a lone car 0.2 s behind us off our car\'s label slot', () => {
    const [out] = placeCircleLabels([car(1, 'RUS', 200)], opts);
    expect(out?.ring).toBe('outer');
    expect(out?.label ? Math.hypot(out.label.x, out.label.y) : NaN).toBeCloseTo(191);
  });

  it('fans a chain of four that is wide enough, alternating rings', () => {
    const cars = [car(1, 'RUS', 10_000), car(2, 'SAI', 12_400), car(3, 'PIA', 14_800), car(4, 'GAS', 17_200)];
    expect(ringsOf(cars)).toEqual({ RUS: 'inner', SAI: 'outer', PIA: 'inner', GAS: 'outer' });
  });
});
