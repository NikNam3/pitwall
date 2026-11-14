// The outline point at a lap fraction, one copy (SP4.3c Task 1, spec §5.3): `pointAt` moves from
// `analysis/src/shared/track-lookup.ts` to `domain/src/track-geometry.ts`; the ui kit's private copy in
// `kit/track/layout.ts` (which `stretchPoints` calls with fractions past 1) is deleted. Ported from
// `analysis/test/shared/track-lookup.test.ts`, plus the wrap past 1 the kit relied on. Belongs in
// `packages/domain/test/track-geometry.test.ts` (this worker's hooks could not write `packages/domain/test`).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { pointAt, type MapPoint } from '@pitwall/domain';

describe('pointAt', () => {
  const outline: MapPoint[] = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];

  it('property: lies on the segment between its two neighbouring points', () => {
    const outlineArb = fc.array(fc.record({ x: fc.integer({ min: -100, max: 100 }), y: fc.integer({ min: -100, max: 100 }) }), {
      minLength: 2,
      maxLength: 20,
    });
    fc.assert(
      fc.property(outlineArb, fc.double({ min: 0, max: 1, noNaN: true, maxExcluded: true }), (pts, f) => {
        const p = pointAt(pts, f);
        const n = pts.length;
        const i = Math.floor(f * n);
        const a = pts[i]!;
        const b = pts[(i + 1) % n]!;
        const eps = 1e-6;
        expect(p.x).toBeGreaterThanOrEqual(Math.min(a.x, b.x) - eps);
        expect(p.x).toBeLessThanOrEqual(Math.max(a.x, b.x) + eps);
        expect(p.y).toBeGreaterThanOrEqual(Math.min(a.y, b.y) - eps);
        expect(p.y).toBeLessThanOrEqual(Math.max(a.y, b.y) + eps);
        const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
        expect(Math.abs(cross)).toBeLessThan(1e-4 * (1 + Math.abs(b.x - a.x) + Math.abs(b.y - a.y)) * 100);
      }),
    );
  });

  it('is linear between neighbours', () => {
    const p = pointAt(outline, 0.125);
    expect(p.x).toBeCloseTo(5, 9);
    expect(p.y).toBeCloseTo(0, 9);
    expect(pointAt(outline, 0)).toEqual({ x: 0, y: 0 });
  });

  it('at 0.999 lies between the last point and the first', () => {
    const p = pointAt(outline, 0.999);
    expect(p.x).toBeCloseTo(0, 1);
    expect(p.y).toBeGreaterThan(0);
    expect(p.y).toBeLessThanOrEqual(10);
  });

  it('wraps past 1: a fraction f + 1 is the point at f, and 1 is the first point', () => {
    for (const f of [0, 0.125, 0.4, 0.875]) {
      const p = pointAt(outline, f + 1);
      const q = pointAt(outline, f);
      expect(p.x).toBeCloseTo(q.x, 9);
      expect(p.y).toBeCloseTo(q.y, 9);
    }
    expect(pointAt(outline, 1)).toEqual({ x: 0, y: 0 });
  });
});
