// The strategy-table declaration and gallery (SP4.3b spec §10; plan Task 12; mockup
// docs/design/2026-11-12-sp4.3b/strategy-table-b.html: full 88×13, compact 46×6; C74: `plan.commit`, `plan.clear`;
// P17: the gallery holds data states only, the highlighted states are component tests).
import { describe, expect, it } from 'vitest';
import { caseOptions, cases, fit } from './fixtures.ts';
import { widget } from './widget.ts';

describe('strategy-table declaration', () => {
  // SP4.3d1 Task 3: `cars.overview` was read only for the trigger lines' rival race numbers; deleted with the triggers
  // SP4.3d1 Task 11: commit became "save to slot …" (plan.save); a saved row is activated (plan.activate); clear stays
  it('reads strategy.car for the link\'s primary car, sends plan.save, plan.activate and plan.clear, has the mockup sizes', () => {
    expect([widget.name, widget.title]).toEqual(['strategy-table', 'Strategy']);
    // SP4.3d2 Task 12: the planning round's source, every topic optional
    expect(Object.keys(widget.data).sort()).toEqual(['plan', 'prepared', 'preview']);
    expect(widget.data.plan.topic).toBe('strategy.car');
    expect(widget.data.preview.topic).toBe('plans.preview');
    expect(widget.data.prepared.topic).toBe('plans.prepared');
    const link = { group: 1, feedId: 'f' as never, primary: 3 as never, compare: [], window: { kind: 'live' as const } };
    expect(widget.data.plan.params?.({ link, options: {} })).toEqual({ carId: 3 });
    expect(widget.data.preview.params?.({ link, options: {} })).toEqual({ carId: 3 });
    for (const [key, d] of Object.entries(widget.data)) expect('optional' in d && d.optional, key).toBe(true);
    expect(widget.options.source).toMatchObject({ kind: 'choice', default: 'auto', choices: ['auto', 'live', 'planning'] });
    expect(widget.commands).toEqual([]);
    expect([...widget.actions].sort()).toEqual(['plan.activate', 'plan.clear', 'plan.save']);
    expect(widget.sizes).toEqual({ compact: { minCols: 46, minRows: 6 }, full: { minCols: 88, minRows: 13 } });
  });
});

describe('strategy-table gallery', () => {
  it('gallery: the data states of strategy-table-b.html (no highlight, committed, an open tie at the cap, notApplicable, computing, compact)', () => {
    const names = Object.keys(cases);
    // the first case, the baseline, is the mockup's first figure: a pure data state, nothing committed
    expect(names[0]).toBe('noHighlight');
    expect(names).toEqual(expect.arrayContaining(['noHighlight', 'committed', 'openTie', 'notApplicable', 'computing']));
    const first = cases.noHighlight.plan.value;
    expect(first.known && first.value.rows.some((r) => r.committed)).toBe(false);
    expect(first.known && first.value.rows.length).toBe(8);
    const committed = cases.committed.plan.value;
    expect(committed.known && committed.value.rows.filter((r) => r.committed)).toHaveLength(1);
    const open = cases.openTie.plan.value;
    expect(open.known && open.value.unresolvedTie && open.value.capHit).toBe(true);
    expect(cases.notApplicable.plan.value).toEqual({ known: false, reason: 'notApplicable' });
    expect('plan' in cases.computing).toBe(false);
    // no case carries window-local state (a highlight): only the declared topics
    for (const c of Object.values(cases)) expect(Object.keys(c).every((k) => ['plan', 'preview', 'prepared'].includes(k))).toBe(true);
    // plans are stop lists (SP4.3d1 Task 3): no case's policy carries triggers; a start compound only in the planning round
    for (const c of Object.values(cases)) {
      if (!('plan' in c) || !c.plan.value.known) continue;
      for (const r of c.plan.value.value.rows) expect(Object.keys(r.policy)).toEqual(['stops']);
    }
    // SP4.3d2 Task 12: the planning round's case, drawn with `source: planning`: the planning job's ranking
    expect(caseOptions).toEqual({ planning: { source: 'planning' } });
    expect(cases.planning.prepared.open).toBe(true);
    const preview = cases.planning.preview.value;
    expect(preview.known && preview.value.rows.length).toBe(5);
    expect(preview.known && preview.value.planning).toMatchObject({ laps: 44 });
    for (const r of preview.known ? preview.value.rows : []) expect(Object.keys(r.policy).sort()).toEqual(['startCompound', 'stops']);
    // compact through the fit sizes
    expect(fit.some((f) => f.mode === 'compact')).toBe(true);
  });

  it('fits at both mode minimums', () => {
    for (const [mode, s] of Object.entries(widget.sizes)) {
      expect(fit, mode).toContainEqual({ mode, cols: s.minCols, rows: s.minRows });
    }
  });
});
