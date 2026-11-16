// The plan-board declaration and gallery (SP4.3d spec §6.2, V17; mockup docs/design/2026-11-16-sp4.3d/plan-board.html:
// full 82×13, compact 37×7; C74: `plan.save`, `plan.activate`, `plan.remove`; the panel option `source: live | planning`,
// only `live` renders in 4.3d1). The gallery holds data states only; a selection, the slot picker and an edit draft are
// window-local (C73), component tests.
import { carId, feedId, PLAN_SLOTS } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import { caseOptions, cases, fit } from './fixtures.ts';
import { widget } from './widget.ts';

describe('plan-board declaration', () => {
  it('is named plan-board and titled "Plan board"', () => {
    expect([widget.name, widget.title]).toEqual(['plan-board', 'Plan board']);
  });

  it('reads strategy.car for the link\'s primary car and situation.sessionPhaseRace (optional) for its presentation table', () => {
    expect(Object.fromEntries(Object.entries(widget.data).map(([key, d]) => [key, d.topic]))).toEqual({
      plan: 'strategy.car',
      phase: 'situation.sessionPhaseRace',
    });
    const link = { group: 1, feedId: feedId('f'), primary: carId(3), compare: [carId(4)], window: { kind: 'live' as const } };
    expect(widget.data.plan.params?.({ link, options: {} })).toEqual({ carId: carId(3) });
    expect('optional' in widget.data.phase && widget.data.phase.optional).toBe(true);
  });

  it('declares the panel option source: live (default) or planning', () => {
    expect(widget.options.source).toMatchObject({ kind: 'choice', default: 'live', choices: ['live', 'planning'] });
  });

  it('has the mockup sizes: compact 37×7, full 82×13', () => {
    expect(widget.sizes).toEqual({ compact: { minCols: 37, minRows: 7 }, full: { minCols: 82, minRows: 13 } });
  });

  it('sends plan.save, plan.activate and plan.remove, nothing else (C74)', () => {
    expect([...widget.actions].sort()).toEqual(['plan.activate', 'plan.remove', 'plan.save']);
  });
});

describe('plan-board gallery', () => {
  it('a case per mockup state: race (the baseline), the three-slot compact board, `= A`, cold start, computing, notApplicable, planning', () => {
    const names = Object.keys(cases);
    expect(names[0]).toBe('race');
    expect(names).toEqual(['race', 'threeSlots', 'sameAsSlot', 'coldStart', 'computing', 'notApplicable', 'planning']);
    const race = cases.race.plan.value;
    expect(race.known && race.value.rows.filter((r) => r.slot !== null).map((r) => r.slot).sort()).toEqual([...PLAN_SLOTS].sort());
    expect(race.known && race.value.rows.filter((r) => r.committed).map((r) => r.slot)).toEqual(['A']);
    expect(race.known && Object.keys(race.value.bestPerStops)).toEqual(['0', '1', '2', '3']);
    const three = cases.threeSlots.plan.value;
    expect(three.known && three.value.rows.filter((r) => r.slot !== null).map((r) => r.slot).sort()).toEqual(['A', 'B', 'G1']);
    const same = cases.sameAsSlot.plan.value;
    expect(same.known && same.value.rows[same.value.bestPerStops[1]!]!.slot).toBe('A');
    const cold = cases.coldStart.plan.value;
    expect(cold.known && cold.value.scenarios).toBe(400);
    expect('plan' in cases.computing).toBe(false);
    expect(cases.notApplicable.plan.value).toEqual({ known: false, reason: 'notApplicable' });
    expect(caseOptions).toEqual({ planning: { source: 'planning' } });
    // plans are stop lists (SP4.3d spec §5.1)
    for (const c of Object.values(cases)) {
      if (!('plan' in c) || !c.plan.value.known) continue;
      for (const r of c.plan.value.value.rows) expect(Object.keys(r.policy)).toEqual(['stops']);
    }
  });

  it('fits at both mode minimums', () => {
    for (const [mode, s] of Object.entries(widget.sizes)) {
      expect(fit, mode).toContainEqual({ mode, cols: s.minCols, rows: s.minRows });
    }
  });
});
