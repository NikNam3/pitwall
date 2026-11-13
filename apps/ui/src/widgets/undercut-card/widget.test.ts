// The undercut-card declaration and gallery (SP4.3b spec §10; plan Task 13; mockup
// docs/design/2026-11-12-sp4.3b/undercut-card.html: full 47×11, compact 26×5; P17: the gallery holds data states only).
import { describe, expect, it } from 'vitest';
import { cases, fit } from './fixtures.ts';
import { widget } from './widget.ts';

describe('undercut-card declaration', () => {
  it('reads undercut.car for the link\'s primary car and cars.overview for the codes, sends nothing, has the mockup sizes', () => {
    expect([widget.name, widget.title]).toEqual(['undercut-card', 'Undercut']);
    expect(Object.keys(widget.data).sort()).toEqual(['cars', 'undercut']);
    expect(widget.data.undercut.topic).toBe('undercut.car');
    expect(widget.data.cars.topic).toBe('cars.overview');
    expect(widget.data.undercut.params?.({ link: { group: 1, feedId: 'f' as never, primary: 3 as never, compare: [], window: { kind: 'live' } }, options: {} })).toEqual({ carId: 3 });
    expect(widget.actions ?? []).toEqual([]);
    expect(widget.sizes).toEqual({ compact: { minCols: 26, minRows: 5 }, full: { minCols: 47, minRows: 11 } });
  });
});

describe('undercut-card gallery', () => {
  it('gallery: the three states of undercut-card.html', () => {
    const names = Object.keys(cases);
    // the first case, the baseline, is the mockup's first figure: rivals ahead and behind
    expect(names[0]).toBe('rivals');
    // the mockup's states: rivals ahead and behind, no rival in range, and (spec §9.1) notApplicable; plus computing
    expect(names).toEqual(expect.arrayContaining(['rivals', 'noRival', 'notApplicable', 'computing']));
    const first = cases.rivals.undercut.value;
    expect(first.known && first.value.rivals.map((r) => r.side)).toEqual(['ahead', 'ahead', 'behind']);
    expect(first.known && first.value.rivals.every((r) => r.cases.length === 3)).toBe(true);
    const none = cases.noRival.undercut.value;
    expect(none.known && none.value.rivals).toEqual([]);
    expect(cases.notApplicable.undercut.value).toEqual({ known: false, reason: 'notApplicable' });
    expect('undercut' in cases.computing).toBe(false);
    for (const c of Object.values(cases)) expect(Object.keys(c).every((k) => k === 'undercut' || k === 'cars')).toBe(true);
    // every case carries the field's identities, whose race numbers differ from the slots
    for (const c of Object.values(cases)) expect(c.cars.some((car) => car.id !== car.identity.raceNumber)).toBe(true);
    // the compact form through the fit sizes
    expect(fit.some((f) => f.mode === 'compact')).toBe(true);
  });

  it('fits at both mode minimums', () => {
    for (const [mode, s] of Object.entries(widget.sizes)) {
      expect(fit, mode).toContainEqual({ mode, cols: s.minCols, rows: s.minRows });
    }
  });
});
