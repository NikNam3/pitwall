// The pit-sweep-table declaration and gallery (SP4.3b spec §10; plan Task 14; mockup
// docs/design/2026-11-12-sp4.3b/pit-sweep-table.html: full 53×14, compact 26×6; the compound a panel option, C73, C74;
// P17: the gallery holds data states only, the shell's option popover is window-local).
import { describe, expect, it } from 'vitest';
import { caseOptions, cases, fit } from './fixtures.ts';
import * as text from './text.ts';
import { widget } from './widget.ts';

describe('pit-sweep-table declaration', () => {
  it("reads pitSweep.car for the link's primary car and the panel's compound, has the mockup sizes, sends nothing", () => {
    expect([widget.name, widget.title]).toEqual(['pit-sweep-table', 'Pit sweep']);
    expect(Object.keys(widget.data)).toEqual(['sweep']);
    expect(widget.data.sweep.topic).toBe('pitSweep.car');
    const link = { group: 1, feedId: 'f' as never, primary: 3 as never, compare: [], window: { kind: 'live' as const } };
    expect(widget.data.sweep.params?.({ link, options: { compound: 'soft' } })).toEqual({ carId: 3, compound: 'soft' });
    expect(widget.data.sweep.params?.({ link, options: { compound: 'auto' } })).toEqual({ carId: 3, compound: 'auto' });
    expect(widget.actions).toEqual([]);
    expect(widget.sizes).toEqual({ compact: { minCols: 26, minRows: 6 }, full: { minCols: 53, minRows: 14 } });
  });

  it('the compound option offers auto and the five compounds with text.ts labels', () => {
    const option = widget.options.compound;
    expect(option.kind).toBe('choice');
    expect(option.choices).toEqual(['auto', 'soft', 'medium', 'hard', 'inter', 'wet']);
    expect(option.default).toBe('auto');
    expect(option.label).toBe(text.compound);
    // one label per choice from text.ts: the word auto, then the compound letters (mockup popover: auto, S, M, H)
    expect(option.choices.map((c) => text.compoundChoice[c])).toEqual(['auto', 'S', 'M', 'H', 'I', 'W']);
  });
});

describe('pit-sweep-table gallery', () => {
  it('gallery: the data states of pit-sweep-table.html (auto → H, S set through caseOptions, compact)', () => {
    const names = Object.keys(cases);
    // the first case, the baseline, is the mockup's first figure: auto resolved to H, a pure data state
    expect(names[0]).toBe('autoHard');
    const first = cases.autoHard.sweep.value;
    expect([first.compound, first.fromAuto, first.table.known]).toEqual(['hard', true, true]);
    expect(first.table.known && first.table.value.rows.filter((r) => r.inWindow).map((r) => r.stopLap)).toEqual([19, 20, 21]);
    expect(first.table.known && first.table.value.rows.filter((r) => r.pastLife.known && r.pastLife.value).map((r) => r.stopLap)).toEqual([23, 24, 25, 26]);
    // S set in the panel options: the data and the case's option agree
    const soft = cases.softSet.sweep.value;
    expect([soft.compound, soft.fromAuto]).toEqual(['soft', false]);
    expect(caseOptions.softSet).toEqual({ compound: 'soft' });
    expect(soft.table.known && soft.table.value.rows.filter((r) => r.inWindow).map((r) => r.stopLap)).toEqual([18, 19, 20]);
    // the unknown tables and the computing state
    expect(cases.noSet.sweep.value.table).toEqual({ known: false, reason: 'notApplicable' });
    expect(cases.autoUnknown.sweep.value).toMatchObject({ compound: 'auto', fromAuto: true, table: { known: false, reason: 'insufficientData' } });
    expect('sweep' in cases.computing).toBe(false);
    // no case carries window-local state
    for (const c of Object.values(cases)) expect(Object.keys(c).every((k) => k === 'sweep')).toBe(true);
    // every case option is a declared choice
    for (const o of Object.values(caseOptions)) expect(widget.options.compound.choices).toContain(o.compound);
    // compact through the fit sizes
    expect(fit.some((f) => f.mode === 'compact')).toBe(true);
  });

  it('fits at both mode minimums', () => {
    for (const [mode, s] of Object.entries(widget.sizes)) {
      expect(fit, mode).toContainEqual({ mode, cols: s.minCols, rows: s.minRows });
    }
  });
});
