import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { cellBox, fitColumns, pickMode, toCells } from '../../src/kit/size/size.ts';

describe('cellBox', () => {
  it('is 0.6 x font wide and font x lineHeight high', () => {
    const box = cellBox(13, 1.4);
    expect(box.width).toBeCloseTo(7.8, 10);
    expect(box.height).toBeCloseTo(18.2, 10);
  });
});

describe('toCells', () => {
  it('floors pixels into whole cells', () => {
    expect(toCells({ width: 400, height: 200 }, { width: 7.8, height: 18.2 })).toEqual({
      cols: 51,
      rows: 10,
    });
  });
});

describe('pickMode', () => {
  const sizes = {
    compact: { minCols: 28, minRows: 4 },
    full: { minCols: 60, minRows: 8 },
  };
  it('picks the largest mode that fits', () => {
    expect(pickMode(sizes, 59, 20)).toBe('compact');
    expect(pickMode(sizes, 60, 8)).toBe('full');
  });
  it('is undefined when no mode fits', () => {
    expect(pickMode(sizes, 27, 20)).toBeUndefined();
  });
});

describe('fitColumns', () => {
  // widths: a=10 (p1), b=8 (p3), c=10 (p2), d=6 (p5), e=9 (p4); sum 43
  const columns = [
    { key: 'a', widthCols: 10, priority: 1 },
    { key: 'b', widthCols: 8, priority: 3 },
    { key: 'c', widthCols: 10, priority: 2 },
    { key: 'd', widthCols: 6, priority: 5 },
    { key: 'e', widthCols: 9, priority: 4 },
  ];

  it('gap 1, 40 cols: all = 43+4 = 47 > 40; drop d (p5): 37+3 = 40 fits', () => {
    expect(fitColumns(columns, 40, 1)).toEqual(['a', 'b', 'c', 'e']);
  });
  it('gap 1, 30 cols: also drop e (p4): 28+2 = 30 fits', () => {
    expect(fitColumns(columns, 30, 1)).toEqual(['a', 'b', 'c']);
  });
  it('gap 1, 10 cols: a+c = 21 > 10 so drop c; a alone = 10 fits', () => {
    expect(fitColumns(columns, 10, 1)).toEqual(['a']);
  });
  it('gap 2, 30 cols: a,b,c = 28+4 = 32 > 30, drop b (p3): 20+2 = 22 fits', () => {
    expect(fitColumns(columns, 30, 2)).toEqual(['a', 'c']);
  });
  it('ties drop the rightmost column first', () => {
    const tied = [
      { key: 'x', widthCols: 5, priority: 1 },
      { key: 'y', widthCols: 5, priority: 2 },
      { key: 'z', widthCols: 5, priority: 2 },
    ];
    // all = 15+2 = 17 > 12; drop z (rightmost of the tie): 10+1 = 11 fits
    expect(fitColumns(tied, 12, 1)).toEqual(['x', 'y']);
  });

  it('property: fits, keeps order, drops highest priority numbers first', () => {
    const column = fc.record({
      widthCols: fc.integer({ min: 1, max: 30 }),
      priority: fc.integer({ min: 1, max: 6 }),
    });
    fc.assert(
      fc.property(
        fc.array(column, { maxLength: 10 }),
        fc.integer({ min: 0, max: 200 }),
        fc.integer({ min: 0, max: 4 }),
        (cs, cols, gap) => {
          const input = cs.map((c, i) => ({ ...c, key: `k${i}` }));
          const kept = fitColumns(input, cols, gap);
          const keptCols = input.filter((c) => kept.includes(c.key));
          // input order preserved
          expect(kept).toEqual(keptCols.map((c) => c.key));
          // fits
          const total =
            keptCols.reduce((s, c) => s + c.widthCols, 0) + gap * Math.max(0, keptCols.length - 1);
          expect(total).toBeLessThanOrEqual(cols);
          // dropped priority number >= every kept priority number
          for (const d of input.filter((c) => !kept.includes(c.key))) {
            for (const k of keptCols) expect(d.priority).toBeGreaterThanOrEqual(k.priority);
          }
        },
      ),
    );
  });
});
