// The strategy-overview declaration and gallery (SP4.3d spec §6.4, V06; plan Task 13; mockup
// docs/design/2026-11-16-sp4.3d/strategy-overview.html: full 71×10, compact 28×10; the gallery holds data states only).
import { describe, expect, it } from 'vitest';
import { cases, fit, KUH } from './fixtures.ts';
import { widget } from './widget.ts';

describe('strategy-overview declaration', () => {
  it('is "Field plans", reads strategyOverview.car for the link\'s primary car, the field and the session, sends nothing, has the mockup sizes', () => {
    expect([widget.name, widget.title]).toEqual(['strategy-overview', 'Field plans']);
    expect(Object.keys(widget.data).sort()).toEqual(['cars', 'overview', 'session']);
    expect(widget.data.overview.topic).toBe('strategyOverview.car');
    expect(widget.data.cars.topic).toBe('cars.overview');
    expect(widget.data.session.topic).toBe('session.info');
    expect(widget.data.overview.params?.({ link: { group: 1, feedId: 'f' as never, primary: 3 as never, compare: [], window: { kind: 'live' } }, options: {} })).toEqual({ carId: 3 });
    expect(widget.actions ?? []).toEqual([]);
    expect(widget.sizes).toEqual({ compact: { minCols: 28, minRows: 10 }, full: { minCols: 71, minRows: 10 } });
  });
});

describe('strategy-overview gallery', () => {
  it('gallery: the mockup\'s figure first, then the other data states', () => {
    const names = Object.keys(cases);
    expect(names[0]).toBe('field');
    expect(names).toEqual(expect.arrayContaining(['field', 'oursOnly', 'early', 'forLin']));
    const first = cases.field.overview;
    expect(first.carId).toBe(KUH);
    expect(first.rows).toHaveLength(9);
    expect(first.rows.map((r) => r.position)).toEqual([5, 6, 7, 8, 9, 10, 11, 12, 13]);
    // the compact form through the fit sizes
    expect(fit.some((f) => f.mode === 'compact')).toBe(true);
  });

  it('fits at both mode minimums', () => {
    for (const [mode, s] of Object.entries(widget.sizes)) {
      expect(fit, mode).toContainEqual({ mode, cols: s.minCols, rows: s.minRows });
    }
  });
});
