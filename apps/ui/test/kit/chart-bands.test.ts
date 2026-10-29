// Phase bands of the chart (spec 8.4, A.4). Contract of `clipBands(bands, range)` in src/kit/chart/data.ts (pure):
//  - `PhaseBand = { from, to, kind: 'sc' | 'vsc' | 'red' }` is exported from the same file;
//  - a band is clipped to the visible x-range `[lo, hi]`: `from = max(from, lo)`, `to = min(to, hi)`, kind kept;
//  - a band with no overlap (to <= lo, or from >= hi) or an empty band (to <= from) is dropped;
//  - the order of the bands is kept; the input is not mutated.
import { describe, expect, it } from 'vitest';
import { clipBands, type PhaseBand } from '../../src/kit/chart/data.ts';

describe('clipBands', () => {
  it('keeps a band inside the range unchanged', () => {
    expect(clipBands([{ from: 3, to: 5, kind: 'sc' }], [0, 10])).toEqual([{ from: 3, to: 5, kind: 'sc' }]);
  });
  it('drops bands entirely outside the range', () => {
    const bands: PhaseBand[] = [{ from: 0, to: 2, kind: 'sc' }, { from: 12, to: 15, kind: 'vsc' }];
    expect(clipBands(bands, [5, 10])).toEqual([]);
  });
  it('drops a band that only touches the range edge', () => {
    expect(clipBands([{ from: 1, to: 5, kind: 'red' }, { from: 10, to: 12, kind: 'sc' }], [5, 10])).toEqual([]);
  });
  it('clips a band that crosses either edge', () => {
    expect(clipBands([{ from: 2, to: 7, kind: 'sc' }], [5, 10])).toEqual([{ from: 5, to: 7, kind: 'sc' }]);
    expect(clipBands([{ from: 8, to: 14, kind: 'vsc' }], [5, 10])).toEqual([{ from: 8, to: 10, kind: 'vsc' }]);
  });
  it('clips a band that spans the whole range to the range', () => {
    expect(clipBands([{ from: 0, to: 20, kind: 'red' }], [5, 10])).toEqual([{ from: 5, to: 10, kind: 'red' }]);
  });
  it('drops an empty band', () => {
    expect(clipBands([{ from: 6, to: 6, kind: 'sc' }, { from: 7, to: 6, kind: 'sc' }], [5, 10])).toEqual([]);
  });
  it('keeps the order and the kinds, and does not mutate the input', () => {
    const bands: PhaseBand[] = [{ from: 6, to: 7, kind: 'vsc' }, { from: 1, to: 3, kind: 'sc' }, { from: 8, to: 30, kind: 'red' }];
    const copy = structuredClone(bands);
    expect(clipBands(bands, [2, 9]).map((b) => b.kind)).toEqual(['vsc', 'sc', 'red']);
    expect(bands).toEqual(copy);
  });
});
