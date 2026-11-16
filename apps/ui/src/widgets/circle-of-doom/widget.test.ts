// The circle-of-doom declaration and gallery (SP4.3d spec §6.5, V01; plan Task 14; mockup
// docs/design/2026-11-16-sp4.3d/circle-of-doom.html: full a 420 px circle, 53×22 cells; compact a 220 px one, 28×12).
// `current` comes in the topic (the analysis read the session phase, C43): the display reads no sub-machine, so it has no
// presentation table (C66; the generic completeness test finds no situation topic in its declaration).
import { describe, expect, it } from 'vitest';
import { cases, fit, KUH } from './fixtures.ts';
import { widget } from './widget.ts';

describe('circle-of-doom declaration', () => {
  it('is "Circle", reads circle.car for the link\'s primary car, the field and the session, sends nothing, has the mockup sizes', () => {
    expect([widget.name, widget.title]).toEqual(['circle-of-doom', 'Circle']);
    expect(Object.keys(widget.data).sort()).toEqual(['cars', 'circle', 'session']);
    expect(widget.data.circle.topic).toBe('circle.car');
    expect(widget.data.cars.topic).toBe('cars.overview');
    expect(widget.data.session.topic).toBe('session.info');
    expect(widget.data.circle.params?.({ link: { group: 1, feedId: 'f' as never, primary: 3 as never, compare: [], window: { kind: 'live' } }, options: {} })).toEqual({ carId: 3 });
    expect(widget.actions ?? []).toEqual([]);
    expect(widget.sizes).toEqual({ compact: { minCols: 28, minRows: 12 }, full: { minCols: 53, minRows: 22 } });
  });

  it('reads no sub-machine: no situation topic', () => {
    for (const d of Object.values(widget.data)) expect(String(d.topic)).not.toMatch(/^situation\./u);
  });
});

describe('circle-of-doom gallery', () => {
  it('the mockup\'s states: green first, after the spin, SC deployed, LIN\'s circle, a tight group, the first lap', () => {
    expect(Object.keys(cases)).toEqual(['green', 'spun', 'sc', 'lin', 'tight', 'firstLap']);
    expect(cases.green.circle.carId).toBe(KUH);
    expect([cases.green.circle.current, cases.sc.circle.current]).toEqual(['green', 'sc']);
  });

  it('fits at both mode minimums, compact among the fit sizes', () => {
    for (const [mode, s] of Object.entries(widget.sizes)) expect(fit, mode).toContainEqual({ mode, cols: s.minCols, rows: s.minRows });
  });
});
