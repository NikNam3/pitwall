import type { BrakingZone, MapPoint, TrackTurn } from '@pitwall/domain';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  brakingAhead,
  fractionOf,
  pointAt,
  sectorOfDistance,
  turnAt,
} from '../../src/shared/track-lookup.ts';

const LENGTH = 4300;
const turn = (number: number, apex: number): TrackTurn => ({ number, label: `T${number}`, apex });

describe('fractionOf', () => {
  it('is half at half the lap', () => {
    expect(fractionOf(2150, LENGTH)).toBeCloseTo(0.5, 12);
  });

  it('wraps negative and over-long distances into [0, 1)', () => {
    expect(fractionOf(-10, LENGTH)).toBeCloseTo(1 - 10 / LENGTH, 12);
    expect(fractionOf(4310, LENGTH)).toBeCloseTo(10 / LENGTH, 12);
  });

  it('is undefined without a track length', () => {
    expect(fractionOf(100, 0)).toBeUndefined();
    expect(fractionOf(100, -5)).toBeUndefined();
  });

  it('property: always in [0, 1)', () => {
    fc.assert(
      fc.property(fc.double({ min: -1e5, max: 1e5, noNaN: true }), fc.double({ min: 1, max: 1e4, noNaN: true }), (d, l) => {
        const f = fractionOf(d, l);
        expect(f).toBeDefined();
        expect(f!).toBeGreaterThanOrEqual(0);
        expect(f!).toBeLessThan(1);
      }),
    );
  });
});

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
});

describe('turnAt', () => {
  const turns = [turn(1, 0.1), turn(2, 0.5)];

  it('returns the nearest apex within snapM and undefined beyond it', () => {
    // 0.1 * 4300 = 430 m; a car at 0.105 is 21.5 m away.
    expect(turnAt(turns, 0.105, LENGTH, 30)).toBe('T1');
    expect(turnAt(turns, 0.105, LENGTH, 20)).toBeUndefined();
    expect(turnAt(turns, 0.3, LENGTH, 30)).toBeUndefined();
  });

  it('picks the nearer of two apexes', () => {
    expect(turnAt([turn(1, 0.1), turn(2, 0.11)], 0.108, LENGTH, 100)).toBe('T2');
  });

  it('measures the distance around the line', () => {
    expect(turnAt([turn(1, 0.002)], 0.998, LENGTH, 30)).toBe('T1');
  });

  it('property: never a turn farther than snapM', () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 0, max: 1, noNaN: true, maxExcluded: true }), { maxLength: 10 }),
        fc.double({ min: 0, max: 1, noNaN: true, maxExcluded: true }),
        fc.double({ min: 0, max: 500, noNaN: true }),
        (apexes, f, snap) => {
          const ts = apexes.map((a, i) => turn(i + 1, a));
          const label = turnAt(ts, f, LENGTH, snap);
          if (label === undefined) return;
          const t = ts.find((x) => x.label === label)!;
          const d = Math.abs(t.apex - f);
          expect(Math.min(d, 1 - d) * LENGTH).toBeLessThanOrEqual(snap + 1e-6);
        },
      ),
    );
  });

  it('is undefined for an empty list', () => {
    expect(turnAt([], 0.5, LENGTH, 100)).toBeUndefined();
  });
});

describe('sectorOfDistance', () => {
  it('returns the later sector at the boundaries', () => {
    expect(sectorOfDistance(0, 1400, 2900)).toBe(1);
    expect(sectorOfDistance(1399, 1400, 2900)).toBe(1);
    expect(sectorOfDistance(1400, 1400, 2900)).toBe(2);
    expect(sectorOfDistance(2899, 1400, 2900)).toBe(2);
    expect(sectorOfDistance(2900, 1400, 2900)).toBe(3);
    expect(sectorOfDistance(4000, 1400, 2900)).toBe(3);
  });
});

describe('brakingAhead', () => {
  const zones: BrakingZone[] = [{ start: 0.2, end: 0.22 }];

  it("is 'inside' within a zone, 'ahead' within leadM before it, 'clear' otherwise", () => {
    expect(brakingAhead(zones, 0.21, LENGTH, 100)).toBe('inside');
    // 0.2 * 4300 = 860 m; 0.19 is 43 m before.
    expect(brakingAhead(zones, 0.19, LENGTH, 100)).toBe('ahead');
    expect(brakingAhead(zones, 0.1, LENGTH, 100)).toBe('clear');
    expect(brakingAhead(zones, 0.3, LENGTH, 100)).toBe('clear');
  });

  it("looks ahead across the line: zone at 0.01 is 'ahead' for a car at 0.995", () => {
    expect(brakingAhead([{ start: 0.01, end: 0.03 }], 0.995, LENGTH, 100)).toBe('ahead');
  });

  it("treats a wrapping zone as 'inside' on both sides of the line", () => {
    const wrap: BrakingZone[] = [{ start: 0.98, end: 0.02 }];
    expect(brakingAhead(wrap, 0.99, LENGTH, 100)).toBe('inside');
    expect(brakingAhead(wrap, 0.01, LENGTH, 100)).toBe('inside');
  });

  it("is 'clear' for an empty list", () => {
    expect(brakingAhead([], 0.5, LENGTH, 100)).toBe('clear');
  });
});
